'use client';

import { useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { Download, Loader2, RefreshCw, Search, Pause, Play, Info, Filter } from 'lucide-react';
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
  degree?: number; // Number of connections (for hub gene analysis)
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

  // Calculate degree (number of connections) for each node
  const degreeMap = new Map<string, number>();
  stringEdges.forEach(e => {
    degreeMap.set(e.a, (degreeMap.get(e.a) || 0) + 1);
    degreeMap.set(e.b, (degreeMap.get(e.b) || 0) + 1);
  });

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
      degree: degreeMap.get(id) || 0,
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
  height: initialHeight = 560,
  analysisName,
}: GeneNetworkVisualizationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const graphInstanceRef = useRef<ForceGraphInstance | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [height, setHeight] = useState(initialHeight);
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
  const [isPaused, setIsPaused] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [minDegree, setMinDegree] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedGeneNeighbors, setSelectedGeneNeighbors] = useState<string | null>(null);
  const showLabelsRef = useRef(false);
  /** Saved node positions (id -> {x,y,fx,fy}) so filter changes don't reset layout */
  const nodePositionsRef = useRef<Map<string, { x?: number; y?: number; fx?: number; fy?: number }>>(new Map());

  // Ensure component only renders on client
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Responsive height based on container width
  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      const width = containerRef.current?.offsetWidth || 0;
      setContainerWidth(width);

      // Adaptive height: smaller screens get shorter graphs
      if (width < 640) {
        // Mobile
        setHeight(Math.min(initialHeight, 400));
      } else if (width < 1024) {
        // Tablet
        setHeight(Math.min(initialHeight, 500));
      } else {
        // Desktop
        setHeight(initialHeight);
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(updateDimensions);
    resizeObserver.observe(containerRef.current);

    return () => resizeObserver.disconnect();
  }, [initialHeight]);

  // Update graph dimensions when container resizes
  useEffect(() => {
    const instance = graphInstanceRef.current;
    const container = graphContainerRef.current;
    if (!instance || !container) return;

    const api = instance as unknown as {
      width: (n: number) => typeof api;
      height: (n: number) => typeof api;
    };

    api.width(container.offsetWidth);
    api.height(height);
  }, [containerWidth, height]);

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

  // Stable key so we only refetch when the actual gene list or score changes (not on every parent re-render).
  // Prevents the graph from being destroyed/recreated and losing pinned positions.
  const loadKey = useMemo(
    () => geneNames.join(',') + '|' + String(requiredScore),
    [geneNames, requiredScore]
  );
  const genesRef = useRef(genes);
  const geneMapRef = useRef(geneMap);
  genesRef.current = genes;
  geneMapRef.current = geneMap;

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
      const data = buildGraphData(
        genesRef.current,
        stringNodes,
        stringEdges,
        geneMapRef.current
      );
      setGraphData(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load STRING network');
      setGraphData(null);
    } finally {
      setLoading(false);
    }
  }, [loadKey, geneNames, requiredScore]);

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
    let title = defaultExportTitle;
    if (selectedGeneNeighbors) {
      title = `[${analysisName ?? 'Screen Analysis'}] ${selectedGeneNeighbors} Network Neighbors`;
    } else if (minDegree > 0) {
      title = `[${analysisName ?? 'Screen Analysis'}] Hub Genes Network (≥${minDegree} connections)`;
    }
    setExportTitle(title);
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

  // Filter nodes by degree (hub genes) or by neighbors of selected gene
  const filteredGraphData = useMemo(() => {
    if (!graphData) return graphData;

    // Filter by neighbors of selected gene
    if (selectedGeneNeighbors) {
      const neighborSet = new Set<string>();
      neighborSet.add(selectedGeneNeighbors);

      // Find all direct neighbors
      graphData.links.forEach(l => {
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as any).id;

        if (sourceId === selectedGeneNeighbors) neighborSet.add(targetId);
        if (targetId === selectedGeneNeighbors) neighborSet.add(sourceId);
      });

      const filteredNodes = graphData.nodes.filter(n => neighborSet.has(n.id));
      const filteredLinks = graphData.links.filter(l => {
        const sourceId = typeof l.source === 'string' ? l.source : (l.source as any).id;
        const targetId = typeof l.target === 'string' ? l.target : (l.target as any).id;
        return neighborSet.has(sourceId) && neighborSet.has(targetId);
      });

      return { nodes: filteredNodes, links: filteredLinks };
    }

    // Filter by minimum degree
    if (minDegree === 0) return graphData;

    const filteredNodes = graphData.nodes.filter(n => (n.degree || 0) >= minDegree);
    const nodeIds = new Set(filteredNodes.map(n => n.id));
    const filteredLinks = graphData.links.filter(l => {
      const sourceId = typeof l.source === 'string' ? l.source : (l.source as any).id;
      const targetId = typeof l.target === 'string' ? l.target : (l.target as any).id;
      return nodeIds.has(sourceId) && nodeIds.has(targetId);
    });

    return { nodes: filteredNodes, links: filteredLinks };
  }, [graphData, minDegree, selectedGeneNeighbors]);

  // Calculate network statistics
  const networkStats = useMemo(() => {
    if (!graphData) return null;

    const numNodes = graphData.nodes.length;
    const numEdges = graphData.links.length;
    const avgDegree = numNodes > 0 ? (2 * numEdges) / numNodes : 0;
    const maxDegree = Math.max(...graphData.nodes.map(n => n.degree || 0), 0);
    const hubGenes = graphData.nodes
      .filter(n => (n.degree || 0) >= avgDegree * 1.5)
      .sort((a, b) => (b.degree || 0) - (a.degree || 0))
      .slice(0, 5);

    return {
      numNodes,
      numEdges,
      avgDegree,
      maxDegree,
      hubGenes,
      density: numNodes > 1 ? (2 * numEdges) / (numNodes * (numNodes - 1)) : 0,
    };
  }, [graphData]);

  const searchLower = search.trim().toLowerCase();
  const highlightedIds = useMemo(() => {
    if (!searchLower || !filteredGraphData) return new Set<string>();
    return new Set(
      filteredGraphData.nodes
        .filter((n) => n.name.toLowerCase().includes(searchLower))
        .map((n) => n.id)
    );
  }, [searchLower, filteredGraphData]);

  // Refs so nodeColor (called every frame) always sees latest highlight state without recreating the graph
  const highlightedIdsRef = useRef(highlightedIds);
  const highlightNodeRef = useRef(highlightNode);
  highlightedIdsRef.current = highlightedIds;
  highlightNodeRef.current = highlightNode;

  // Toggle simulation pause/resume via force-graph's cooldown (no direct sim access)
  const togglePause = useCallback(() => {
    const instance = graphInstanceRef.current;
    if (!instance) return;
    const api = instance as unknown as {
      cooldownTicks: (n: number) => unknown;
      cooldownTime: (n: number) => unknown;
      d3ReheatSimulation: () => unknown;
    };
    if (isPaused) {
      api.cooldownTicks(Infinity);
      api.cooldownTime(15000);
      api.d3ReheatSimulation();
      setIsPaused(false);
    } else {
      api.cooldownTicks(0);
      api.cooldownTime(0);
      setIsPaused(true);
    }
  }, [isPaused]);

  // Mount force-graph (2D only) when we have data; use force-graph package to avoid AFRAME/VR/AR
  useEffect(() => {
    const container = graphContainerRef.current;
    const dataToRender = filteredGraphData;
    if (!isMounted || !dataToRender || dataToRender.nodes.length === 0 || loading || !container) {
      if (graphInstanceRef.current) {
        graphInstanceRef.current._destructor();
        graphInstanceRef.current = null;
      }
      return;
    }

    // Save current node positions from existing graph so filter changes don't reset layout
    const prevInstance = graphInstanceRef.current;
    if (prevInstance) {
      const currentData = (prevInstance as unknown as { graphData?: () => GraphData }).graphData?.();
      if (currentData?.nodes) {
        const map = nodePositionsRef.current;
        map.clear();
        currentData.nodes.forEach((node: NodeData) => {
          const id = node.id;
          if (id != null)
            map.set(String(id), {
              x: node.x,
              y: node.y,
              fx: node.fx,
              fy: node.fy,
            });
        });
      }
    }

    let mounted = true;
    import('force-graph').then((mod) => {
      if (!mounted || !container) return;
      if (graphInstanceRef.current) {
        graphInstanceRef.current._destructor();
        graphInstanceRef.current = null;
      }
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
        onEngineStop: (fn: () => void) => typeof api;
        d3Force: (name: string) => { strength?: (v: number) => unknown; distance?: (v: number) => unknown } | undefined;
        d3ReheatSimulation: () => typeof api;
        d3AlphaDecay: (n: number) => typeof api;
        width: (n: number) => typeof api;
        height: (n: number) => typeof api;
      };
      const savedPos = nodePositionsRef.current;
      const n = dataToRender.nodes.length;
      const radius = Math.max(180, Math.min(280, n * 8));
      dataToRender.nodes.forEach((node, i) => {
        const pos = savedPos.get(node.id);
        if (pos && (pos.x != null || pos.fx != null)) {
          node.x = pos.x ?? node.x;
          node.y = pos.y ?? node.y;
          node.fx = pos.fx;
          node.fy = pos.fy;
        } else if (node.x == null && node.y == null) {
          const angle = (2 * Math.PI * i) / (n || 1);
          node.x = radius * Math.cos(angle);
          node.y = radius * Math.sin(angle);
        }
      });
      api
        .graphData(dataToRender)
        .nodeId('id')
        .nodeLabel((node: unknown) => {
          const n = node as NodeData;
          const lfc = n.log2FC != null ? `Log₂FC: ${n.log2FC.toFixed(2)}` : '';
          const fdr = n.fdr != null ? `FDR: ${n.fdr.toExponential(2)}` : '';
          const degree = n.degree != null ? `Connections: ${n.degree}` : '';
          return `${n.name}${lfc ? ` | ${lfc}` : ''}${fdr ? ` | ${fdr}` : ''}${degree ? ` | ${degree}` : ''}`;
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
        .onEngineStop(() => setIsPaused(true))
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
          const nodeData = node as NodeData;
          const g = nodeData.name;
          const menu = document.createElement('div');
          menu.className = 'fixed z-50 bg-surface border border-border rounded-lg shadow-elevated py-1 min-w-[200px]';
          menu.style.left = `${event.clientX}px`;
          menu.style.top = `${event.clientY}px`;

          const items = [
            { label: `Show ${g} + neighbors only`, fn: () => {
              setSelectedGeneNeighbors(g);
              setMinDegree(0);
            }, divider: true },
            { label: 'Show in KEGG pathway', fn: () => openInPathway(g) },
            { label: 'View in GeneCards', fn: () => openInGeneCards(g) },
            { label: 'Compare to DepMap', fn: () => openInDepMap(g) },
            { label: 'Open in STRING', fn: () => openInString(g) },
          ];

          items.forEach(({ label, fn, divider }) => {
            const b = document.createElement('button');
            b.className = 'w-full px-4 py-2 text-left text-sm hover:bg-background flex items-center gap-2';
            b.textContent = label;
            b.onclick = () => {
              fn();
              menu.remove();
              document.removeEventListener('click', close);
            };
            menu.appendChild(b);

            if (divider) {
              const div = document.createElement('div');
              div.className = 'border-t border-border my-1';
              menu.appendChild(div);
            }
          });

          const close = () => {
            menu.remove();
            document.removeEventListener('click', close);
          };
          document.body.appendChild(menu);
          setTimeout(() => document.addEventListener('click', close), 0);
        });
      // Spread layout: stronger repulsion and longer link distance so nodes aren't bunched
      const charge = api.d3Force('charge');
      if (charge && typeof (charge as { strength?: (v: number) => unknown }).strength === 'function') {
        (charge as { strength: (v: number) => unknown }).strength(-400);
      }
      const link = api.d3Force('link');
      if (link && typeof (link as { distance?: (v: number) => unknown }).distance === 'function') {
        (link as { distance: (v: number) => unknown }).distance(100);
      }
      // Cool down quickly so the layout stabilizes and onEngineStop fires (no constant movement)
      api.d3AlphaDecay(0.15);
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
  // Only recreate graph when filtered data or mount/loading change; nodeColor/nodeVal are stable and read via closure.
  }, [isMounted, filteredGraphData, loading]);

  return (
    <div ref={containerRef} className="w-full bg-surface rounded-xl p-4 sm:p-6 border border-border shadow-card">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
        <h3 className="text-xl sm:text-2xl font-serif text-text-primary">Gene interaction network</h3>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative flex-1 sm:flex-none min-w-[140px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
            <input
              type="text"
              placeholder="Find gene"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border bg-background text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>
          <button
            onClick={togglePause}
            disabled={!graphInstanceRef.current}
            title={isPaused ? "Resume simulation" : "Pause simulation"}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 disabled:opacity-50"
          >
            {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            <span className="hidden sm:inline">{isPaused ? 'Play' : 'Pause'}</span>
          </button>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
          >
            <Filter className="w-4 h-4" />
            <span className="hidden sm:inline">Filters</span>
          </button>
          <button
            onClick={() => setShowStats(!showStats)}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
          >
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline">Stats</span>
          </button>
          <button
            onClick={() => loadNetwork()}
            disabled={loading}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={handleOpenExportModal}
            className="flex items-center gap-2 px-3 sm:px-4 py-2 text-sm rounded-lg border border-border bg-background text-text-primary hover:bg-accent/10"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {showFilters && graphData && (
        <div className="mb-4 p-4 rounded-lg bg-background border border-border">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-semibold text-text-primary">Filters</h4>
            {(minDegree > 0 || selectedGeneNeighbors) && (
              <button
                onClick={() => {
                  setMinDegree(0);
                  setSelectedGeneNeighbors(null);
                }}
                className="text-xs text-accent hover:text-accent/80"
              >
                Reset filters
              </button>
            )}
          </div>

          {selectedGeneNeighbors && (
            <div className="mb-3 p-3 rounded bg-accent/10 border border-accent/20">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-tertiary">Viewing neighbors of:</div>
                  <div className="text-sm font-semibold text-accent">{selectedGeneNeighbors}</div>
                </div>
                <button
                  onClick={() => setSelectedGeneNeighbors(null)}
                  className="text-xs text-accent hover:text-accent/80"
                >
                  Clear
                </button>
              </div>
              {filteredGraphData && (
                <p className="text-xs text-text-secondary mt-2">
                  Showing {filteredGraphData.nodes.length - 1} neighbors + {selectedGeneNeighbors}
                </p>
              )}
            </div>
          )}

          {!selectedGeneNeighbors && (
            <div className="space-y-2">
              <label className="block text-sm text-text-secondary">
                Minimum connections (degree): {minDegree}
              </label>
              <input
                type="range"
                min="0"
                max={networkStats?.maxDegree || 10}
                value={minDegree}
                onChange={(e) => setMinDegree(Number(e.target.value))}
                className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
              />
              <div className="flex justify-between text-xs text-text-tertiary">
                <span>All genes</span>
                <span>Hub genes only ({networkStats?.maxDegree} max)</span>
              </div>
              {minDegree > 0 && filteredGraphData && (
                <p className="text-xs text-text-secondary mt-2">
                  Showing {filteredGraphData.nodes.length} of {graphData.nodes.length} genes
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Network Statistics Panel */}
      {showStats && networkStats && (
        <div className="mb-4 p-4 rounded-lg bg-background border border-border">
          <h4 className="text-sm font-semibold text-text-primary mb-3">Network Statistics</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            <div>
              <div className="text-xs text-text-tertiary">Nodes</div>
              <div className="text-lg font-semibold text-text-primary">{networkStats.numNodes}</div>
            </div>
            <div>
              <div className="text-xs text-text-tertiary">Edges</div>
              <div className="text-lg font-semibold text-text-primary">{networkStats.numEdges}</div>
            </div>
            <div>
              <div className="text-xs text-text-tertiary">Avg Degree</div>
              <div className="text-lg font-semibold text-text-primary">{networkStats.avgDegree.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-xs text-text-tertiary">Density</div>
              <div className="text-lg font-semibold text-text-primary">{(networkStats.density * 100).toFixed(1)}%</div>
            </div>
          </div>
          {networkStats.hubGenes.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-xs text-text-tertiary mb-2">Top hub genes (highly connected):</div>
              <div className="flex flex-wrap gap-2">
                {networkStats.hubGenes.map(gene => (
                  <button
                    key={gene.id}
                    onClick={() => setSearch(gene.name)}
                    className="px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
                    title={`${gene.name}: ${gene.degree} connections`}
                  >
                    {gene.name} ({gene.degree})
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

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

      {/* Graph Container */}
      <div
        style={{ height: `${height}px` }}
        className="rounded-lg overflow-hidden bg-background border border-border relative"
      >
        {loading && !graphData && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-10 h-10 animate-spin text-accent mx-auto mb-2" />
              <p className="text-sm text-text-tertiary">Loading network from STRING DB...</p>
            </div>
          </div>
        )}
        {isMounted && filteredGraphData && filteredGraphData.nodes.length > 0 && !loading && (
          <div ref={graphContainerRef} style={{ width: '100%', height: `${height}px` }} />
        )}
        {filteredGraphData && filteredGraphData.nodes.length === 0 && !loading && (
          <div className="h-full flex items-center justify-center text-center px-4">
            <div>
              <p className="text-text-tertiary mb-2">
                {selectedGeneNeighbors
                  ? `${selectedGeneNeighbors} has no connections in the network.`
                  : minDegree > 0
                  ? `No genes with ${minDegree}+ connections. Try lowering the filter.`
                  : 'No interactions found for the selected genes.'
                }
              </p>
              {minDegree === 0 && !selectedGeneNeighbors && (
                <p className="text-sm text-text-quaternary">
                  Try increasing the gene set or lowering the confidence score threshold.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Simulation status indicator */}
        {!loading && filteredGraphData && filteredGraphData.nodes.length > 0 && (
          <div className="absolute top-3 right-3 px-2 py-1 rounded text-xs bg-background/90 backdrop-blur border border-border text-text-tertiary">
            {isPaused ? '⏸ Paused' : '▶ Running'}
          </div>
        )}
      </div>

      {/* Legend and Instructions */}
      <div className="mt-4 space-y-3">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-xs sm:text-sm text-text-secondary">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#EF4444]" />
            <span>Depleted</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#10B981]" />
            <span>Enriched</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-[#9B9B9B]" />
            <span>Other / STRING</span>
          </div>
        </div>
        <div className="text-xs sm:text-sm text-text-tertiary space-y-1">
          <p>• Node size represents statistical significance (-log₁₀ FDR). Larger = more significant.</p>
          <p>• <strong>Drag</strong> nodes to reposition (they stay pinned). <strong>Double-click</strong> to unpin.</p>
          <p>• <strong>Right-click</strong> a node to focus on its neighbors or view in external databases</p>
          <p>• <strong>Hub genes</strong> (highly connected) may be key regulatory or pathway nodes</p>
          <p>• Data: STRING DB (Homo sapiens) - experimentally validated protein-protein interactions</p>
        </div>
      </div>
    </div>
  );
}
