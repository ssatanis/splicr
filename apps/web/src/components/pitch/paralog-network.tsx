"use client";

import ForceGraph2D, { type ForceGraphMethods, type GraphData } from "react-force-graph-2d";
import { useEffect, useMemo, useRef, useState } from "react";

type EscapeNode = {
  id: string;
  label: string;
  kind: "target" | "paralog" | "guide";
  detail: string;
  color: string;
  size: number;
};

type EscapeLink = {
  source: string;
  target: string;
  relation: "paralogy" | "targets";
};

const graph: GraphData<EscapeNode, EscapeLink> = {
  nodes: [
    { id: "ARID1A", label: "ARID1A", kind: "target", detail: "Knocked out, observed effect -0.08", color: "#d24b34", size: 12 },
    { id: "ARID1B", label: "ARID1B", kind: "paralog", detail: "Conditional rescue hypothesis, DepMap Δ -0.42", color: "#19a974", size: 13 },
    { id: "gA1", label: "A1", kind: "guide", detail: "ARID1A spacer, residue 711", color: "#f9904a", size: 5 },
    { id: "gA2", label: "A2", kind: "guide", detail: "ARID1A spacer, residue 896", color: "#f9904a", size: 5 },
    { id: "gB1", label: "B1", kind: "guide", detail: "ARID1B spacer, residue 603", color: "#38c8df", size: 5 },
    { id: "gB2", label: "B2", kind: "guide", detail: "ARID1B spacer, residue 914", color: "#38c8df", size: 5 },
  ],
  links: [
    { source: "ARID1A", target: "ARID1B", relation: "paralogy" },
    { source: "gA1", target: "ARID1A", relation: "targets" },
    { source: "gA2", target: "ARID1A", relation: "targets" },
    { source: "gB1", target: "ARID1B", relation: "targets" },
    { source: "gB2", target: "ARID1B", relation: "targets" },
    { source: "gA1", target: "gB1", relation: "targets" },
    { source: "gA2", target: "gB2", relation: "targets" },
  ],
};

export default function ParalogNetwork() {
  const holder = useRef<HTMLDivElement | null>(null);
  const force = useRef<ForceGraphMethods<EscapeNode, EscapeLink> | undefined>(undefined);
  const [width, setWidth] = useState(560);
  const [selected, setSelected] = useState<EscapeNode>(graph.nodes[1] as EscapeNode);

  useEffect(() => {
    if (!holder.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(280, Math.floor(entry.contentRect.width)));
    });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => force.current?.zoomToFit(350, 46), 250);
    return () => window.clearTimeout(timer);
  }, [width]);

  const data = useMemo(() => graph, []);

  return (
    <div ref={holder} className="overflow-hidden rounded-lg border border-line bg-[#071f28]">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2 text-[10px] text-white/55">
        <span>Paralog escape map, drag to inspect</span>
        <span className="flex items-center gap-3">
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#d24b34]" /> target</span>
          <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#19a974]" /> rescue</span>
        </span>
      </div>
      <div className="relative h-[290px]">
        <ForceGraph2D<EscapeNode, EscapeLink>
          ref={force}
          graphData={data}
          width={width}
          height={290}
          backgroundColor="#071f28"
          nodeVal={(node) => node.size}
          nodeColor={(node) => node.color}
          nodeLabel={(node) => `${node.label}: ${node.detail}`}
          linkColor={(link) => link.relation === "paralogy" ? "rgba(56,200,223,.72)" : "rgba(255,255,255,.2)"}
          linkWidth={(link) => link.relation === "paralogy" ? 2.5 : 1}
          linkLineDash={(link) => link.relation === "paralogy" ? null : [3, 4]}
          linkDirectionalParticles={(link) => link.relation === "paralogy" ? 3 : 0}
          linkDirectionalParticleWidth={2}
          linkDirectionalParticleColor={() => "#38c8df"}
          cooldownTicks={80}
          enableNodeDrag
          onNodeClick={(node) => setSelected(node as EscapeNode)}
          nodeCanvasObjectMode={() => "after"}
          nodeCanvasObject={(node, context, scale) => {
            if (node.x === undefined || node.y === undefined) return;
            const fontSize = node.kind === "guide" ? 8 / scale : 11 / scale;
            context.font = `${node.kind === "guide" ? 500 : 600} ${fontSize}px Outfit, sans-serif`;
            context.textAlign = "center";
            context.textBaseline = "top";
            context.fillStyle = node.kind === "guide" ? "rgba(255,255,255,.65)" : "#ffffff";
            context.fillText(node.label, node.x, node.y + node.size + 3 / scale);
          }}
        />
      </div>
      <div className="border-t border-white/10 px-3 py-2.5" aria-live="polite">
        <p className="text-[11px] font-medium text-white">{selected.label}</p>
        <p className="mt-0.5 text-[10.5px] text-white/55">{selected.detail}</p>
      </div>
      <p className="sr-only">
        ARID1A is connected to candidate buffering paralog ARID1B. Two ARID1A guide nodes and two ARID1B guide nodes form paired validation paths.
      </p>
    </div>
  );
}
