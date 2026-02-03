"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  Activity,
  BookOpen,
  Box,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Settings,
  X,
} from 'lucide-react';
import type {
  AnalysisConnection,
  ScreenIntegrationConfig,
  StructureOption,
  LiteratureCard as LiteratureCardType,
  StructureDetailMetadata,
  ResidueInfo,
  DomainInfo,
} from '@/lib/screenStructureTypes';
import { DEFAULT_INTEGRATION_CONFIG } from '@/lib/screenStructureTypes';
import { resolveStructuresForGene, fetchLiterature } from '@/lib/screenStructureApi';
import HitGeneCard from '@/components/screen-integration/HitGeneCard';
import LiteratureCard from '@/components/screen-integration/LiteratureCard';
import StructureInfoPanel from '@/components/screen-integration/StructureInfoPanel';
import type { GeneResult } from '@/lib/types';
import type { StructureSource } from '@/hooks/useStructureLoader';
import type { StructureMetadata } from '@/hooks/useStructureLoader';

const StructureViewerCanvas = dynamic(
  () => import('@/components/StructureViewerCanvas'),
  { ssr: false, loading: () => <div className="w-full h-64 bg-background rounded-lg animate-pulse" /> }
);

export interface ScreenIntegrationPanelProps {
  analysisId: string;
  analysisName: string;
  completedDate: string;
  totalGenes: number;
  significantHits: number;
  cellLine?: string;
  condition?: string;
  screenType?: 'knockout' | 'activation' | 'interference';
  /** Significant hit genes from analysis (e.g. allGenes filtered by FDR) */
  hitGenes: GeneResult[];
  /** Initial config; can be overridden by user and persisted in localStorage */
  initialConfig?: Partial<ScreenIntegrationConfig>;
  /** When user selects a structure to load */
  onLoadStructure?: (source: StructureSource) => void;
  /** When structure is loaded in embedded viewer */
  onStructureLoaded?: (metadata: StructureMetadata) => void;
  /** Currently loaded structure metadata (for Structure Info tab) */
  loadedStructureMetadata?: StructureDetailMetadata | null;
  /** Selected residue from viewer click (if supported) */
  selectedResidue?: ResidueInfo | null;
  /** Domains for loaded structure (e.g. from gene info) */
  domains?: DomainInfo[];
  /** Panel width in px */
  width?: number;
  onClose?: () => void;
  className?: string;
}

type TabId = 'analysis' | 'structure' | 'literature';

