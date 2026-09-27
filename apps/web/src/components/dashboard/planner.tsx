"use client";

/**
 * The screen planner.
 *
 * What was here before reported "Power 97%" as a headline KPI, subtitled "To
 * detect the expected effect at FDR 0.1", from this expression:
 *
 *   min(0.97, 0.55 + 0.12*replicates + 0.1*log10(coverage/100) + 0.08*(effect-0.5))
 *
 * That is not a power calculation. It has no alpha, no dispersion estimate, no
 * library size and no guides-per-gene term at all, its floor is 77% and its cap
 * is 97%, so a hopeless design still reported 97% and a good one could not
 * report more. A number like that on a page somebody uses to decide whether to
 * run a screen is worse than no number, and the only caveat was twelve words in
 * a different card.
 *
 * So the power figure is gone. What is left is arithmetic the planner can
 * actually do and show its working for: how many guides the library holds, how
 * many cells each arm needs at the chosen coverage, how deep the sequencing has
 * to be, and how that coverage sits against the depth floor the field publishes.
 * Cost is one formula for both scopes rather than a flat number for genome-wide
 * that ignored every input.
 */

import { Info } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { formatNumber } from "@/lib/utils";

import { Card, Kpi } from "./ui";

/** Genes in a human genome-wide library, from the registry in @/lib/mock/data. */
const GENOME_WIDE_GENES = 19_114;
/** Non-targeting controls, which is the floor below which an empirical null is too thin. */
const CONTROL_GUIDES = 500;
/** Sequencing depth per guide, the usual working figure for a pooled screen. */
const READS_PER_GUIDE = 300;
/**
 * The coverage floor below which a pooled screen loses guides to drift rather
 * than to selection. Widely cited as 200 to 500 cells per guide; the lower bound
 * is used here and named as a rule of thumb rather than a computed threshold.
 */
const COVERAGE_FLOOR = 200;

