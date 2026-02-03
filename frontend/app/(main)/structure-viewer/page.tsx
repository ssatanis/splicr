"use client";

/**
 * Structure Viewer page: 3D protein structure viewer with control panel and upload.
 *
 * Layout:
 * - Left: Sidebar (auto-minimized for more space; maximize button restores it).
 * - Center: StructureViewerCanvas (NGL viewer).
 * - Right: StructureControlPanel — presets, representation, color, visibility, upload.
 * - Researchers can load CRISPR presets or upload PDB/CIF/MMTF files.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Download,
  RotateCcw,
  Info,
  Sparkles,
  Sliders,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import Button from '@/components/Button';
import { StructureViewerErrorBoundary } from '@/components/StructureViewerErrorBoundary';
import { StructureSource, StructureMetadata } from '@/hooks/useStructureLoader';
import { StructureControlPanel } from '@/components/structure-viewer';
import { ResizableAIPanel } from '@/components/structure-viewer/ResizableAIPanel';
import { cn } from '@/lib/utils';
import { fetchLiteratureByPdb } from '@/lib/screenStructureApi';
import type { PubMedArticle } from '@/types/ai.types';
import { getPresetById } from '@/lib/crispr-structure-presets';
import type {
  ControlPanelState,
  CRISPRPreset,
  RepresentationType,
  ColorSchemeType,
  QualityLevel,
} from '@/types/structure-viewer';

const StructureViewerCanvas = dynamic(
  () => import('@/components/StructureViewerCanvas'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full min-h-[600px] flex items-center justify-center bg-surface rounded-2xl border border-border font-serif">
        <div className="text-center">
          <div className="inline-block animate-spin mb-4 w-10 h-10 border-2 border-accent border-t-transparent rounded-full" />
          <p className="text-text-secondary">Initializing 3D viewer...</p>
        </div>
      </div>
    ),
  }
);

const initialPanelState: ControlPanelState = {
  activePreset: null,
  representation: 'cartoon',
  colorScheme: 'chainid',
  quality: 'medium',
  visibleComponents: new Set(['guideRNA', 'targetDNA', 'pam', 'activeSite']),
  customSelection: '',
  uniformColor: '#9CA3AF',
};

function getFileExt(name: string): 'pdb' | 'cif' | 'mmtf' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.cif')) return 'cif';
  if (lower.endsWith('.mmtf')) return 'mmtf';
  return 'pdb';
}

export default function StructureViewerPage() {
  // Auto-load default structure (Cas9) on mount for demonstration
  const [structureSource, setStructureSource] = useState<StructureSource | undefined>(() => {
    return { type: 'pdb', identifier: '5F9R' };
  });
  const [presetToApply, setPresetToApply] = useState<CRISPRPreset | null>(() => {
    return getPresetById('spcas9-sgrna') ?? null;
  });
  const [panelState, setPanelState] = useState<ControlPanelState>(() => {
    const preset = getPresetById('spcas9-sgrna');
    return { ...initialPanelState, activePreset: preset?.id ?? null };
  });
  const [metadata, setMetadata] = useState<StructureMetadata | null>(null);
  const [showMetadata, setShowMetadata] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [uploadBlobUrl, setUploadBlobUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [literature, setLiterature] = useState<PubMedArticle[]>([]);
  const [literatureLoading, setLiteratureLoading] = useState(false);
  const [rcsbInfo, setRcsbInfo] = useState<{
    title: string | null;
    resolution: number | null;
    organism: string | null;
    depositionDate: string | null;
    releaseDate?: string | null;
    method?: string | null;
    atomCount?: number | null;
    chainCount?: number | null;
    authors?: string[] | null;
    citation?: {
      title: string | null;
      journal: string | null;
      year: number | null;
      doi: string | null;
      pmid: string | null;
    } | null;
    quality?: {
      rValue: number | null;
      rFree: number | null;
      clashScore: number | null;
    } | null;
  } | null>(null);
  const [rcsbLoading, setRcsbLoading] = useState(false);
  const [expandedAbstractPmid, setExpandedAbstractPmid] = useState<string | null>(null);
  const [abstractCache, setAbstractCache] = useState<Record<string, { abstract: string | null; loading: boolean }>>({});
  const [rightPanelTab, setRightPanelTab] = useState<'controls' | 'ai'>('controls');

  const isUploadedFile = structureSource?.type === 'file';
  const presetsEnabled = !isUploadedFile;

  const handlePresetSelect = useCallback((preset: CRISPRPreset) => {
    console.log('🎯 Preset selected:', preset.name, preset.pdbId);
    setPresetToApply(preset);
    setStructureSource({ type: 'pdb', identifier: preset.pdbId });
    setPanelState((s) => ({ ...s, activePreset: preset.id }));
    setShowMetadata(true);
    setUploadBlobUrl(null);
  }, []);

  const handleFileSelect = useCallback((file: File) => {
    const blobUrl = URL.createObjectURL(file);
    setUploadBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blobUrl;
    });
    setPresetToApply(null);
    setStructureSource({
      type: 'file',
      identifier: blobUrl,
      ext: getFileExt(file.name),
    });
    setPanelState((s) => ({ ...s, activePreset: null }));
    setShowMetadata(true);
  }, []);

  const handleRepresentationChange = useCallback((type: RepresentationType) => {
    setPanelState((s) => ({ ...s, representation: type }));
    setReloadKey((k) => k + 1);
  }, []);

  const handleColorSchemeChange = useCallback((scheme: ColorSchemeType, uniformColor?: string) => {
    setPanelState((s) => ({ ...s, colorScheme: scheme, uniformColor: uniformColor ?? s.uniformColor }));
    setReloadKey((k) => k + 1);
  }, []);

  const handleVisibilityToggle = useCallback((component: string, visible: boolean) => {
    setPanelState((s) => {
      const next = new Set(s.visibleComponents);
      if (visible) next.add(component);
      else next.delete(component);
      return { ...s, visibleComponents: next };
    });
  }, []);

  const handleQualityChange = useCallback((quality: QualityLevel) => {
    setPanelState((s) => ({ ...s, quality }));
    setReloadKey((k) => k + 1);
  }, []);

  const handleStructureLoaded = useCallback((meta: StructureMetadata) => {
    setMetadata(meta);
  }, []);

  const handleLoadExampleRequested = useCallback(() => {
    console.log('🔵 Loading example structure (5F9R)...');
    const preset = getPresetById('spcas9-sgrna') ?? null;
    setPresetToApply(preset);
    setStructureSource({ type: 'pdb', identifier: '5F9R' });
    setPanelState((s) => ({ ...s, activePreset: preset?.id ?? null }));
    setShowMetadata(true);
    setUploadBlobUrl(null);
  }, []);

  // Fetch related literature when a PDB structure is loaded (real API)
  useEffect(() => {
    const pdbId = metadata?.pdbId;
    if (!pdbId || pdbId === 'Upload' || pdbId.length < 4) {
      setLiterature([]);
      return;
    }
    let cancelled = false;
    setLiteratureLoading(true);
    fetchLiteratureByPdb(pdbId, 8)
      .then((articles) => {
        if (!cancelled) setLiterature(articles);
      })
      .catch(() => {
        if (!cancelled) setLiterature([]);
      })
      .finally(() => {
        if (!cancelled) setLiteratureLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metadata?.pdbId ?? '']);

  // Fetch RCSB structure info (real, up-to-date) when PDB is loaded
  useEffect(() => {
    const pdbId = metadata?.pdbId;
    if (!pdbId || pdbId === 'Upload' || pdbId.length < 4) {
      setRcsbInfo(null);
      return;
    }
    let cancelled = false;
    setRcsbLoading(true);
    fetch(`/_api_build_skip/structure/rcsb?pdbId=${encodeURIComponent(pdbId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: {
        title?: string; resolution?: number; organism?: string; depositionDate?: string;
        releaseDate?: string; method?: string; atomCount?: number; chainCount?: number;
        authors?: string[]; citation?: { title?: string; journal?: string; year?: number; doi?: string; pmid?: string };
        quality?: { rValue?: number; rFree?: number; clashScore?: number };
      } | null) => {
        if (!cancelled && data) {
          const cit = data.citation;
          setRcsbInfo({
            title: data.title ?? null,
            resolution: typeof data.resolution === 'number' ? data.resolution : null,
            organism: data.organism ?? null,
            depositionDate: data.depositionDate ?? null,
            releaseDate: data.releaseDate ?? null,
            method: data.method ?? null,
            atomCount: data.atomCount ?? null,
            chainCount: data.chainCount ?? null,
            authors: data.authors ?? null,
            citation: cit
              ? {
                  title: cit.title ?? null,
                  journal: cit.journal ?? null,
                  year: cit.year ?? null,
                  doi: cit.doi ?? null,
                  pmid: cit.pmid ?? null,
                }
              : null,
            quality: data.quality
              ? {
                  rValue: data.quality.rValue ?? null,
                  rFree: data.quality.rFree ?? null,
                  clashScore: data.quality.clashScore ?? null,
                }
              : null,
          });
        } else if (!cancelled) {
          setRcsbInfo(null);
        }
      })
      .catch(() => {
        if (!cancelled) setRcsbInfo(null);
      })
      .finally(() => {
        if (!cancelled) setRcsbLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [metadata?.pdbId ?? '']);

  // Fetch abstract when user expands a paper
  useEffect(() => {
    if (!expandedAbstractPmid) return;
    const cached = abstractCache[expandedAbstractPmid];
    if (cached !== undefined) return; // already loading or loaded
    setAbstractCache((c) => ({ ...c, [expandedAbstractPmid]: { abstract: null, loading: true } }));
    fetch(`/_api_build_skip/literature/pubmed/article?pmid=${encodeURIComponent(expandedAbstractPmid)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { abstract?: string | null } | null) => {
        setAbstractCache((c) => ({
          ...c,
          [expandedAbstractPmid]: { abstract: data?.abstract ?? null, loading: false },
        }));
      })
      .catch(() => {
        setAbstractCache((c) => ({ ...c, [expandedAbstractPmid]: { abstract: null, loading: false } }));
      });
  }, [expandedAbstractPmid, abstractCache]);

  const handleReset = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const handleDownloadScreenshot = useCallback(() => {
    alert('Screenshot download will be implemented with stage.makeImage()');
  }, []);

  const componentCounts: Record<string, number> = useMemo(() => {
    if (!metadata) return {} as Record<string, number>;
    return {
      guideRNA: metadata.residueCount ? Math.round(metadata.residueCount * 0.1) : 0,
      targetDNA: metadata.residueCount ? Math.round(metadata.residueCount * 0.05) : 0,
      pam: 3,
      activeSite: 12,
      water: 0,
      ligands: 0,
      hbonds: 0,
    };
  }, [metadata]);

  return (
      <div className="flex flex-col h-screen font-serif">
        <header className="flex-shrink-0 px-8 py-6 border-b border-border bg-surface">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-serif text-text-primary mb-2 flex items-center gap-3">
                <Sparkles className="w-8 h-8 text-accent" />
                Macromolecular Structure Visualization
              </h1>
              <p className="text-text-secondary">High-fidelity interactive rendering of protein crystallographic data and predicted structures</p>
            </div>
          </div>
        </header>

        <div className="flex-1 flex overflow-hidden">
          {/* Center: Viewer + toolbar + metadata */}
          <div className="flex-1 flex flex-col min-w-0 p-6 gap-4 overflow-y-auto">
          <div className="flex-shrink-0 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2">
              <Button onClick={handleReset} variant="outline" size="sm">
                <RotateCcw className="w-4 h-4 mr-2" />
                Reset view
              </Button>
              <button
                onClick={handleDownloadScreenshot}
                className="p-2 rounded-lg border border-border hover:bg-background transition-colors font-serif"
                title="Download screenshot"
              >
                <Download className="w-5 h-5 text-text-secondary" />
              </button>
            </div>
            {metadata && (
              <p className="text-sm text-text-secondary">
                {metadata.pdbId}
                {metadata.residueCount > 0 && ` · ${metadata.residueCount.toLocaleString()} residues`}
              </p>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-4" style={{ minHeight: '500px', height: '100%' }}>
            <StructureViewerErrorBoundary>
              <div className="flex-1" style={{ minHeight: '500px', position: 'relative' }}>
                <StructureViewerCanvas
                  key={reloadKey}
                  structureSource={structureSource}
                  presetToApply={presetToApply}
                  defaultRepresentation={panelState.representation as 'cartoon' | 'surface' | 'ribbon' | 'ball+stick'}
                  defaultColorScheme={
                    panelState.colorScheme === 'uniform'
                      ? 'chainid'
                      : (panelState.colorScheme as 'chainid' | 'element' | 'residueindex' | 'sstruc')
                  }
                  backgroundColor="#FAF8F5"
                  onStructureLoaded={handleStructureLoaded}
                  onLoadingChange={setIsLoading}
                  onLoadExampleRequested={handleLoadExampleRequested}
                  className="w-full h-full"
                />
              </div>
            </StructureViewerErrorBoundary>

            <div className="flex-shrink-0 bg-surface rounded-xl p-4 shadow-card border border-border">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" />
                <div className="text-sm text-text-secondary font-serif">
                  <span className="font-medium text-text-primary">Keyboard:</span>
                  {' '}Arrow keys rotate · +/- zoom · R reset · Mouse drag rotate · Scroll zoom
                </div>
              </div>
            </div>
          </div>

          <AnimatePresence>
            {metadata && showMetadata && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-shrink-0 bg-gradient-to-br from-surface via-surface to-surface/95 rounded-xl p-5 shadow-card border border-accent/20"
              >
                <h3 className="text-lg font-serif font-semibold text-text-primary mb-4 flex items-center">
                  <svg className="w-5 h-5 mr-2 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Crystallographic Data
                </h3>
                {rcsbLoading && (
                  <p className="text-sm text-text-tertiary mb-3 italic flex items-center">
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                      className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full mr-2"
                    />
                    Retrieving metadata from RCSB Protein Data Bank...
                  </p>
                )}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">ID</div>
                    <div className="font-mono text-text-primary">{metadata.pdbId}</div>
                  </div>
                  <div className="col-span-2 md:col-span-1">
                    <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Residues</div>
                    <div className="font-medium text-text-primary">{metadata.residueCount.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Chains</div>
                    <div className="font-medium text-text-primary">{rcsbInfo?.chainCount ?? metadata.chainCount}</div>
                  </div>
                  {(rcsbInfo?.atomCount != null) && (
                    <div>
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Atoms</div>
                      <div className="font-medium text-text-primary">{rcsbInfo.atomCount.toLocaleString()}</div>
                    </div>
                  )}
                  <div className="col-span-2 md:col-span-2">
                    <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Title</div>
                    <div className="text-text-primary">
                      {(rcsbInfo?.title ?? metadata.title) || '—'}
                    </div>
                  </div>
                  {(rcsbInfo?.method) && (
                    <div>
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Method</div>
                      <div className="text-text-primary">{rcsbInfo.method}</div>
                    </div>
                  )}
                  {(rcsbInfo?.resolution != null || metadata.resolution != null) && (
                    <div>
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Resolution</div>
                      <div className="text-text-primary">
                        {(rcsbInfo?.resolution ?? metadata.resolution)?.toFixed(2)} Å
                      </div>
                    </div>
                  )}
                  {(rcsbInfo?.organism ?? metadata.organism) && (
                    <div>
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Organism</div>
                      <div className="text-text-primary">{rcsbInfo?.organism ?? metadata.organism}</div>
                    </div>
                  )}
                  {(rcsbInfo?.depositionDate ?? metadata.depositionDate) && (
                    <div>
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Deposition</div>
                      <div className="text-text-primary">{rcsbInfo?.depositionDate ?? metadata.depositionDate}</div>
                    </div>
                  )}
                  {rcsbInfo?.releaseDate && (
                    <div>
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Release</div>
                      <div className="text-text-primary">{rcsbInfo.releaseDate}</div>
                    </div>
                  )}
                  {rcsbInfo?.authors && rcsbInfo.authors.length > 0 && (
                    <div className="col-span-2 md:col-span-2">
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Authors</div>
                      <div className="text-text-primary text-xs">
                        {rcsbInfo.authors.slice(0, 5).join(', ')}
                        {rcsbInfo.authors.length > 5 && ` +${rcsbInfo.authors.length - 5}`}
                      </div>
                    </div>
                  )}
                  {rcsbInfo?.citation && (rcsbInfo.citation.doi || rcsbInfo.citation.pmid) && (
                    <div className="col-span-2">
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Citation</div>
                      <div className="flex flex-wrap gap-2 text-xs">
                        {rcsbInfo.citation.doi && (
                          <a
                            href={`https://doi.org/${rcsbInfo.citation.doi}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            DOI
                          </a>
                        )}
                        {rcsbInfo.citation.pmid && (
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${rcsbInfo.citation.pmid}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline"
                          >
                            PubMed
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  {rcsbInfo?.quality && (rcsbInfo.quality.rValue != null || rcsbInfo.quality.rFree != null || rcsbInfo.quality.clashScore != null) && (
                    <div className="col-span-2">
                      <div className="text-xs text-text-tertiary uppercase tracking-wide mb-1 font-serif">Quality</div>
                      <div className="text-text-primary text-xs">
                        {[
                          rcsbInfo.quality.rValue != null && `R-work: ${rcsbInfo.quality.rValue.toFixed(3)}`,
                          rcsbInfo.quality.rFree != null && `R-free: ${rcsbInfo.quality.rFree.toFixed(3)}`,
                          rcsbInfo.quality.clashScore != null && `Clash: ${rcsbInfo.quality.clashScore}`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  )}
                </div>
              </motion.section>
            )}
          </AnimatePresence>

          {/* Related literature (scrollable, expandable abstracts) */}
          {metadata?.pdbId && metadata.pdbId !== 'Upload' && metadata.pdbId.length >= 4 && (
            <section className="flex-shrink-0 bg-gradient-to-br from-surface via-surface to-surface/95 rounded-xl p-5 shadow-card border border-accent/20">
              <h3 className="text-lg font-serif font-semibold text-text-primary mb-3 sticky top-0 bg-surface pb-2 flex items-center">
                <svg className="w-5 h-5 mr-2 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Peer-Reviewed Literature ({literature.length})
              </h3>
              {literatureLoading ? (
                <p className="text-sm text-text-tertiary">Loading papers from PubMed...</p>
              ) : literature.length === 0 ? (
                <p className="text-sm text-text-tertiary">No papers found for this structure in PubMed.</p>
              ) : (
                <ul className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                  {literature.map((art) => {
                    const cached = abstractCache[art.pmid];
                    const isExpanded = expandedAbstractPmid === art.pmid;
                    const showAbstract = isExpanded && cached !== undefined;
                    return (
                      <li
                        key={art.pmid}
                        className="text-sm border border-border rounded-lg p-4 hover:shadow-md transition-shadow"
                      >
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/${art.pmid}/`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-text-primary hover:text-accent hover:underline"
                        >
                          {art.title}
                        </a>
                        {(art.authors || art.journal || art.year) && (
                          <p className="text-text-tertiary mt-1 text-xs">
                            {[art.authors, art.journal, art.year].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        <p className="text-text-tertiary mt-1 text-xs">PMID: {art.pmid}</p>
                        {showAbstract && (
                          <div className="mt-3 mb-3">
                            <p className="text-text-secondary text-sm leading-relaxed">
                              {cached?.loading ? 'Loading abstract…' : (cached?.abstract ?? 'No abstract available.')}
                            </p>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2 mt-2">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAbstractPmid(isExpanded ? null : art.pmid)
                            }
                            className="text-xs text-accent hover:text-accent/80 font-medium"
                          >
                            {isExpanded ? 'Hide' : 'Read'} abstract
                          </button>
                          {art.doi && (
                            <a
                              href={`https://doi.org/${art.doi}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline"
                            >
                              Full text →
                            </a>
                          )}
                          <a
                            href={`https://pubmed.ncbi.nlm.nih.gov/${art.pmid}/`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-text-tertiary hover:text-text-secondary"
                          >
                            PubMed →
                          </a>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
          </div>

          {/* Right: Tabbed panel — Controls (presets, view) or AI Assistant */}
          <div className="flex flex-shrink-0 h-full">
            <div className="w-[48px] flex flex-col border-r border-border bg-surface/80">
              <button
                type="button"
                onClick={() => setRightPanelTab('controls')}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2 text-xs font-serif transition-colors',
                  rightPanelTab === 'controls'
                    ? 'bg-accent/15 text-accent border-l-2 border-accent'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-background/50'
                )}
                title="View & presets"
              >
                <Sliders className="w-5 h-5" />
                <span>View</span>
              </button>
              <button
                type="button"
                onClick={() => setRightPanelTab('ai')}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-3 px-2 text-xs font-serif transition-colors',
                  rightPanelTab === 'ai'
                    ? 'bg-accent/15 text-accent border-l-2 border-accent'
                    : 'text-text-tertiary hover:text-text-secondary hover:bg-background/50'
                )}
                title="AI Assistant"
              >
                <Sparkles className="w-5 h-5" />
                <span>AI</span>
              </button>
            </div>
            {rightPanelTab === 'controls' ? (
              <StructureControlPanel
                onPresetSelect={handlePresetSelect}
                onRepresentationChange={handleRepresentationChange}
                onColorSchemeChange={handleColorSchemeChange}
                onVisibilityToggle={handleVisibilityToggle}
                onQualityChange={handleQualityChange}
                onFileSelect={handleFileSelect}
                currentState={panelState}
                isLoading={isLoading}
                presetsEnabled={presetsEnabled}
                componentCounts={componentCounts}
              />
            ) : (
              <ResizableAIPanel
                currentStructure={metadata?.pdbId ?? ''}
                metadata={
                  metadata
                    ? {
                        title: rcsbInfo?.title ?? metadata.title,
                        organism: rcsbInfo?.organism ?? metadata.organism,
                        method: rcsbInfo?.method ?? undefined,
                        resolution: rcsbInfo?.resolution ?? metadata.resolution,
                      }
                    : null
                }
              />
            )}
          </div>
        </div>
      </div>
  );
}