export default function ScreenIntegrationPanel({
  analysisId,
  analysisName,
  completedDate,
  totalGenes,
  significantHits,
  cellLine = '',
  condition = '',
  screenType = 'knockout',
  hitGenes,
  initialConfig,
  onLoadStructure,
  onStructureLoaded,
  loadedStructureMetadata = null,
  selectedResidue = null,
  domains = [],
  width = 360,
  onClose,
  className = '',
}: ScreenIntegrationPanelProps) {
  const [config, setConfig] = useState<ScreenIntegrationConfig>(() => ({
    ...DEFAULT_INTEGRATION_CONFIG,
    ...initialConfig,
    panelWidth: width,
  }));
  const [activeTab, setActiveTab] = useState<TabId>('analysis');
  const [structureMappings, setStructureMappings] = useState<Map<string, StructureOption[]>>(new Map());
  const [loadingGenes, setLoadingGenes] = useState<Set<string>>(new Set());
  const [structureSource, setStructureSource] = useState<StructureSource | undefined>();
  const [localStructureMetadata, setLocalStructureMetadata] = useState<StructureMetadata | null>(null);
  const [literatureByGene, setLiteratureByGene] = useState<Map<string, LiteratureCardType[]>>(new Map());
  const [literatureLoading, setLiteratureLoading] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  const connection: AnalysisConnection = useMemo(
    () => ({
      analysisId,
      analysisName,
      screenType,
      completedDate,
      totalGenes,
      significantHits,
      cellLine,
      condition,
    }),
    [
      analysisId,
      analysisName,
      screenType,
      completedDate,
      totalGenes,
      significantHits,
      cellLine,
      condition,
    ]
  );

  const topHits = useMemo(
    () =>
      [...hitGenes]
        .filter((g) => g.fdr < config.fdrThreshold && Math.abs(g.logFoldChange) >= config.lfcThreshold)
        .sort((a, b) => Math.abs(b.logFoldChange) - Math.abs(a.logFoldChange))
        .slice(0, config.maxHitsToShow),
    [hitGenes, config.fdrThreshold, config.lfcThreshold, config.maxHitsToShow]
  );

  const fetchStructuresForGene = useCallback(async (gene: string) => {
    setLoadingGenes((prev) => new Set(prev).add(gene));
    try {
      const options = await resolveStructuresForGene(gene, {
        useCache: true,
        preferExperimental: config.showExperimentalFirst,
      });
      setStructureMappings((prev) => {
        const next = new Map(prev);
        next.set(gene, options);
        return next;
      });
    } catch (e) {
      console.error('Structure resolve error for', gene, e);
      setStructureMappings((prev) => {
        const next = new Map(prev);
        next.set(gene, []);
        return next;
      });
    } finally {
      setLoadingGenes((prev) => {
        const next = new Set(prev);
        next.delete(gene);
        return next;
      });
    }
  }, [config.showExperimentalFirst]);

  useEffect(() => {
    topHits.forEach((g) => {
      if (!structureMappings.has(g.gene)) {
        fetchStructuresForGene(g.gene);
      }
    });
  }, [topHits.map((g) => g.gene).join(','), fetchStructuresForGene]);

  const handleLoadStructure = useCallback(
    (option: StructureOption) => {
      const source: StructureSource =
        option.type === 'pdb'
          ? { type: 'pdb', identifier: option.identifier }
          : { type: 'alphafold', identifier: option.identifier };
      setStructureSource(source);
      onLoadStructure?.(source);
    },
    [onLoadStructure]
  );

  const handleStructureLoaded = useCallback(
    (meta: StructureMetadata) => {
      setLocalStructureMetadata(meta);
      onStructureLoaded?.(meta);
    },
    [onStructureLoaded]
  );

  const loadLiterature = useCallback(async (gene: string) => {
    if (literatureByGene.has(gene)) return;
    setLiteratureLoading(gene);
    try {
      const articles = await fetchLiterature(gene, 10);
      setLiteratureByGene((prev) => {
        const next = new Map(prev);
        next.set(gene, articles as LiteratureCardType[]);
        return next;
      });
    } finally {
      setLiteratureLoading(null);
    }
  }, [literatureByGene]);

  useEffect(() => {
    if (activeTab === 'literature' && topHits.length > 0 && literatureByGene.size === 0) {
      loadLiterature(topHits[0].gene);
    }
  }, [activeTab, topHits, literatureByGene.size, loadLiterature]);

  const structureMetaForInfo = loadedStructureMetadata ?? (localStructureMetadata ? {
    pdbId: localStructureMetadata.pdbId,
    title: localStructureMetadata.title,
    organism: localStructureMetadata.organism ?? '',
    method: 'X-ray crystallography' as const,
    resolution: localStructureMetadata.resolution,
    depositionDate: localStructureMetadata.depositionDate ?? undefined,
    chains: Array.from({ length: localStructureMetadata.chainCount }, (_, i) => ({
      id: String.fromCharCode(65 + i),
      type: 'Protein',
      length: Math.floor(localStructureMetadata.residueCount / localStructureMetadata.chainCount),
    })),
    totalAtoms: 0,
  } : null);

  const handleExportReport = useCallback(() => {
    const lines: string[] = [
      `SplicR Hit Structure Report`,
      `Analysis: ${analysisName}`,
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      ``,
      `Top ${Math.min(config.exportTopN, topHits.length)} screening hits`,
      `---`,
    ];
    topHits.slice(0, config.exportTopN).forEach((g, i) => {
      lines.push(`${i + 1}. ${g.gene}\tLFC: ${g.logFoldChange.toFixed(2)}\tFDR: ${g.fdr.toFixed(4)}`);
      const structs = structureMappings.get(g.gene) ?? [];
      structs.forEach((s) => {
        if (s.type === 'pdb') lines.push(`   PDB: ${s.identifier}`);
        else lines.push(`   AlphaFold: ${s.identifier}`);
      });
      lines.push('');
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `splicr-hit-structures-${analysisId.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [analysisId, analysisName, config.exportTopN, topHits, structureMappings]);

  const tabs: { id: TabId; label: string; icon: typeof Activity }[] = [
    { id: 'analysis', label: 'Analysis', icon: Activity },
    { id: 'structure', label: 'Structure Info', icon: Box },
    { id: 'literature', label: 'Literature', icon: BookOpen },
  ];

  return (
    <aside
      className={`flex flex-col bg-surface border-l border-border shadow-lg overflow-hidden ${className}`}
      style={{ width: config.panelWidth }}
    >
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-serif font-semibold text-text-primary">Screen → Structure</h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowConfig((b) => !b)}
            className="p-2 rounded-lg hover:bg-background text-text-tertiary"
            aria-label="Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-background text-text-tertiary"
              aria-label="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {showConfig && (
        <div className="shrink-0 px-4 py-3 border-b border-border bg-background/50 space-y-3">
          <h3 className="text-xs font-semibold text-text-tertiary uppercase">Customize</h3>
          <label className="block text-xs text-text-secondary">
            Panel width
            <input
              type="range"
              min={320}
              max={480}
              step={8}
              value={config.panelWidth}
              onChange={(e) => setConfig((c) => ({ ...c, panelWidth: Number(e.target.value) }))}
              className="block w-full mt-1"
            />
            {config.panelWidth}px
          </label>
          <label className="block text-xs text-text-secondary">
            FDR threshold
            <input
              type="number"
              min={0.001}
              max={0.2}
              step={0.01}
              value={config.fdrThreshold}
              onChange={(e) => setConfig((c) => ({ ...c, fdrThreshold: Number(e.target.value) }))}
              className="block w-full mt-1 rounded border border-border bg-surface px-2 py-1"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Max hits to show
            <input
              type="number"
              min={5}
              max={50}
              value={config.maxHitsToShow}
              onChange={(e) => setConfig((c) => ({ ...c, maxHitsToShow: Number(e.target.value) }))}
              className="block w-full mt-1 rounded border border-border bg-surface px-2 py-1"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={config.showExperimentalFirst}
              onChange={(e) => setConfig((c) => ({ ...c, showExperimentalFirst: e.target.checked }))}
            />
            Prefer experimental structures
          </label>
          <label className="block text-xs text-text-secondary">
            Viewer representation
            <select
              value={config.viewerRepresentation}
              onChange={(e) => setConfig((c) => ({ ...c, viewerRepresentation: e.target.value as ScreenIntegrationConfig['viewerRepresentation'] }))}
              className="block w-full mt-1 rounded border border-border bg-surface px-2 py-1"
            >
              <option value="cartoon">Cartoon</option>
              <option value="surface">Surface</option>
              <option value="ribbon">Ribbon</option>
              <option value="ball+stick">Ball + Stick</option>
            </select>
          </label>
          <label className="block text-xs text-text-secondary">
            Viewer color scheme
            <select
              value={config.viewerColorScheme}
              onChange={(e) => setConfig((c) => ({ ...c, viewerColorScheme: e.target.value as ScreenIntegrationConfig['viewerColorScheme'] }))}
              className="block w-full mt-1 rounded border border-border bg-surface px-2 py-1"
            >
              <option value="chainid">Chain ID</option>
              <option value="element">Element</option>
              <option value="residueindex">Residue index</option>
              <option value="sstruc">Secondary structure</option>
            </select>
          </label>
          <label className="block text-xs text-text-secondary">
            Export top N hits
            <input
              type="number"
              min={5}
              max={50}
              value={config.exportTopN}
              onChange={(e) => setConfig((c) => ({ ...c, exportTopN: Number(e.target.value) }))}
              className="block w-full mt-1 rounded border border-border bg-surface px-2 py-1"
            />
          </label>
          <button
            type="button"
            onClick={handleExportReport}
            className="inline-flex items-center gap-2 text-xs font-medium text-accent hover:underline"
          >
            <Download className="w-4 h-4" />
            Generate Hit Structure Report
          </button>
        </div>
      )}

      <div className="shrink-0 flex border-b border-border">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-accent border-b-2 border-accent bg-background/30'
                  : 'text-text-tertiary hover:text-text-primary hover:bg-background/20'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {activeTab === 'analysis' && (
          <div className="p-4 space-y-4">
            <div className="bg-background/50 rounded-lg border border-border p-4">
              <h3 className="font-serif font-semibold text-text-primary">{connection.analysisName}</h3>
              <p className="text-xs text-text-tertiary mt-1">
                {connection.significantHits} hits | {connection.cellLine || '—'} | {connection.completedDate.slice(0, 7)}
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  <Check className="w-3.5 h-3.5" />
                  Analysis complete
                </span>
              </div>
              <Link
                href={`/results/${analysisId}`}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline mt-2"
              >
                View full analysis
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>

            <div>
              <h4 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide mb-2">
                Top hits with structures
              </h4>
              <div className="space-y-3">
                {topHits.map((gene) => (
                  <HitGeneCard
                    key={gene.gene}
                    gene={gene.gene}
                    rank={gene.rank}
                    logFoldChange={gene.logFoldChange}
                    fdr={gene.fdr}
                    pValue={gene.pValue}
                    structures={structureMappings.get(gene.gene) ?? []}
                    loading={loadingGenes.has(gene.gene)}
                    onLoadStructure={handleLoadStructure}
                    onViewIn3D={() => {
                      const opts = structureMappings.get(gene.gene);
                      if (opts?.[0]) handleLoadStructure(opts[0]);
                    }}
                    fdrHighConfidence={0.001}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'structure' && (
          <div className="p-4 space-y-4">
            {structureSource && (
              <div className="rounded-lg overflow-hidden border border-border" style={{ minHeight: 280 }}>
                <StructureViewerCanvas
                  structureSource={structureSource}
                  defaultRepresentation={config.viewerRepresentation}
                  defaultColorScheme={config.viewerColorScheme}
                  onStructureLoaded={handleStructureLoaded}
                />
              </div>
            )}
            <StructureInfoPanel
              metadata={structureMetaForInfo}
              selectedResidue={selectedResidue}
              domains={domains}
            />
          </div>
        )}

        {activeTab === 'literature' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap gap-1">
              {topHits.slice(0, 10).map((g) => (
                <button
                  key={g.gene}
                  type="button"
                  onClick={() => loadLiterature(g.gene)}
                  disabled={literatureLoading === g.gene}
                  className="px-2 py-1 rounded text-xs font-medium bg-background border border-border text-text-secondary hover:bg-accent/20 hover:text-text-primary disabled:opacity-50"
                >
                  {g.gene}
                </button>
              ))}
            </div>
            {literatureLoading && (
              <p className="text-sm text-text-tertiary">Loading papers for {literatureLoading}…</p>
            )}
            <div className="space-y-3">
              {Array.from(literatureByGene.entries()).map(([gene, articles]) => (
                <div key={gene}>
                  <h4 className="text-xs font-semibold text-text-tertiary mb-2">{gene}</h4>
                  {articles.map((art, i) => (
                    <LiteratureCard key={art.pmid ?? i} article={art} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
