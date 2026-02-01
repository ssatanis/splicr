'use client';

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { Download, Loader2, RefreshCw, Search } from 'lucide-react';
import { exportElementAsPNG } from '@/lib/chartExportUtils';
import type { GeneResult } from '@/lib/types';

// Use force-graph (2D only) directly to avoid loading react-force-graph's VR/AR modules,
// which require global AFRAME and cause "AFRAME is not defined" in Next.js.
type ForceGraphInstance = { _destructor: () => void };

const STRING_API = 'https://string-db.org/api';
const SPECIES = 9606; // Human

interface NodeData {
  id: string;
  name: string;
  log2FC?: number;
  fdr?: number;
  negLog10Fdr?: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
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
  /** Analysis/screen name used for export title: "[analysisName] Gene Interaction Network" */
  analysisName?: string;
}

const DEFAULT_EXPORT_TITLE = '[Screen Analysis] Gene Interaction Network';

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
  analysisName,
}: GeneNetworkVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const graphInstanceRef = useRef<ForceGraphInstance | null>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [highlightNode, setHighlightNode] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportTitle, setExportTitle] = useState('');
  const [exportIncludeLabels, setExportIncludeLabels] = useState(false);
  const [exportPadding, setExportPadding] = useState(20);
  const [exportScale, setExportScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const showLabelsRef = useRef(false);

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

  const defaultExportTitle = `[${analysisName ?? 'Screen Analysis'}] Gene Interaction Network`;

  const handleOpenExportModal = () => {
    setExportTitle(defaultExportTitle);
    setExportModalOpen(true);
  };

  const handleExportWithOptions = async () => {
    const el = graphContainerRef.current;
    const instance = graphInstanceRef.current;
    if (!el || !instance) return;
    setExporting(true);
    try {
      showLabelsRef.current = exportIncludeLabels;
      const zoomToFit = (instance as unknown as { zoomToFit?: (d?: number, p?: number) => void }).zoomToFit;
      if (typeof zoomToFit === 'function') {
        zoomToFit(0, exportPadding);
      }
      await new Promise<void>((r) => {
        requestAnimationFrame(() => requestAnimationFrame(() => r()));
      });
      const raw = (exportTitle.trim() || defaultExportTitle).replace(/\s+/g, ' ').trim();
      const base = raw.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'gene-interaction-network';
      await exportElementAsPNG(el, `${base}.png`, { scale: exportScale });
    } finally {
      showLabelsRef.current = false;
      setExporting(false);
      setExportModalOpen(false);
    }
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

  // Refs so nodeColor (called every frame) always sees latest highlight state without recreating the graph
  const highlightedIdsRef = useRef(highlightedIds);
  const highlightNodeRef = useRef(highlightNode);
  highlightedIdsRef.current = highlightedIds;
  highlightNodeRef.current = highlightNode;

  // Mount force-graph (2D only) when we have data; use force-graph package to avoid AFRAME/VR/AR
  useEffect(() => {
    const container = graphContainerRef.current;
    if (!isMounted || !graphData || graphData.nodes.length === 0 || loading || !container) {
      if (graphInstanceRef.current) {
        graphInstanceRef.current._destructor();
        graphInstanceRef.current = null;
      }
      return;
    }
    let mounted = true;
    import('force-graph').then((mod) => {
      if (!mounted || !container) return;
      // force-graph default export is a Kapsule factory: call with () then (element)
      const ForceGraph = mod.default as unknown as () => (el: HTMLElement) => ForceGraphInstance;
      const instance = ForceGraph()(container);
      graphInstanceRef.current = instance;
      // Chainable API (force-graph typings are class-based, runtime is Kapsule)
      const api = instance as unknown as {
        graphData: (d: GraphData) => typeof api;
        nodeId: (id: string) => typeof api;
        nodeLabel: (fn: (n: unknown) => string) => typeof api;
        nodeColor: (fn: (n: unknown) => string) => typeof api;
        nodeVal: (fn: (n: unknown) => number) => typeof api;
        nodeCanvasObject: (fn: (n: unknown, ctx: CanvasRenderingContext2D, scale: number) => void) => typeof api;
        nodeCanvasObjectMode: (mode: string | (() => string)) => typeof api;
        linkColor: (c: string) => typeof api;
        linkWidth: (n: number) => typeof api;
        linkDirectionalParticles: (n: number) => typeof api;
        onNodeClick: (fn: (n: unknown, e: MouseEvent) => void) => typeof api;
        onNodeRightClick: (fn: (n: unknown, e: MouseEvent) => void) => typeof api;
        onNodeDragEnd: (fn: (n: unknown, t: { x: number; y: number }) => void) => typeof api;
        enableNodeDrag: (enable: boolean) => typeof api;
        d3Force: (name: string) => { strength?: (v: number) => unknown; distance?: (v: number) => unknown } | undefined;
        d3ReheatSimulation: () => typeof api;
        width: (n: number) => typeof api;
        height: (n: number) => typeof api;
      };
      // Spread nodes in a circle initially so they don’t start bunched
      const n = graphData.nodes.length;
      const radius = Math.max(180, Math.min(280, n * 8));
      graphData.nodes.forEach((node, i) => {
        if (node.x == null && node.y == null) {
          const angle = (2 * Math.PI * i) / (n || 1);
          node.x = radius * Math.cos(angle);
          node.y = radius * Math.sin(angle);
        }
      });
      api
        .graphData(graphData)
        .nodeId('id')
        .nodeLabel((node: unknown) => {
          const n = node as NodeData;
          const lfc = n.log2FC != null ? `Log₂FC: ${n.log2FC.toFixed(2)}` : '';
          const fdr = n.fdr != null ? `FDR: ${n.fdr.toExponential(2)}` : '';
          return `${n.name}${lfc ? ` | ${lfc}` : ''}${fdr ? ` | ${fdr}` : ''}`;
        })
        .nodeColor((node: unknown) => {
          const n = node as NodeData;
          const ids = highlightedIdsRef.current;
          const hn = highlightNodeRef.current;
          if (ids?.has(n.id) || n.id === hn) return '#6ABF36';
          return nodeColor(n);
        })
        .nodeVal((node: unknown) => nodeVal(node as NodeData))
        .nodeCanvasObjectMode(() => 'after')
        .nodeCanvasObject((node: unknown, ctx: CanvasRenderingContext2D, globalScale: number) => {
          if (!showLabelsRef.current) return;
          const n = node as NodeData;
          const x = (node as { x?: number }).x ?? 0;
          const y = (node as { y?: number }).y ?? 0;
          const val = nodeVal(n);
          const fontSize = Math.max(9, Math.min(12, 11 / globalScale));
          ctx.font = `${fontSize}px sans-serif`;
          ctx.fillStyle = '#1a1a1a';
          ctx.textAlign = 'center';
          ctx.fillText(n.name, x, y + val + fontSize + 2);
        })
        .linkColor('#E8E6E3')
        .linkWidth(1)
        .linkDirectionalParticles(0)
        .enableNodeDrag(true)
        .onNodeClick((node: unknown, event: MouseEvent) => {
          const n = node as NodeData;
          if (event.detail === 2) {
            n.fx = undefined;
            n.fy = undefined;
            api.d3ReheatSimulation();
          } else {
            setHighlightNode((prev) => (prev === n.id ? null : n.id));
          }
        })
        .onNodeDragEnd((node: unknown) => {
          const n = node as NodeData;
          if (n.x != null && n.y != null) {
            n.fx = n.x;
            n.fy = n.y;
          }
        })
        .onNodeRightClick((node: unknown, event: MouseEvent) => {
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
        });
      // Spread layout: stronger repulsion and longer link distance so nodes aren’t bunched
      const charge = api.d3Force('charge');
      if (charge && typeof (charge as { strength?: (v: number) => unknown }).strength === 'function') {
        (charge as { strength: (v: number) => unknown }).strength(-400);
      }
      const link = api.d3Force('link');
      if (link && typeof (link as { distance?: (v: number) => unknown }).distance === 'function') {
        (link as { distance: (v: number) => unknown }).distance(100);
      }
      api.d3ReheatSimulation();
      api.width(container.offsetWidth);
      api.height(container.offsetHeight);
    });
    return () => {
      mounted = false;
      if (graphInstanceRef.current) {
        graphInstanceRef.current._destructor();
        graphInstanceRef.current = null;
      }
    };
  }, [isMounted, graphData, loading, nodeColor, nodeVal]);

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
          <button
            onClick={handleOpenExportModal}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
          >
            <Download className="w-4 h-4" /> Export
          </button>
        </div>
      </div>

      {/* Export options modal: map-only image, zoom-to-fit, title and options */}
      {exportModalOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50" onClick={() => !exporting && setExportModalOpen(false)} />
          <div
            className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-6 shadow-elevated"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 className="font-serif text-lg text-text-primary mb-4">Export gene network image</h4>
            <p className="text-sm text-text-secondary mb-4">
              Exports only the network map (no header/controls). View is zoomed to fit all nodes so everything is visible.
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Image title (used as filename)</label>
                <input
                  type="text"
                  value={exportTitle}
                  onChange={(e) => setExportTitle(e.target.value)}
                  placeholder={defaultExportTitle}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exportIncludeLabels}
                  onChange={(e) => setExportIncludeLabels(e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent/50"
                />
                <span className="text-sm text-text-primary">Include node labels (gene names on the map)</span>
              </label>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Padding (px) around the map</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={exportPadding}
                  onChange={(e) => setExportPadding(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Image scale</label>
                <select
                  value={exportScale}
                  onChange={(e) => setExportScale(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                >
                  <option value={1}>1× (faster, smaller file)</option>
                  <option value={2}>2× (sharper, recommended)</option>
                  <option value={3}>3× (high resolution)</option>
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !exporting && setExportModalOpen(false)}
                disabled={exporting}
                className="px-4 py-2 rounded-lg border border-border bg-background text-text-primary hover:bg-background/80 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExportWithOptions}
                disabled={exporting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white hover:bg-accent/90 disabled:opacity-50"
              >
                {exporting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Exporting…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" /> Export PNG
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}

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
          <div ref={graphContainerRef} style={{ width: '100%', height }} />
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
        <span>Node size ∝ -log₁₀(FDR). Data: STRING DB (human). Drag nodes to reposition; they stay put. Double-click a node to unpin.</span>
      </div>
    </div>
  );
}
