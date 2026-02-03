"use client";

import { useEffect, useCallback, useState, useRef } from 'react';
import { useNGLStage } from '../hooks/useNGLStage';
import { useStructureLoader, StructureSource, StructureMetadata } from '../hooks/useStructureLoader';
import { LoadingState, ErrorState } from './StructureViewerStates';
import ResidueInfoPanel from './structure-viewer/ResidueInfoPanel';
import type { CRISPRPreset, ResidueSelectionInfo, NearbyResidue } from '@/types/structure-viewer';

export interface StructureViewerCanvasProps {
  structureSource?: StructureSource;
  /** When set, loader applies this preset (multiple representations) after load */
  presetToApply?: CRISPRPreset | null;
  defaultRepresentation?: 'cartoon' | 'surface' | 'ribbon' | 'ball+stick';
  defaultColorScheme?: 'chainid' | 'element' | 'residueindex' | 'sstruc';
  backgroundColor?: string;
  onStructureLoaded?: (metadata: StructureMetadata) => void;
  onLoadError?: (error: Error) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  /** When user clicks "Load Example (5F9R)", call this so parent can set structureSource + preset */
  onLoadExampleRequested?: () => void;
  className?: string;
}

/**
 * Main 3D molecular structure viewer component
 *
 * Uses NGL (WebGL-based molecular graphics library) to render protein structures
 * Supports loading from RCSB PDB, AlphaFold Database, and local files
 *
 * Features:
 * - High-quality WebGL rendering with 2x antialiasing
 * - Smooth camera controls (rotate, zoom, pan)
 * - Auto-center on load
 * - Memory leak prevention with proper cleanup
 * - Error handling with user-friendly messages
 * - Loading progress indication
 *
 * @example
 * ```tsx
 * <StructureViewerCanvas
 *   structureSource={{ type: 'pdb', identifier: '5F9R' }}
 *   defaultRepresentation="cartoon"
 *   defaultColorScheme="chainid"
 *   onStructureLoaded={(meta) => console.log('Loaded:', meta.title)}
 * />
 * ```
 */
