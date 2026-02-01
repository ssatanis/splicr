'use client';

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Download, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { exportElementAsPNG } from '@/lib/chartExportUtils';
import type { GeneResult } from '@/lib/types';

const ForceGraph2D = dynamic(() => import('react-force-graph').then((mod) => mod.ForceGraph2D), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="w-10 h-10 animate-spin text-accent" />
    </div>
  ),
});

const STRING_API = 'https://string-db.org/api';
const SPECIES = 9606; // Human

interface NodeData {
  id: string;
  name: string;
  log2FC?: number;
  fdr?: number;
  negLog10Fdr?: number;
}

interface LinkData {
  source: string;
  target: string;
  score?: number;
}

interface GraphData {
  nodes: NodeData[];
  links: LinkData[];
}

interface GeneNetworkVisualizationProps {
  /** Significant genes with log2FC and FDR (e.g. top depleted + enriched) */
  genes: GeneResult[];
  /** Max number of genes to send to STRING (API limit ~200, use ~50 for speed) */
  maxGenes?: number;
  /** Minimum STRING combined score (0–1000, default 400 = medium confidence) */
  requiredScore?: number;
  height?: number;
}

async function fetchStringNetwork(
  geneNames: string[],
  requiredScore: number
): Promise<{ nodes: Set<string>; edges: Array<{ a: string; b: string; score: number }> }> {
  const identifiers = geneNames.slice(0, 100).join('\r\n');
  const url = `${STRING_API}/tsv/network?identifiers=${encodeURIComponent(identifiers)}&species=${SPECIES}&required_score=${requiredScore}&caller_identity=splicr.app`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('STRING API request failed');
  const text = await res.text();
  const lines = text.trim().split('\n');
  const header = lines[0]?.toLowerCase() ?? '';
  const nameAIdx = header.includes('preferredname_a') ? header.split('\t').indexOf('preferredname_a') : 2;
  const nameBIdx = header.includes('preferredname_b') ? header.split('\t').indexOf('preferredname_b') : 3;
  const scoreIdx = header.includes('score') ? header.split('\t').indexOf('score') : 5;
  const nodes = new Set<string>();
  const edges: Array<{ a: string; b: string; score: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    const a = cols[nameAIdx]?.trim() ?? '';
    const b = cols[nameBIdx]?.trim() ?? '';
    const score = parseFloat(cols[scoreIdx] ?? '0') || 0;
    if (a && b) {
      nodes.add(a);
      nodes.add(b);
      edges.push({ a, b, score });
    }
  }
  return { nodes, edges };
}

function buildGraphData(
  genes: GeneResult[],
  stringNodes: Set<string>,
  stringEdges: Array<{ a: string; b: string; score: number }>,
  geneMap: Map<string, GeneResult>
): GraphData {
  const nodeList = Array.from(stringNodes);
  const nodes: NodeData[] = nodeList.map((id) => {
    const g = geneMap.get(id.toUpperCase()) ?? geneMap.get(id);
    const log2FC = g?.logFoldChange;
    const fdr = g?.fdr ?? 1;
    const negLog10Fdr = fdr > 0 ? -Math.log10(fdr) : 0;
    return {
      id,
      name: id,
      log2FC,
      fdr,
      negLog10Fdr,
    };
  });
  const linkSet = new Set<string>();
  const links: LinkData[] = [];
  for (const e of stringEdges) {
    if (!stringNodes.has(e.a) || !stringNodes.has(e.b)) continue;
    const key = [e.a, e.b].sort().join('|');
    if (linkSet.has(key)) continue;
    linkSet.add(key);
    links.push({ source: e.a, target: e.b, score: e.score });
  }
  return { nodes, links };
}

