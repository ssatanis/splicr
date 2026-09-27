"use client";

import { useMemo, useState } from "react";

import { formatNumber } from "@/lib/utils";

import { Card, Kpi } from "./ui";

export function Planner() {
  const [model, setModel] = useState("Primary T cells (human)");
  const [phenotype, setPhenotype] = useState("Cytokine secretion, sorted");
  const [scope, setScope] = useState<"genome" | "focused">("focused");
  const [genes, setGenes] = useState(1_200);
  const [guidesPerGene, setGuidesPerGene] = useState(4);
  const [coverage, setCoverage] = useState(500);
  const [effect, setEffect] = useState(1.0);

  const est = useMemo(() => {
    const g = scope === "genome" ? 19_000 : genes;
    const guides = g * guidesPerGene + 500;
    const cells = guides * coverage;
    const reads = guides * 300;
    const replicates = effect >= 1.5 ? 2 : effect >= 1 ? 3 : 4;
    const cost = scope === "genome" ? 19_000 : Math.round(4_500 + guides * 0.06 + replicates * 900);
    const weeks = scope === "genome" ? "12–20" : "6–9";
    const power = Math.min(0.97, 0.55 + 0.12 * replicates + 0.1 * Math.log10(coverage / 100) + 0.08 * (effect - 0.5));
    return { g, guides, cells, reads, replicates, cost, weeks, power };
  }, [scope, genes, guidesPerGene, coverage, effect]);

  return (
    <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4">
      <Card title="Describe the screen">
        <div className="space-y-5 text-sm">
          <div>
            <div className="label-sm mb-1">Cell model</div>
            <input value={model} onChange={(e) => setModel(e.target.value)} className="underline-input" />
          </div>
          <div>
            <div className="label-sm mb-1">Phenotype / readout</div>
            <input value={phenotype} onChange={(e) => setPhenotype(e.target.value)} className="underline-input" />
          </div>
          <div>
            <div className="label-sm mb-2">Scope</div>
            <div className="flex gap-2">
              {(["focused", "genome"] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)} className={`chip capitalize ${scope === s ? "bg-teal-800 text-white" : ""}`}>
                  {s === "focused" ? "Focused library" : "Genome-wide"}
                </button>
              ))}
            </div>
          </div>
          {scope === "focused" && (
            <div>
              <div className="label-sm mb-1">Genes ({formatNumber(genes)})</div>
              <input type="range" min={200} max={5000} step={100} value={genes} onChange={(e) => setGenes(Number(e.target.value))} className="w-full accent-orange-500" />
              <p className="text-xs text-muted mt-1">Built from 14 similar screens in the Atlas: genes that hit in at least 2, plus pathway neighbors.</p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="label-sm mb-1">Guides / gene</div>
              <input type="number" min={2} max={10} value={guidesPerGene} onChange={(e) => setGuidesPerGene(Number(e.target.value))} className="underline-input" />
            </div>
            <div>
              <div className="label-sm mb-1">Coverage (cells/guide)</div>
              <input type="number" min={100} max={2000} step={50} value={coverage} onChange={(e) => setCoverage(Number(e.target.value))} className="underline-input" />
            </div>
            <div>
              <div className="label-sm mb-1">Expected effect (LFC)</div>
              <input type="number" min={0.3} max={3} step={0.1} value={effect} onChange={(e) => setEffect(Number(e.target.value))} className="underline-input" />
            </div>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Kpi label="Guides" value={formatNumber(est.guides)} hint={`${formatNumber(est.g)} genes + 500 controls`} />
          <Kpi label="Cells per arm" value={formatNumber(est.cells)} hint={`${coverage}× coverage`} />
          <Kpi label="Reads per sample" value={formatNumber(est.reads)} hint="300 reads per guide" />
          <Kpi label="Replicates" value={est.replicates} hint="For the expected effect" tone="cyan" />
          <Kpi label="Power" value={`${Math.round(est.power * 100)}%`} hint="To detect the expected effect at FDR 0.1" tone="orange" />
          <Kpi label="Estimate" value={`$${formatNumber(est.cost)}`} hint={`${est.weeks} weeks`} />
        </div>
        <Card title="Why focused" subtitle={model}>
          <p className="text-sm text-body leading-relaxed">
            Genome-wide is impossible here: primary cells cannot be expanded to the {formatNumber(19_000 * guidesPerGene * coverage)} cells a
            genome-wide library needs at {coverage}× coverage. A {formatNumber(est.g)}-gene library built from similar screens keeps power
            high with {formatNumber(est.cells)} cells per arm, and every gene in it has an Atlas history you can compare against.
          </p>
          <p className="mt-3 text-xs text-muted">Power estimates come from effect-size distributions in the Atlas for this library class. Illustrative until the model ships.</p>
        </Card>
      </div>
    </div>
  );
}