export default function StructureViewerCanvas({
  structureSource,
  presetToApply = null,
  defaultRepresentation = 'cartoon',
  defaultColorScheme = 'chainid',
  backgroundColor = '#FAF8F5',
  onStructureLoaded,
  onLoadError,
  onLoadingChange,
  onLoadExampleRequested,
  className = '',
}: StructureViewerCanvasProps) {
  // Add mount state to ensure container is ready
  const [isMounted, setIsMounted] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    console.log('🎬 StructureViewerCanvas mounted');
    setIsMounted(true);
    // Clear initializing state after a brief moment
    const timer = setTimeout(() => setInitializing(false), 500);
    return () => {
      console.log('👋 StructureViewerCanvas unmounting');
      clearTimeout(timer);
      setIsMounted(false);
    };
  }, []);

  // Initialize NGL Stage
  const { containerRef, stage, isReady, error: stageError } = useNGLStage(backgroundColor);

  // Structure loader
  const {
    loadStructure,
    isLoading,
    progress,
    error: loadError,
    metadata,
    currentComponent,
  } = useStructureLoader({
    stage,
    defaultRepresentation,
    defaultColorScheme,
    onStructureLoaded,
    onLoadError,
  });

  useEffect(() => {
    onLoadingChange?.(isLoading);
  }, [isLoading, onLoadingChange]);

  // Debug: Log when stage becomes ready
  useEffect(() => {
    if (isReady && stage) {
      console.log('✅ NGL Stage is ready for structure loading');
    }
  }, [isReady, stage]);

  // Stable primitive deps so useEffect array size never changes (avoids React warning)
  const sourceKey = structureSource
    ? `${structureSource.type}:${structureSource.identifier}`
    : '';
  const presetId = presetToApply?.id ?? '';

  // Load structure when source (or preset) changes
  useEffect(() => {
    if (structureSource && stage && isReady) {
      console.log('🔵 Triggering structure load:', sourceKey, presetId || '(no preset)');
      loadStructure(structureSource, presetToApply ?? undefined);
    } else {
      console.log('⏳ Waiting for conditions:', {
        hasSource: !!structureSource,
        hasStage: !!stage,
        isReady,
      });
    }
  }, [sourceKey, presetId, !!stage, isReady, loadStructure]);

  // Residue picking: selected residue and hover tooltip
  const [selectedResidue, setSelectedResidue] = useState<ResidueSelectionInfo | null>(null);
  const [hoverTooltip, setHoverTooltip] = useState<{
    visible: boolean;
    content: string;
    x: number;
    y: number;
  }>({ visible: false, content: '', x: 0, y: 0 });
  const highlightReprRef = useRef<{ remove: () => void } | null>(null);

  // Build nearby residues and interaction type (simplified; no NGL dependency in this file)
  const buildNearbyResidues = useCallback(
    (
      structure: { eachAtom: (cb: (a: { residueIndex: number; resname: string; chainname: string; x: number; y: number; z: number }) => void) => void },
      centerResidueIndex: number,
      ax: number,
      ay: number,
      az: number,
      radius: number
    ): NearbyResidue[] => {
      const nearby: NearbyResidue[] = [];
      const seen = new Set<string>();
      structure.eachAtom((o) => {
        if (o.residueIndex === centerResidueIndex) return;
        const key = `${o.chainname}-${o.residueIndex}`;
        if (seen.has(key)) return;
        const d = Math.sqrt(
          (o.x - ax) ** 2 + (o.y - ay) ** 2 + (o.z - az) ** 2
        );
        if (d <= radius) {
          seen.add(key);
          let interaction = 'Van der Waals';
          const hydrophobic = ['ALA', 'VAL', 'ILE', 'LEU', 'MET', 'PHE', 'TRP', 'PRO'];
          if (d < 3.5) interaction = 'Hydrogen bond / contact';
          if (hydrophobic.includes(o.resname)) interaction = 'Hydrophobic contact';
          nearby.push({
            residueName: o.resname,
            residueNumber: o.residueIndex + 1,
            chain: o.chainname,
            distance: d.toFixed(2),
            interaction,
          });
        }
      });
      return nearby.sort((a, b) => parseFloat(a.distance) - parseFloat(b.distance));
    },
    []
  );

  // Click and hover picking when stage and component exist
  useEffect(() => {
    if (!stage || !currentComponent || !isReady) return;

    const handleClick = (pickingProxy: unknown) => {
      const proxy = pickingProxy as {
        atom?: {
          residueIndex: number;
          resname: string;
          chainname: string;
          resno: number;
          x: number;
          y: number;
          z: number;
          atomname?: string;
          element?: string;
          bfactor?: number;
          structure?: { eachAtom: (cb: (a: { residueIndex: number; resname: string; chainname: string; x: number; y: number; z: number }) => void) => void };
        };
        canvasPosition?: { x: number; y: number };
      };
      if (!proxy?.atom) {
        setSelectedResidue(null);
        if (highlightReprRef.current) {
          highlightReprRef.current.remove();
          highlightReprRef.current = null;
        }
        return;
      }
      const atom = proxy.atom;
      const compStructure = (currentComponent as { structure?: { eachAtom: (cb: (a: { residueIndex: number; resname: string; chainname: string; x: number; y: number; z: number }) => void) => void } }).structure;
      const structure = (atom as { structure?: typeof compStructure }).structure ?? compStructure;
      const nearbyResidues = structure
        ? buildNearbyResidues(structure, atom.residueIndex, atom.x, atom.y, atom.z, 5.0)
        : undefined;

      const info: ResidueSelectionInfo = {
        residueNumber: atom.resno ?? atom.residueIndex + 1,
        residueName: atom.resname,
        chainId: atom.chainname,
        atomName: atom.atomname,
        element: atom.element,
        bFactor: atom.bfactor,
        coordinates: {
          x: atom.x.toFixed(2),
          y: atom.y.toFixed(2),
          z: atom.z.toFixed(2),
        },
        nearbyResidues,
      };
      
      console.log('🖱️ Atom clicked:', {
        residue: `${atom.resname}-${info.residueNumber}`,
        chain: atom.chainname,
        atom: atom.atomname,
        coords: `(${atom.x.toFixed(1)}, ${atom.y.toFixed(1)}, ${atom.z.toFixed(1)})`,
      });
      
      setSelectedResidue(info);

      // Remove previous highlight and add new one (PyMOL-style yellow highlight)
      if (highlightReprRef.current) {
        try {
          highlightReprRef.current.remove();
        } catch (e) {
          console.warn('Could not remove previous highlight:', e);
        }
        highlightReprRef.current = null;
      }
      
      try {
        // PyMOL-style selection: bright yellow ball+stick with label
        // Use residueIndex for NGL selection (0-based)
        const selectionString = `${atom.residueIndex}:${atom.chainname}`;
        
        const repr = (currentComponent as unknown as { addRepresentation: (type: string, opts: Record<string, unknown>) => { remove?: () => void; dispose?: () => void } }).addRepresentation(
          'ball+stick',
          {
            sele: selectionString,
            color: 0xFFFF00, // Bright yellow (PyMOL selection color)
            radiusScale: 2.0, // Larger for better visibility
            opacity: 1.0, // Fully opaque
          }
        );
        
        // Add label (PyMOL-style) - residue name and number
        const labelRepr = (currentComponent as unknown as { addRepresentation: (type: string, opts: Record<string, unknown>) => { remove?: () => void; dispose?: () => void } }).addRepresentation(
          'label',
          {
            sele: selectionString,
            labelType: 'residue',
            labelText: `${atom.resname}-${info.residueNumber}`,
            color: 0xFFFFFF, // White text
            fontSize: 18,
            backgroundColor: 0x000000,
            backgroundOpacity: 0.85,
            showBorder: true,
            borderColor: 0xFFFF00,
            borderWidth: 2,
          }
        );
        
        const cleanup = repr?.remove ?? repr?.dispose;
        const labelCleanup = labelRepr?.remove ?? labelRepr?.dispose;
        if (typeof cleanup === 'function') {
          highlightReprRef.current = {
            remove: () => {
              try {
                if (cleanup) cleanup.call(repr);
                if (labelCleanup) labelCleanup.call(labelRepr);
              } catch (e) {
                console.warn('Error during cleanup:', e);
              }
            }
          };
        }
        
        console.log('✅ Selection highlight and label added');
      } catch (err) {
        console.warn('Failed to add selection highlight:', err);
      }
    };

    const handleHover = (pickingProxy: unknown) => {
      const proxy = pickingProxy as {
        atom?: { resname: string; residueIndex: number; chainname: string };
        canvasPosition?: { x: number; y: number };
      };
      if (!proxy?.atom) {
        setHoverTooltip((t) => (t.visible ? { ...t, visible: false } : t));
        return;
      }
      const atom = proxy.atom;
      const px = proxy.canvasPosition?.x ?? 0;
      const py = proxy.canvasPosition?.y ?? 0;
      const rect = containerRef.current?.getBoundingClientRect();
      setHoverTooltip({
        visible: true,
        content: `${atom.resname} ${atom.residueIndex + 1} (${atom.chainname})`,
        x: rect ? rect.left + px + 12 : px,
        y: rect ? rect.top + py + 12 : py,
      });
    };

    type StageSignals = {
      clicked?: { add: (fn: (p: unknown) => void) => void; remove: (fn: (p: unknown) => void) => void };
      hovered?: { add: (fn: (p: unknown) => void) => void; remove: (fn: (p: unknown) => void) => void };
    };
    const sig = (stage as { signals?: StageSignals }).signals;
    sig?.clicked?.add(handleClick);
    sig?.hovered?.add(handleHover);

    return () => {
      sig?.clicked?.remove(handleClick);
      sig?.hovered?.remove(handleHover);
      if (highlightReprRef.current) {
        highlightReprRef.current.remove();
        highlightReprRef.current = null;
      }
    };
  }, [stage, currentComponent, isReady, buildNearbyResidues]);

  // Clear selection when structure changes
  useEffect(() => {
    if (!currentComponent) {
      setSelectedResidue(null);
      if (highlightReprRef.current) {
        highlightReprRef.current.remove();
        highlightReprRef.current = null;
      }
    }
  }, [currentComponent]);

  // Handle retry
  const handleRetry = useCallback(() => {
    if (structureSource && stage) {
      loadStructure(structureSource, presetToApply ?? undefined);
    }
  }, [structureSource, presetToApply, stage, loadStructure]);

  // Handle load example: notify parent so it sets structureSource + preset (canonical flow)
  const handleLoadExample = useCallback(() => {
    if (onLoadExampleRequested) {
      onLoadExampleRequested();
    } else if (stage) {
      loadStructure({ type: 'pdb', identifier: '5F9R' });
    }
  }, [stage, loadStructure, onLoadExampleRequested]);

  // Keyboard controls
  useEffect(() => {
    if (!stage || !isReady) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // R key: Reset view
      if (e.key === 'r' || e.key === 'R') {
        stage.autoView(1000);
      }

      // Arrow keys: Rotate (NGL Stage typings may be incomplete)
      const spin = (stage as unknown as { spinAnimation?: { axis: { set: (x: number, y: number, z: number) => void }; angle: number } }).spinAnimation;
      const rotationStep = 0.05;
      if (spin && e.key === 'ArrowLeft') {
        spin.axis.set(0, 1, 0);
        spin.angle = rotationStep;
        stage.viewer.requestRender();
      } else if (spin && e.key === 'ArrowRight') {
        spin.axis.set(0, 1, 0);
        spin.angle = -rotationStep;
        stage.viewer.requestRender();
      } else if (spin && e.key === 'ArrowUp') {
        spin.axis.set(1, 0, 0);
        spin.angle = rotationStep;
        stage.viewer.requestRender();
      } else if (spin && e.key === 'ArrowDown') {
        spin.axis.set(1, 0, 0);
        spin.angle = -rotationStep;
        stage.viewer.requestRender();
      }

      // +/- keys: Zoom
      const viewer = stage.viewer as unknown as { zoom?: (d: number) => void; requestRender: () => void };
      if (e.key === '+' || e.key === '=') {
        if (typeof viewer.zoom === 'function') viewer.zoom(0.1);
        stage.viewer.requestRender();
      } else if (e.key === '-' || e.key === '_') {
        if (typeof viewer.zoom === 'function') viewer.zoom(-0.1);
        stage.viewer.requestRender();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [stage, isReady]);

  const error: string | null =
    (stageError ? (stageError instanceof Error ? stageError.message : String(stageError)) : null) || loadError;

  return (
    <div className={`relative w-full h-full ${className}`} style={{ width: '100%', height: '100%', minHeight: '600px' }}>
      {/* NGL WebGL Canvas Container - Critical: Must maintain dimensions for GPU rendering */}
      <div
        ref={containerRef}
        className="absolute inset-0 rounded-2xl overflow-hidden shadow-card border border-border"
        style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100%',
          height: '100%',
          minHeight: '600px',
          display: 'block',
          visibility: 'visible',
          opacity: 1,
          zIndex: 1,
          backgroundColor: backgroundColor,
          backgroundImage: `radial-gradient(circle at 25px 25px, rgba(106, 191, 54, 0.03) 2%, transparent 0%), 
                           radial-gradient(circle at 75px 75px, rgba(106, 191, 54, 0.03) 2%, transparent 0%)`,
          backgroundSize: '100px 100px',
          pointerEvents: 'auto',
        }}
        role="img"
        aria-label={metadata ? `Crystallographic structure: ${metadata.title}` : 'Interactive molecular structure viewer'}
      />

      {/* Initialization State - shows briefly on mount */}
      {initializing && !isReady && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}>
          <LoadingState
            progress={0}
            message="Initializing molecular graphics engine..."
          />
        </div>
      )}

      {/* Loading State - positioned above canvas */}
      {isLoading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}>
          <LoadingState
            progress={progress}
            message={`Loading ${structureSource?.identifier || 'structure'}...`}
          />
        </div>
      )}

      {/* Error State - positioned above canvas */}
      {error && !isLoading && (
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 10 }}>
          <ErrorState error={error} onRetry={handleRetry} />
        </div>
      )}

      {/* Ready state indicator - shows when stage is initialized but no structure loaded */}
      {!structureSource && !metadata && !isLoading && !error && isReady && !initializing && (
        <div className="absolute inset-0 flex items-center justify-center z-5 pointer-events-none">
          <div className="text-center p-8 bg-surface/40 backdrop-blur-sm rounded-2xl border border-accent/10">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-accent/5 flex items-center justify-center">
              <svg className="w-8 h-8 text-accent/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
            <p className="text-sm text-text-tertiary font-serif">
              Viewer ready • Select a structure from the control panel
            </p>
          </div>
        </div>
      )}

      {/* Diagnostic overlay for development environment */}
      {process.env.NODE_ENV === 'development' && (
        <div className="absolute bottom-2 left-2 z-30 text-[10px] font-mono bg-black/85 text-white p-2.5 rounded-lg border border-white/20 pointer-events-none backdrop-blur-sm">
          <div className="font-semibold text-green-400 mb-1">System Diagnostics</div>
          <div>WebGL Engine: {isReady ? '🟢 Active' : '🟡 Initializing'}</div>
          <div>DOM Mount: {isMounted ? '🟢 Ready' : '🟡 Pending'}</div>
          <div>Data Loading: {isLoading ? '🔵 In Progress' : '⚪ Idle'}</div>
          <div>Structure ID: {structureSource?.identifier ?? 'None'}</div>
          <div>Parsed Data: {metadata?.pdbId ?? 'None'}</div>
          <div>Error State: {error ? '🔴 Active' : '🟢 Clear'}</div>
          <div className="mt-1 pt-1 border-t border-white/20">
            Component: {currentComponent ? '✓' : '✗'}
          </div>
        </div>
      )}

      {/* Residue info panel (click-to-inspect) */}
      {selectedResidue && (
        <ResidueInfoPanel
          residue={selectedResidue}
          onClose={() => {
            setSelectedResidue(null);
            if (highlightReprRef.current) {
              highlightReprRef.current.remove();
              highlightReprRef.current = null;
            }
          }}
          pdbId={metadata?.pdbId}
        />
      )}

      {/* PyMOL-style hover tooltip - modern gradient design */}
      {hoverTooltip.visible && (
        <div
          className="pointer-events-none fixed z-30 px-4 py-2.5 text-sm font-mono bg-gradient-to-br from-gray-900 via-black to-gray-900 text-white border-2 border-yellow-400/60 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in duration-150"
          style={{
            left: hoverTooltip.x + 16,
            top: hoverTooltip.y + 16,
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 215, 0, 0.2), 0 0 20px rgba(255, 215, 0, 0.15)',
          }}
        >
          <div className="font-bold text-yellow-300 tracking-wide">{hoverTooltip.content}</div>
          <div className="text-[11px] text-gray-400 mt-1 flex items-center">
            <svg className="w-3 h-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            Click to inspect
          </div>
        </div>
      )}

      {/* Keyboard hints (screen reader only) */}
      <div className="sr-only" role="status" aria-live="polite">
        {isLoading && `Loading structure ${progress}% complete`}
        {metadata && `Structure loaded: ${metadata.title}, ${metadata.residueCount} residues, ${metadata.chainCount} chains`}
        {error && `Error: ${error}`}
      </div>
    </div>
  );
}
