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
 *
 * WHAT CHANGED IN THE LAYOUT
 *
 * The form and its six figures were three stacked sections of 24px cards running
 * well past the fold, so a reader changing coverage could not see what coverage
 * changed. Form on the left, figures on the right, both inside the fixed shell:
 * every input is on screen at the same time as every number it moves, which is
 * the whole point of a planner.
 */

import { useId, useMemo, useState } from "react";

import { formatNumber } from "@/lib/utils";

import { SampleNote } from "./console";
import {
  FootNote,
  KpiStrip,
  KpiTile,
  PageHeader,
  Panel,
  PanelStack,
  Segmented,
} from "./ui";

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

/**
 * One field shape for the whole form, at the console's 28px control height. The
 * marketing `underline-input` is 16px type with 11px of padding, which is right
 * on a landing page and costs 45px a row here.
 */
const FIELD =
  "h-7 w-full rounded-md border border-line bg-white px-2 text-[12px] text-ink outline-none transition-colors duration-[var(--dur-1)] focus:border-cyan-500 motion-reduce:transition-none";
const FIELD_LABEL = "mb-1 block text-[11px] uppercase tracking-[0.06em] text-muted";

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
    const cost = Math.round(
      4_500 + guides * 0.06 + replicates * 900 + ((reads * replicates * 3) / 1_000_000) * 12,
    );
    const weeks = scope === "genome" ? "12 to 20" : "6 to 9";
    return { g, guides, cells, reads, replicates, cost, weeks };
  }, [scope, genes, guidesPerGene, coverage, effect]);

  const clearsFloor = coverage >= COVERAGE_FLOOR;

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      <PageHeader
        dense
        title="Screen Planner"
        body="What a design costs in guides, cells, reads and weeks before it is ordered."
      />
      <SampleNote>
        Sample data. The figures are arithmetic on what you type, not a measurement or a quote. The
        cost line is an order-of-magnitude estimate from guide count, replicates and sequencing
        depth, and it is not a price.
      </SampleNote>

      {/* Form and figures side by side, because the reader is moving one input at
          a time and watching what it does to the six numbers. */}
      <div className="grid min-h-0 grid-cols-12 gap-4 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]">
        <Panel
          span={4}
          className="min-h-[300px]"
          title="Describe the screen"
          footer={<FootNote>Nothing here is sent anywhere. The figures are local arithmetic</FootNote>}
        >
          <div className="space-y-3">
            <div>
              <label htmlFor={modelId} className={FIELD_LABEL}>
                Cell model
              </label>
              <input
                id={modelId}
                value={model}
                onChange={(event) => setModel(event.target.value)}
                className={FIELD}
              />
            </div>
            <div>
              <label htmlFor={phenotypeId} className={FIELD_LABEL}>
                Phenotype or readout
              </label>
              <input
                id={phenotypeId}
                value={phenotype}
                onChange={(event) => setPhenotype(event.target.value)}
                className={FIELD}
              />
            </div>

            <div>
              <span className={FIELD_LABEL}>Scope</span>
              <Segmented
                label="Scope"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "focused", label: "Focused library" },
                  { value: "genome", label: "Genome-wide" },
                ]}
              />
            </div>

            {scope === "focused" && (
              <div>
                <label htmlFor={genesId} className={FIELD_LABEL}>
                  Genes <span className="num text-ink">{formatNumber(genes)}</span>
                </label>
                <input
                  id={genesId}
                  type="range"
                  min={200}
                  max={5000}
                  step={100}
                  value={genes}
                  onChange={(event) => setGenes(Number(event.target.value))}
                  className="w-full accent-orange-500"
                />
                <p className="mt-1 text-[11px] leading-snug text-muted">
                  A focused library would be built from the Atlas screens closest to this design:
                  genes called in more than one of them, plus pathway neighbours. The Atlas is not
                  built yet, so nothing here selects genes.
                </p>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label htmlFor={perGeneId} className={FIELD_LABEL}>
                  Guides per gene
                </label>
                <input
                  id={perGeneId}
                  type="number"
                  min={2}
                  max={10}
                  value={guidesPerGene}
                  onChange={(event) => setGuidesPerGene(Number(event.target.value))}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor={coverageId} className={FIELD_LABEL}>
                  Cells per guide
                </label>
                <input
                  id={coverageId}
                  type="number"
                  min={100}
                  max={2000}
                  step={50}
                  value={coverage}
                  onChange={(event) => setCoverage(Number(event.target.value))}
                  className={FIELD}
                />
              </div>
              <div>
                <label htmlFor={effectId} className={FIELD_LABEL}>
                  Effect (LFC)
                </label>
                <input
                  id={effectId}
                  type="number"
                  min={0.3}
                  max={3}
                  step={0.1}
                  value={effect}
                  onChange={(event) => setEffect(Number(event.target.value))}
                  className={FIELD}
                />
              </div>
            </div>
          </div>
        </Panel>

        <PanelStack span={8}>
          <KpiStrip
            title="What this design needs"
            count={`${formatNumber(est.g)} genes, ${scope === "genome" ? "genome-wide" : "focused"}`}
            className="shrink-0"
            footer={
              <FootNote>
                {formatNumber(est.g)} genes × {guidesPerGene} guides + {CONTROL_GUIDES} controls, at{" "}
                {READS_PER_GUIDE} reads per guide
              </FootNote>
            }
          >
            <KpiTile
              label="Guides"
              value={formatNumber(est.guides)}
              denominator="in the library"
              definition={`${formatNumber(est.g)} genes × ${guidesPerGene}, plus ${CONTROL_GUIDES} non-targeting.`}
            />
            <KpiTile
              label="Cells per arm"
              value={formatNumber(est.cells)}
              denominator={`at ${coverage}×`}
              definition="Guides × cells per guide. Per arm, not per screen."
            />
            <KpiTile
              label="Reads per sample"
              value={formatNumber(est.reads)}
              denominator={`${READS_PER_GUIDE} per guide`}
              definition="Sequencing depth for one sample of one arm."
            />
            <KpiTile
              label="Replicates"
              value={formatNumber(est.replicates)}
              denominator={`for LFC ${effect.toFixed(1)}`}
              definition="A convention for this effect size, not a power result."
              tone="cyan"
            />
            <KpiTile
              label="Coverage floor"
              value={clearsFloor ? "Cleared" : "Below"}
              denominator={`${COVERAGE_FLOOR} cells per guide`}
              definition="A published rule of thumb, not a threshold SplicR derived."
              tone={clearsFloor ? "cyan" : "orange"}
            />
            <KpiTile
              label="Order of magnitude"
              value={`$${formatNumber(est.cost)}`}
              denominator={`${est.weeks} weeks`}
              definition="Guides, replicates and depth. An estimate, not a quote."
            />
          </KpiStrip>

          <div className="grid min-h-0 flex-1 grid-cols-12 gap-4">
            <Panel
              span={6}
              className="min-h-[180px] [animation-delay:60ms]"
              title="Why there is no power figure here"
            >
              <p className="text-[12px] leading-relaxed text-body">
                A power estimate for a pooled screen needs things this form does not collect and
                SplicR does not yet compute: a per-guide dispersion estimate from counts like yours,
                the alpha the test will run at, the replicate variance, the size of the library the
                correction runs over, and the shape of the effect-size distribution you expect.
                Without those, any percentage on this page would be a formula pretending to be a
                calculation. The six figures above are arithmetic on what you typed, and the
                coverage check is a rule of thumb from the literature rather than a threshold SplicR
                derived.
              </p>
            </Panel>

            <Panel
              span={6}
              className="min-h-[180px] [animation-delay:100ms]"
              title={scope === "focused" ? "Why focused" : "What genome-wide costs you"}
              count={model}
            >
              <p className="text-[12px] leading-relaxed text-body">
                A genome-wide library at {coverage}× coverage needs{" "}
                {formatNumber(GENOME_WIDE_GENES * guidesPerGene * coverage)} cells per arm. Primary
                cells usually cannot be expanded that far, which is the constraint that decides the
                scope before any statistic does. A {formatNumber(est.g)}-gene library needs{" "}
                {formatNumber(est.cells)} cells per arm instead, for the {phenotype.toLowerCase()}{" "}
                readout you described.
              </p>
            </Panel>
          </div>
        </PanelStack>
      </div>
    </div>
  );
}