export default function GeneNetworkVisualization({
  genes,
  maxGenes = 50,
  requiredScore = 400,
  height = 560,
}: GeneNetworkVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [highlightNode, setHighlightNode] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  // Ensure component only renders on client
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const geneMap = useMemo(() => {
    const m = new Map<string, GeneResult>();
    genes.forEach((g) => {
      m.set(g.gene.toUpperCase(), g);
      m.set(g.gene, g);
    });
    return m;
  }, [genes]);

  const geneNames = useMemo(
    () => genes.slice(0, maxGenes).map((g) => g.gene),
    [genes, maxGenes]
  );

  const loadNetwork = useCallback(async () => {
    const names = geneNames;
    if (names.length === 0) {
      setGraphData({ nodes: [], links: [] });
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { nodes: stringNodes, edges: stringEdges } = await fetchStringNetwork(
        names,
        requiredScore
      );
      const data = buildGraphData(genes, stringNodes, stringEdges, geneMap);
      setGraphData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load STRING network');
      setGraphData(null);
    } finally {
      setLoading(false);
    }
  }, [geneNames, requiredScore, genes, geneMap]);

  useEffect(() => {
    loadNetwork();
  }, [loadNetwork]);

  const nodeColor = useCallback((node: NodeData) => {
    const lfc = node.log2FC;
    if (lfc == null) return '#9B9B9B';
    if (lfc < -0.5) return '#EF4444'; // depleted
    if (lfc > 0.5) return '#10B981';  // enriched
    return '#9B9B9B';
  }, []);

  const nodeVal = useCallback((node: NodeData) => {
    const n = node.negLog10Fdr ?? 0;
    return Math.max(3, Math.min(20, 2 + n * 1.5));
  }, []);

  const handleExportPNG = async () => {
    setExportOpen(false);
    if (!containerRef.current) return;
    await exportElementAsPNG(containerRef.current, `splicr-network-${Date.now()}.png`);
  };

  const openInPathway = (gene: string) => {
    window.open(`https://www.genome.jp/kegg-bin/show_pathway?hsa04012&query=${gene}`, '_blank');
  };
  const openInGeneCards = (gene: string) => {
    window.open(`https://www.genecards.org/cgi-bin/carddisp.pl?gene=${gene}`, '_blank');
  };
  const openInDepMap = (gene: string) => {
    window.open(`https://depmap.org/portal/gene/${gene}?tab=overview`, '_blank');
  };
  const openInString = (gene: string) => {
    window.open(`https://string-db.org/cgi/network?identifiers=${gene}&species=9606`, '_blank');
  };

  const searchLower = search.trim().toLowerCase();
  const highlightedIds = useMemo(() => {
    if (!searchLower || !graphData) return new Set<string>();
    return new Set(
      graphData.nodes
        .filter((n) => n.name.toLowerCase().includes(searchLower))
        .map((n) => n.id)
    );
  }, [searchLower, graphData]);

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-6 border border-border shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-2xl font-serif text-text-primary">Gene interaction network</h3>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Find gene"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 pr-4 py-2 rounded-lg border border-border bg-background text-text-primary w-40 focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <button
            onClick={() => loadNetwork()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Refresh
          </button>
          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
            >
              <Download className="w-4 h-4" /> Export
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 py-2 bg-surface border border-border rounded-lg shadow-elevated z-20 min-w-[120px]">
                  <button onClick={handleExportPNG} className="w-full px-4 py-2 text-left hover:bg-background text-sm">
                    PNG
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-lg bg-error/10 text-error text-sm">
          {error}. Check gene symbols and try again.
        </div>
      )}

      <div style={{ height }} className="rounded-lg overflow-hidden bg-background border border-border">
        {loading && !graphData && (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="w-10 h-10 animate-spin text-accent" />
          </div>
        )}
        {isMounted && graphData && graphData.nodes.length > 0 && !loading && (
          <ForceGraph2D
            graphData={graphData}
            nodeId="id"
            nodeLabel={(node: unknown) => {
              const n = node as NodeData;
              const lfc = n.log2FC != null ? `Log₂FC: ${n.log2FC.toFixed(2)}` : '';
              const fdr = n.fdr != null ? `FDR: ${n.fdr.toExponential(2)}` : '';
              return `${n.name}${lfc ? ` | ${lfc}` : ''}${fdr ? ` | ${fdr}` : ''}`;
            }}
            nodeColor={(node: unknown) => {
              const n = node as NodeData;
              if (highlightedIds.has(n.id) || n.id === highlightNode) return '#6ABF36';
              return nodeColor(n);
            }}
            nodeVal={(node: unknown) => nodeVal(node as NodeData)}
            linkColor="#E8E6E3"
            linkWidth={1}
            linkDirectionalParticles={0}
            onNodeClick={(node: unknown) => setHighlightNode((prev) => (prev === (node as NodeData).id ? null : (node as NodeData).id))}
            onNodeRightClick={(node: unknown, event: { preventDefault: () => void; clientX: number; clientY: number }) => {
              event.preventDefault();
              const g = (node as NodeData).name;
              const menu = document.createElement('div');
              menu.className = 'fixed z-50 bg-surface border border-border rounded-lg shadow-elevated py-1 min-w-[180px]';
              menu.style.left = `${event.clientX}px`;
              menu.style.top = `${event.clientY}px`;
              const items = [
                { label: 'Show in pathway', fn: () => openInPathway(g) },
                { label: 'View in GeneCards', fn: () => openInGeneCards(g) },
                { label: 'Compare to DepMap', fn: () => openInDepMap(g) },
                { label: 'Open in STRING', fn: () => openInString(g) },
              ];
              items.forEach(({ label, fn }) => {
                const b = document.createElement('button');
                b.className = 'w-full px-4 py-2 text-left text-sm hover:bg-background flex items-center gap-2';
                b.textContent = label;
                b.onclick = () => {
                  fn();
                  menu.remove();
                  document.removeEventListener('click', close);
                };
                menu.appendChild(b);
              });
              const close = () => {
                menu.remove();
                document.removeEventListener('click', close);
              };
              document.body.appendChild(menu);
              setTimeout(() => document.addEventListener('click', close), 0);
            }}
          />
        )}
        {graphData && graphData.nodes.length === 0 && !loading && (
          <div className="h-full flex items-center justify-center text-text-tertiary">
            No interactions found for the selected genes. Try increasing the gene set or lowering the score threshold.
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-6 text-sm text-text-secondary">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#EF4444]" /> Depleted
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#10B981]" /> Enriched
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#9B9B9B]" /> Other / STRING
        </div>
        <span>Node size ∝ -log₁₀(FDR). Data: STRING DB (human).</span>
      </div>
    </div>
  );
}
