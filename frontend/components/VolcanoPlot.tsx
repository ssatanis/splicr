'use client';

import { useRef, useState, useCallback } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Search, Download, ChevronDown, ExternalLink } from 'lucide-react';
import { exportElementAsPNG, exportSVGAsFile, exportVolcanoAsInteractiveHTML } from '@/lib/chartExportUtils';
import type { VolcanoDataPoint } from '@/lib/types';

// Curated gene sets for coloring (publication-standard references)
const ONCOGENES = new Set(['KRAS', 'EGFR', 'MYC', 'BRAF', 'PIK3CA', 'AKT1', 'ERBB2', 'MET', 'RAF1', 'NRAS', 'HRAS', 'KIT', 'FLT3', 'JAK2', 'ABL1', 'BCR', 'MDM2', 'CCND1', 'CDK4', 'WNT1']);
const TUMOR_SUPPRESSORS = new Set(['TP53', 'PTEN', 'RB1', 'BRCA1', 'BRCA2', 'APC', 'VHL', 'CDKN2A', 'CDKN2B', 'NF1', 'NF2', 'SMAD4', 'TSC1', 'TSC2', 'ATM', 'CHEK2', 'MLH1', 'MSH2', 'CDH1', 'STK11']);
const ESSENTIAL_GENES = new Set(['RPL5', 'RPL11', 'RPS3', 'RPS7', 'NOP58', 'NOP56', 'DKC1', 'U2AF1', 'SRSF2', 'SF3B1', 'PRPF8', 'SNRNP200', 'DDX41', 'EIF4A1', 'EIF3D', 'RPS14', 'RPL15', 'POLR2A', 'MYC', 'TP53']);

type ColorByOption = 'significance' | 'oncogenes' | 'tumorSuppressors' | 'essential';

interface VolcanoPlotProps {
  data?: VolcanoDataPoint[] | null;
  fdrThreshold?: number;
  lfcThreshold?: number;
  onGeneHighlight?: (gene: string | null) => void;
}

function getGeneSetColor(entry: VolcanoDataPoint, colorBy: ColorByOption): string {
  const g = entry.gene.toUpperCase();
  if (colorBy === 'oncogenes' && ONCOGENES.has(g)) return '#EF4444';   // red
  if (colorBy === 'tumorSuppressors' && TUMOR_SUPPRESSORS.has(g)) return '#3B82F6'; // blue
  if (colorBy === 'essential' && ESSENTIAL_GENES.has(g)) return '#8B5CF6';         // purple
  if (entry.isSignificant) return '#6ABF36'; // accent green
  return '#9B9B9B';
}