export function Planner() {
  const [model, setModel] = useState("Primary T cells (human)");
  const [phenotype, setPhenotype] = useState("Cytokine secretion, sorted");
  const [scope, setScope] = useState<"genome" | "focused">("focused");
  const [genes, setGenes] = useState(1_200);
  const [guidesPerGene, setGuidesPerGene] = useState(4);
  const [coverage, setCoverage] = useState(500);
  const [effect, setEffect] = useState(1.0);

  const modelId = useId();
  const phenotypeId = useId();
  const genesId = useId();
  const perGeneId = useId();
  const coverageId = useId();
  const effectId = useId();

  const est = useMemo(() => {
    const g = scope === "genome" ? GENOME_WIDE_GENES : genes;
    const guides = g * guidesPerGene + CONTROL_GUIDES;
    const cells = guides * coverage;
    const reads = guides * READS_PER_GUIDE;
    const replicates = effect >= 1.5 ? 2 : effect >= 1 ? 3 : 4;
    // One formula for both scopes. A flat figure for genome-wide meant every
    // input a reader changed left the estimate exactly where it was.
    const cost = Math.round(4_500 + guides * 0.06 + replicates * 900 + (reads * replicates * 3) / 1_000_000 * 12);
    const weeks = scope === "genome" ? "12–20" : "6–9";
    return { g, guides, cells, reads, replicates, cost, weeks };
  }, [scope, genes, guidesPerGene, coverage, effect]);

  const clearsFloor = coverage >= COVERAGE_FLOOR;

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-2xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm text-orange-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Sample data. The figures below are arithmetic on what you type, not a measurement or a quote. The cost line is
          an order-of-magnitude estimate from guide count, replicates and sequencing depth, and it is not a price.
        </span>
      </p>

      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-4">
        <Card title="Describe the screen">
          <div className="space-y-5 text-sm">
            <div>
              <label htmlFor={modelId} className="label-sm mb-1 block">
                Cell model
              </label>
              <input id={modelId} value={model} onChange={(e) => setModel(e.target.value)} className="underline-input" />
            </div>
            <div>
              <label htmlFor={phenotypeId} className="label-sm mb-1 block">
                Phenotype / readout
              </label>
              <input
                id={phenotypeId}
                value={phenotype}
                onChange={(e) => setPhenotype(e.target.value)}
                className="underline-input"
              />
            </div>
            <fieldset>
              <legend className="label-sm mb-2">Scope</legend>
              <div className="flex gap-2">
                {(["focused", "genome"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={scope === s}
                    onClick={() => setScope(s)}
                    className={`chip capitalize ${scope === s ? "bg-teal-800 text-white" : ""}`}
                  >
                    {s === "focused" ? "Focused library" : "Genome-wide"}
                  </button>
                ))}
              </div>
            </fieldset>
            {scope === "focused" && (
              <div>
                <label htmlFor={genesId} className="label-sm mb-1 block">
                  Genes ({formatNumber(genes)})
                </label>
                <input
                  id={genesId}
                  type="range"
                  min={200}
                  max={5000}
                  step={100}
                  value={genes}
                  onChange={(e) => setGenes(Number(e.target.value))}
                  className="w-full accent-orange-500"
                />
                <p className="text-xs text-muted mt-1">
                  A focused library would be built from the Atlas screens closest to this design: genes called in more
                  than one of them, plus pathway neighbours. The Atlas is not built yet, so nothing here selects genes.
                </p>
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor={perGeneId} className="label-sm mb-1 block">
                  Guides / gene
                </label>
                <input
                  id={perGeneId}
                  type="number"
                  min={2}
                  max={10}
                  value={guidesPerGene}
                  onChange={(e) => setGuidesPerGene(Number(e.target.value))}
                  className="underline-input"
                />
              </div>
              <div>
                <label htmlFor={coverageId} className="label-sm mb-1 block">
                  Coverage (cells/guide)
                </label>
                <input
                  id={coverageId}
                  type="number"
                  min={100}
                  max={2000}
                  step={50}
                  value={coverage}
                  onChange={(e) => setCoverage(Number(e.target.value))}
                  className="underline-input"
                />
              </div>
              <div>
                <label htmlFor={effectId} className="label-sm mb-1 block">
                  Expected effect (LFC)
                </label>
                <input
                  id={effectId}
                  type="number"
                  min={0.3}
                  max={3}
                  step={0.1}
                  value={effect}
                  onChange={(e) => setEffect(Number(e.target.value))}
                  className="underline-input"
                />
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Kpi
              label="Guides"
              value={formatNumber(est.guides)}
              hint={`${formatNumber(est.g)} genes × ${guidesPerGene} + ${CONTROL_GUIDES} controls`}
            />
            <Kpi label="Cells per arm" value={formatNumber(est.cells)} hint={`${coverage}× coverage`} />
            <Kpi label="Reads per sample" value={formatNumber(est.reads)} hint={`${READS_PER_GUIDE} reads per guide`} />
            <Kpi label="Replicates" value={est.replicates} hint="For the expected effect" tone="cyan" />
            <Kpi
              label="Coverage floor"
              value={clearsFloor ? "Cleared" : "Below"}
              hint={`${COVERAGE_FLOOR} cells per guide, a published rule of thumb, not a power calculation`}
              tone={clearsFloor ? "cyan" : "orange"}
            />
            <Kpi label="Order of magnitude" value={`$${formatNumber(est.cost)}`} hint={`${est.weeks} weeks`} />
          </div>

          <Card title="Why there is no power figure here" subtitle="The honest answer to the question this page looks like it answers">
            <p className="text-sm text-body leading-relaxed">
              A power estimate for a pooled screen needs things this form does not collect and SplicR does not yet
              compute: a per-guide dispersion estimate from counts like yours, the alpha the test will run at, the
              replicate variance, the size of the library the correction runs over, and the shape of the effect-size
              distribution you expect. Without those, any percentage on this page would be a formula pretending to be a
              calculation. The six figures above are arithmetic on what you typed, and the coverage check is a rule of
              thumb from the literature rather than a threshold SplicR derived.
            </p>
          </Card>

          <Card title={scope === "focused" ? "Why focused" : "What genome-wide costs you"} subtitle={model}>
            <p className="text-sm text-body leading-relaxed">
              A genome-wide library at {coverage}× coverage needs{" "}
              {formatNumber(GENOME_WIDE_GENES * guidesPerGene * coverage)} cells per arm. Primary cells usually cannot
              be expanded that far, which is the constraint that decides the scope before any statistic does. A{" "}
              {formatNumber(est.g)}-gene library needs {formatNumber(est.cells)} cells per arm instead.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
