import { useState, useCallback, useEffect, useRef } from 'react';
import * as NGL from 'ngl';
import type { CRISPRPreset, RepresentationConfig, HighlightConfig } from '@/types/structure-viewer';

export interface StructureSource {
  type: 'pdb' | 'alphafold' | 'file';
  identifier: string; // PDB ID, UniProt ID, or file URL (blob URL for uploads)
  /** For type 'file', optional extension so NGL can parse (e.g. 'pdb', 'cif', 'mmtf') */
  ext?: 'pdb' | 'cif' | 'mmtf';
}

export interface StructureMetadata {
  pdbId: string;
  title: string;
  residueCount: number;
  chainCount: number;
  resolution?: number;
  organism?: string;
  depositionDate?: string;
}

interface UseStructureLoaderOptions {
  stage: NGL.Stage | null;
  defaultRepresentation?: 'cartoon' | 'surface' | 'ribbon' | 'ball+stick';
  defaultColorScheme?: 'chainid' | 'element' | 'residueindex' | 'sstruc';
  onStructureLoaded?: (metadata: StructureMetadata) => void;
  onLoadError?: (error: Error) => void;
}

/**
 * Custom hook to load molecular structures from various sources
 * Supports RCSB PDB, AlphaFold Database, and local file uploads
 */