export default function VolcanoPlot({
  data,
  fdrThreshold = 0.05,
  lfcThreshold = 1.0,
  onGeneHighlight,
}: VolcanoPlotProps) {
  const volcanoData = data?.length ? data : generateMockVolcanoData();
  const negLog10Threshold = -Math.log10(fdrThreshold);
  const containerRef = useRef<HTMLDivElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedGene, setHighlightedGene] = useState<string | null>(null);
  const [colorBy, setColorBy] = useState<ColorByOption>('significance');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; gene: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const searchLower = searchQuery.trim().toUpperCase();
  const highlightedSet = highlightedGene ? new Set([highlightedGene]) : new Set<string>();
  const searchMatchSet = searchLower
    ? new Set(volcanoData.filter((d) => d.gene.toUpperCase().includes(searchLower)).map((d) => d.gene))
    : new Set<string>();

  const handleExportPNG = useCallback(async () => {
    if (!containerRef.current) return;
    setExportOpen(false);
    await exportElementAsPNG(containerRef.current, `splicr-volcano-${Date.now()}.png`);
  }, []);

  const handleExportSVG = useCallback(() => {
    setExportOpen(false);
    const svg = containerRef.current?.querySelector('svg');
    exportSVGAsFile(svg ?? null, `splicr-volcano-${Date.now()}.svg`);
  }, []);

  const handleExportHTML = useCallback(() => {
    setExportOpen(false);
    exportVolcanoAsInteractiveHTML(volcanoData, `splicr-volcano-${Date.now()}.html`, {
      fdrThreshold,
      lfcThreshold,
    });
  }, [volcanoData, fdrThreshold, lfcThreshold]);

  const handleGeneClick = useCallback(
    (entry: VolcanoDataPoint) => {
      const next = highlightedGene === entry.gene ? null : entry.gene;
      setHighlightedGene(next);
      onGeneHighlight?.(next ?? null);
    },
    [highlightedGene, onGeneHighlight]
  );

  const openInPathway = (gene: string) => {
    window.open(`https://www.genome.jp/kegg-bin/show_pathway?hsa04012&query=${gene}`, '_blank');
    setContextMenu(null);
  };
  const openInPubMed = (gene: string) => {
    window.open(`https://pubmed.ncbi.nlm.nih.gov/?term=${gene}+CRISPR`, '_blank');
    setContextMenu(null);
  };
  const openInDepMap = (gene: string) => {
    window.open(`https://depmap.org/portal/gene/${gene}?tab=overview`, '_blank');
    setContextMenu(null);
  };
  const openInGeneCards = (gene: string) => {
    window.open(`https://www.genecards.org/cgi-bin/carddisp.pl?gene=${gene}`, '_blank');
    setContextMenu(null);
  };

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary">Volcano Plot</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Find gene (e.g. TP53)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary w-48 focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <div className="relative">
            <select
              value={colorBy}
              onChange={(e) => setColorBy(e.target.value as ColorByOption)}
              className="appearance-none pl-4 pr-8 py-2 rounded-lg border border-border bg-background text-text-primary cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent/50"
            >
              <option value="significance">Color by significance</option>
              <option value="oncogenes">Oncogenes</option>
              <option value="tumorSuppressors">Tumor suppressors</option>
              <option value="essential">Essential genes</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary pointer-events-none" />
          </div>
          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 transition-colors"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 py-2 bg-surface border border-border rounded-lg shadow-elevated z-20 min-w-[160px]">
                  <button onClick={handleExportPNG} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                    PNG
                  </button>
                  <button onClick={handleExportSVG} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                    SVG
                  </button>
                  <button onClick={handleExportHTML} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                    Interactive HTML
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="h-[520px]" onContextMenu={(e) => e.preventDefault()}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 20, right: 20, bottom: 60, left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E8E6E3" />
            <XAxis
              type="number"
              dataKey="log2FC"
              name="Log₂ Fold Change"
              domain={['auto', 'auto']}
              label={{
                value: 'Log₂ Fold Change',
                position: 'insideBottom',
                offset: -10,
                style: { fontFamily: 'Instrument Serif' },
              }}
            />
            <YAxis
              type="number"
              dataKey="negLog10P"
              name="-Log₁₀(P-value)"
              label={{
                value: '-Log₁₀(P-value)',
                angle: -90,
                position: 'insideLeft',
                style: { fontFamily: 'Instrument Serif' },
              }}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
            <ReferenceLine y={negLog10Threshold} stroke="#6ABF36" strokeWidth={2} strokeDasharray="5 5" />
            <ReferenceLine x={-lfcThreshold} stroke="#6ABF36" strokeWidth={2} strokeDasharray="5 5" />
            <ReferenceLine x={lfcThreshold} stroke="#6ABF36" strokeWidth={2} strokeDasharray="5 5" />
            <Scatter
              name="Genes"
              data={volcanoData}
              fill="#8884d8"
              onClick={(e: { payload?: VolcanoDataPoint }) => e?.payload && handleGeneClick(e.payload)}
              isAnimationActive={true}
            >
              {volcanoData.map((entry, index) => {
                const isHighlight = highlightedSet.has(entry.gene) || searchMatchSet.has(entry.gene);
                const color = getGeneSetColor(entry, colorBy);
                return (
                  <Cell
                    key={`cell-${index}`}
                    fill={color}
                    opacity={isHighlight ? 1 : entry.isSignificant ? 1 : 0.5}
                    stroke={isHighlight ? '#1A1A1A' : 'none'}
                    strokeWidth={isHighlight ? 2 : 0}
                    style={{ cursor: 'pointer' }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, gene: entry.gene });
                    }}
                  />
                );
              })}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-40 bg-surface border border-border rounded-lg shadow-elevated py-1 min-w-[200px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => openInPathway(contextMenu.gene)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-background flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> Show in pathway
            </button>
            <button
              onClick={() => openInPubMed(contextMenu.gene)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-background flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> View publications
            </button>
            <button
              onClick={() => openInDepMap(contextMenu.gene)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-background flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> Compare to DepMap
            </button>
            <button
              onClick={() => openInGeneCards(contextMenu.gene)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-background flex items-center gap-2"
            >
              <ExternalLink className="w-4 h-4" /> View in GeneCards
            </button>
          </div>
        </>
      )}

      <div className="mt-4 text-sm text-text-secondary flex flex-wrap gap-6 justify-center items-center">
        {colorBy === 'significance' && (
          <>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-[#6ABF36]" />
              <span>Significant (FDR &lt; {fdrThreshold})</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-400" />
              <span>Not significant</span>
            </div>
          </>
        )}
        {colorBy === 'oncogenes' && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#EF4444]" />
            <span>Oncogenes</span>
          </div>
        )}
        {colorBy === 'tumorSuppressors' && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#3B82F6]" />
            <span>Tumor suppressors</span>
          </div>
        )}
        {colorBy === 'essential' && (
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#8B5CF6]" />
            <span>Essential genes</span>
          </div>
        )}
        {(searchMatchSet.size > 0 || highlightedGene) && (
          <span className="text-accent">
            {searchMatchSet.size > 0 ? `${searchMatchSet.size} gene(s) match search` : ''}
            {highlightedGene && ` • Clicked: ${highlightedGene}`}
          </span>
        )}
      </div>
    </div>
  );
}