export function useStructureLoader({
  stage,
  defaultRepresentation = 'cartoon',
  defaultColorScheme = 'chainid',
  onStructureLoaded,
  onLoadError,
}: UseStructureLoaderOptions) {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<StructureMetadata | null>(null);
  const [currentComponent, setCurrentComponent] = useState<NGL.StructureComponent | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Construct URLs: prefer same-origin proxy, then try known public mirrors.
   * FIX 2: Use PDBe as primary fallback (better CORS support than RCSB)
   */
  const getStructureURLs = (source: StructureSource): string[] => {
    switch (source.type) {
      case 'pdb': {
        const id = source.identifier.toUpperCase();
        return [
          // Primary: Our Next.js API proxy (no CORS issues)
          `/_api_build_skip/structure/download?type=pdb&id=${encodeURIComponent(id)}`,
          // Fallback: PDBe has good CORS support
          `https://www.ebi.ac.uk/pdbe/entry-files/download/pdb${id.toLowerCase()}.ent`,
        ];
      }
      case 'alphafold': {
        const id = source.identifier.toUpperCase();
        return [
          `/_api_build_skip/structure/download?type=alphafold&id=${encodeURIComponent(id)}`,
          `https://alphafold.ebi.ac.uk/files/AF-${id}-F1-model_v4.pdb`,
        ];
      }
      case 'file':
        return [source.identifier]; // Blob URL, same origin
      default:
        throw new Error(`Unknown source type: ${source.type}`);
    }
  };

  const getFileExt = (source: StructureSource): string => {
    if (source.type === 'file' && source.ext) return source.ext;
    if (source.type === 'pdb') return 'pdb';
    if (source.type === 'alphafold') return 'pdb';
    return 'pdb';
  };

  /** Hex string to NGL color number */
  const hexToColor = (hex: string): number => {
    const h = hex.replace(/^#/, '');
    return parseInt(h.length === 6 ? h : h.slice(0, 6), 16);
  };

  /**
   * Apply preset representations and highlights to a loaded component
   */
  const applyPreset = useCallback(
    (component: NGL.StructureComponent, preset: CRISPRPreset) => {
      component.removeAllRepresentations();
      const repConfigs: Array<RepresentationConfig | HighlightConfig> = [
        ...preset.defaultRepresentations,
        ...preset.highlights.map((h) => ({ type: 'ball+stick' as const, selection: h.selection, color: h.color })),
      ];
      let addedCount = 0;
      repConfigs.forEach((config) => {
        try {
          const opts: Record<string, unknown> = {
            quality: 'high',
            smoothSheet: true,
            ...(config as RepresentationConfig).parameters,
          };
          if (typeof (config as RepresentationConfig).opacity === 'number') {
            opts.opacity = (config as RepresentationConfig).opacity;
          }
          const sel = (config as RepresentationConfig).selection ?? (config as HighlightConfig).selection;
          const color = (config as RepresentationConfig).color ?? (config as HighlightConfig).color;
          if (sel) opts.sele = sel;
          if (typeof color === 'string' && color.startsWith('#')) {
            opts.color = hexToColor(color);
          } else if (typeof color === 'string') {
            opts.color = color;
          } else if (typeof color === 'number') {
            opts.color = color;
          }
          const repType = (config as RepresentationConfig).type || 'ball+stick';
          (component as { addRepresentation: (type: string, opts: Record<string, unknown>) => void }).addRepresentation(repType, opts);
          addedCount += 1;
        } catch (err) {
          console.warn('Preset representation skipped (invalid selection?):', (config as RepresentationConfig).selection ?? (config as HighlightConfig).selection, err);
        }
      });
      if (addedCount === 0) {
        component.addRepresentation('cartoon', {
          color: 'chainid',
          quality: 'high',
          smoothSheet: true,
        });
      }
    },
    []
  );

  /**
   * Extract metadata from loaded structure
   */
  const extractMetadata = (structure: NGL.Structure, sourceId: string): StructureMetadata => {
    const atomStore = structure.atomStore;
    const chainSet = new Set(atomStore.chainname);

    return {
      pdbId: sourceId.toUpperCase(),
      title: structure.title || 'Unknown Structure',
      residueCount: structure.residueStore.count,
      chainCount: chainSet.size,
      resolution: structure.header?.resolution,
      organism: structure.entityList?.[0]?.description,
      depositionDate: structure.header?.depositionDate,
    };
  };

  /**
   * Load structure from source. Optionally apply a CRISPR preset (multiple representations).
   * 
   * FIX: Use NGL's built-in rcsb:// protocol for PDB structures (bypasses CORS)
   * FIX: Use blob conversion for local file uploads
   * FIX: Use AlphaFold fallback for AlphaFold structures
   */
  const loadStructure = useCallback(
    async (source: StructureSource, preset?: CRISPRPreset) => {
      if (!stage) {
        setError('Stage not initialized');
        return;
      }

      // Cancel any in-flight requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setProgress(0);
      setError(null);
      setMetadata(null);

      // Clear existing components
      stage.removeAllComponents();

      const sourceId = source.type === 'file' ? 'Upload' : source.identifier;

      try {
        const loadOpts: { ext?: string; firstModelOnly?: boolean; defaultRepresentation?: boolean } = {
          firstModelOnly: true,
          defaultRepresentation: false, // We'll add representations manually
        };

        let component: NGL.StructureComponent | null = null;

        // METHOD 1: Retrieve macromolecular structure from RCSB Protein Data Bank
        // Using optimized RCSB proxy protocol for direct database access
        if (source.type === 'pdb') {
          const pdbId = source.identifier.toLowerCase();
          console.log(`🔬 Retrieving structure ${pdbId.toUpperCase()} from RCSB PDB repository...`);
          
          try {
            component = await stage.loadFile(`rcsb://${pdbId}`, loadOpts).then((comp) => {
              setProgress(50);
              console.log('✅ Macromolecular structure successfully parsed and loaded');
              return comp as NGL.StructureComponent;
            });
          } catch (rcsbErr) {
            console.warn('❌ RCSB proxy failed, trying PDBe fallback...', rcsbErr);
            
            // Fallback to PDBe (CORS-friendly)
            const pdbeUrl = `https://www.ebi.ac.uk/pdbe/entry-files/download/pdb${pdbId}.ent`;
            const response = await fetch(pdbeUrl);
            if (!response.ok) {
              throw new Error(`Failed to load from PDBe: ${response.status} ${response.statusText}`);
            }
            const text = await response.text();
            const blob = new Blob([text], { type: 'text/plain' });
            const blobUrl = URL.createObjectURL(blob);
            
            try {
              component = await stage.loadFile(blobUrl, { ...loadOpts, ext: 'pdb' }).then((comp) => {
                setProgress(50);
                console.log('✅ Structure loaded via PDBe fallback!');
                return comp as NGL.StructureComponent;
              });
            } finally {
              URL.revokeObjectURL(blobUrl);
            }
          }
        }
        // METHOD 2: Blob conversion for uploaded files
        else if (source.type === 'file') {
          const blobUrl = source.identifier;
          const ext = source.ext || 'pdb';
          console.log(`📁 Loading file from blob URL (${ext})...`);
          
          component = await stage.loadFile(blobUrl, { ...loadOpts, ext }).then((comp) => {
            setProgress(50);
            console.log('✅ File loaded successfully');
            return comp as NGL.StructureComponent;
          });
        }
        // METHOD 3: AlphaFold fallback (fetch + blob conversion)
        else if (source.type === 'alphafold') {
          const uniprotId = source.identifier.toUpperCase();
          console.log(`🔄 Loading AlphaFold structure ${uniprotId}...`);
          
          const alphafoldUrl = `https://alphafold.ebi.ac.uk/files/AF-${uniprotId}-F1-model_v4.pdb`;
          const response = await fetch(alphafoldUrl);
          if (!response.ok) {
            throw new Error(`AlphaFold structure not found: ${response.status} ${response.statusText}`);
          }
          const text = await response.text();
          const blob = new Blob([text], { type: 'text/plain' });
          const blobUrl = URL.createObjectURL(blob);
          
          try {
            component = await stage.loadFile(blobUrl, { ...loadOpts, ext: 'pdb' }).then((comp) => {
              setProgress(50);
              console.log('✅ AlphaFold structure loaded!');
              return comp as NGL.StructureComponent;
            });
          } finally {
            URL.revokeObjectURL(blobUrl);
          }
        }

        if (!component) {
          throw new Error('Failed to load structure: no component created');
        }

        // Apply preset representations or default representation
        if (preset) {
          console.log('🎨 Applying preset representations:', preset.name);
          applyPreset(component, preset);
        } else {
          console.log('🎨 Applying default representation:', defaultRepresentation);
          component.addRepresentation(defaultRepresentation, {
            color: defaultColorScheme,
            quality: 'high',
            smoothSheet: true,
          });
        }

        setProgress(75);

        // Extract metadata (use PDB ID from preset or source)
        const meta = extractMetadata(component.structure, preset?.pdbId ?? sourceId);
        setMetadata(meta);
        setCurrentComponent(component);

        console.log('📊 Structure metadata:', meta);

        // Center view and force resize/render so structure is visible
        console.log('🎯 Centering view and rendering...');
        
        // CRITICAL: Ensure canvas is visible before rendering
        const canvas = (stage as unknown as { viewer?: { renderer?: { domElement?: HTMLCanvasElement } } }).viewer?.renderer?.domElement;
        if (canvas) {
          console.log('🔧 Ensuring canvas visibility...');
          canvas.style.display = 'block';
          canvas.style.visibility = 'visible';
          canvas.style.opacity = '1';
          console.log('   Canvas size:', canvas.width, 'x', canvas.height);
          console.log('   Canvas style:', canvas.style.width, 'x', canvas.style.height);
        } else {
          console.warn('⚠️ Canvas element not found!');
        }
        
        // Force stage to resize to current container dimensions
        if (typeof (stage as unknown as { handleResize?: () => void }).handleResize === 'function') {
          (stage as unknown as { handleResize: () => void }).handleResize();
          console.log('✅ Stage resized');
        }
        
        // Center the structure with animation
        component.autoView(1000);
        console.log('✅ Auto-view applied');
        
        // Force immediate render
        if (stage.viewer?.requestRender) {
          stage.viewer.requestRender();
          console.log('✅ Render requested');
        }
        
        // Multiple render passes to ensure structure is visible
        const renderPasses = [0, 100, 300, 600, 1000, 1500];
        renderPasses.forEach(delay => {
          setTimeout(() => {
            if (typeof (stage as unknown as { handleResize?: () => void }).handleResize === 'function') {
              (stage as unknown as { handleResize: () => void }).handleResize();
            }
            if (stage.viewer?.requestRender) {
              stage.viewer.requestRender();
            }
            console.log(`🔄 Render pass at ${delay}ms`);
          }, delay);
        });

        setProgress(100);
        setIsLoading(false);

        console.log('✅ Structure loading complete!');
        console.log('   Component:', component ? 'CREATED' : 'MISSING');
        console.log('   Representations:', component.reprList ? component.reprList.length : 0);

        // Callback
        if (onStructureLoaded) {
          onStructureLoaded(meta);
        }
      } catch (err: any) {
        if (abortControllerRef.current?.signal.aborted) {
          return;
        }

        // Handle specific errors
        let errorMessage = 'Failed to load structure';

        if (err.message?.includes('404') || err.message?.includes('Not Found')) {
          errorMessage = `Structure not found. Verify ${source.type === 'pdb' ? 'PDB ID' : source.type === 'alphafold' ? 'UniProt ID' : 'file'} (e.g., ${source.type === 'pdb' ? '5F9R' : 'Q99ZW2'}).`;
        } else if (err.message?.includes('NetworkError') || err.message?.includes('fetch')) {
          errorMessage = 'Unable to fetch structure. Check your connection.';
        } else if (err.message?.includes('parse') || err.message?.includes('format')) {
          errorMessage = 'Invalid PDB format. Ensure file contains ATOM records.';
        } else if (err.message?.includes('WebGL')) {
          errorMessage = 'WebGL not supported. Try a modern browser.';
        } else {
          // Include the actual error message for debugging
          errorMessage = `Failed to load structure: ${err.message || 'Unknown error'}`;
        }

        setError(errorMessage);
        setIsLoading(false);
        setProgress(0);

        if (onLoadError) {
          onLoadError(new Error(errorMessage));
        }

        console.error('❌ Structure loading error:', err);
      }
    },
    [stage, defaultRepresentation, defaultColorScheme, onStructureLoaded, onLoadError, applyPreset]
  );

  /**
   * Change representation of current structure
   */
  const changeRepresentation = useCallback(
    (representation: string, colorScheme?: string) => {
      if (!currentComponent) return;

      currentComponent.removeAllRepresentations();
      (currentComponent as { addRepresentation: (type: string, opts: Record<string, unknown>) => void }).addRepresentation(representation, {
        color: colorScheme || defaultColorScheme,
        quality: 'high',
        smoothSheet: true,
      });
    },
    [currentComponent, defaultColorScheme]
  );

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    loadStructure,
    changeRepresentation,
    isLoading,
    progress,
    error,
    metadata,
    currentComponent,
  };
}