const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: VolcanoDataPoint }> }) => {
  if (!active || !payload?.length) return null;
  const data = payload[0].payload;
  return (
    <div className="bg-surface p-4 rounded-lg shadow-lg border border-border">
      <p className="font-bold text-lg text-text-primary">{data.gene}</p>
      <p className="text-sm text-text-secondary">Log₂ FC: {data.log2FC.toFixed(3)}</p>
      <p className="text-sm text-text-secondary">P-value: {Math.pow(10, -data.negLog10P).toExponential(2)}</p>
      <p className="text-sm text-text-secondary">FDR: {data.fdr.toFixed(4)}</p>
    </div>
  );
};

function generateMockVolcanoData(): VolcanoDataPoint[] {
  const genes = [
    'TP53', 'KRAS', 'EGFR', 'MYC', 'BRCA1', 'BRCA2', 'APC', 'PTEN', 'RB1', 'VHL',
    'BRAF', 'PIK3CA', 'AKT1', 'ERBB2', 'MET', 'NRAS', 'CDKN2A', 'NF1', 'ATM',
  ];
  const data: VolcanoDataPoint[] = [];
  genes.forEach((gene) => {
    const log2FC = (Math.random() - 0.5) * 4;
    const negLog10P = 2 + Math.random() * 4;
    const fdr = Math.pow(10, -negLog10P + 0.5);
    data.push({
      gene,
      log2FC,
      negLog10P,
      fdr,
      isSignificant: fdr < 0.05 && Math.abs(log2FC) > 1,
    });
  });
  for (let i = 0; i < 400; i++) {
    const log2FC = (Math.random() - 0.5) * 6;
    const negLog10P = Math.random() * 3;
    const fdr = Math.pow(10, -negLog10P + 0.5);
    data.push({
      gene: `GENE${i}`,
      log2FC,
      negLog10P,
      fdr,
      isSignificant: false,
    });
  }
  return data;
}
