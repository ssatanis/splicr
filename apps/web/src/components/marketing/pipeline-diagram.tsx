"use client";

import { motion, useInView } from "motion/react";
import { useRef, useState } from "react";

/**
 * The whole pipeline as one diagram.
 *
 * Replaces the long stage-by-stage table: nine nodes, what flows between
 * them, and the detail for one stage at a time. Reading it should take
 * seconds, not minutes.
 */

type Stage = {
  n: string;
  title: string;
  produces: string;
  detail: string;
  tools: string;
};

const STAGES: Stage[] = [
  {
    n: "01",
    title: "Ingest",
    produces: "Files and samples",
    detail: "FASTQ or counts upload straight to object storage in resumable chunks, so a dropped connection costs one chunk instead of the whole file.",
    tools: "Resumable upload, checksums, SRA fetch",
  },
  {
    n: "02",
    title: "Detect",
    produces: "Library and guide offset",
    detail: "The library is identified by sequence overlap, never by file name, and the spacer is located by scanning for the vector anchor. Staggered primers shift it by up to 8 bases, so a fixed trim would lose most reads.",
    tools: "Fingerprinting against every library in the Atlas",
  },
  {
    n: "03",
    title: "Count",
    produces: "Guide by sample matrix",
    detail: "Exact match first, then an unambiguous single-mismatch pass. Counted once and reused, so no two stages can disagree about a number.",
    tools: "Collapse to unique spacers, then map",
  },
  {
    n: "04",
    title: "QC",
    produces: "Pass, warn or fail",
    detail: "Gini on log counts, zero fraction, skew ratio, replicate agreement, and how far known essentials separate from nonessentials.",
    tools: "NNMD, AUROC, Gini, skew ratio",
  },
  {
    n: "05",
    title: "Call hits",
    produces: "One consensus table",
    detail: "Every method keeps its own columns. When two disagree, the report shows it rather than hiding it behind a single number.",
    tools: "MAGeCK RRA and MLE, BAGEL2, DrugZ",
  },
  {
    n: "06",
    title: "Flag artifacts",
    produces: "Named flags with evidence",
    detail: "Copy-number clusters, single-guide signal, promiscuous guides, multi-gene guides and frequent hitters, each with the evidence behind it.",
    tools: "Positional clustering, guide concordance, off-target counts",
  },
  {
    n: "07",
    title: "Atlas context",
    produces: "Similar screens and history",
    detail: "The nearest public screens, how often this gene has hit before, and how new the result is in this context.",
    tools: "Learned similarity over metadata and hit profile",
  },
  {
    n: "08",
    title: "Score",
    produces: "A calibrated chance",
    detail: "Fitted against validation outcomes and conditioned on effect size, because how often a hit survives a re-test depends on how strong it was to begin with.",
    tools: "Gradient boosting, isotonic calibration",
  },
  {
    n: "09",
    title: "Report",
    produces: "Hit Report and a plan",
    detail: "An interactive report, a Discovery Map, and a validation plan with guides, a plate map and an order file. Versioned, so a re-run never overwrites what was cited.",
    tools: "Discovery Map, validation plan, exports",
  },
];

export function PipelineDiagram() {
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const stage = STAGES[active];

  return (
    <div ref={ref} className="grid lg:grid-cols-[1.25fr_1fr] gap-8 lg:gap-14 items-start">
      <div>
        <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {STAGES.map((s, i) => {
            const selected = i === active;
            return (
              <motion.li
                key={s.n}
                initial={{ opacity: 0, y: 16 }}
                animate={inView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.45, delay: i * 0.045, ease: [0.22, 1, 0.36, 1] }}
              >
                <button
                  type="button"
                  onClick={() => setActive(i)}
                  aria-pressed={selected}
                  className={[
                    "w-full text-left rounded-2xl border p-4 transition-colors duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500",
                    selected
                      ? "border-teal-800 bg-teal-800 text-white"
                      : "border-line bg-white hover:border-line-strong",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "text-[0.65rem] tracking-[0.18em]",
                      selected ? "text-white/85" : "text-muted",
                    ].join(" ")}
                  >
                    {s.n}
                  </div>
                  <div
                    className={[
                      "mt-1 font-medium leading-tight",
                      selected ? "text-white" : "text-ink",
                    ].join(" ")}
                  >
                    {s.title}
                  </div>
                  <div
                    className={[
                      "mt-1 text-xs leading-snug",
                      selected ? "text-white/90" : "text-muted",
                    ].join(" ")}
                  >
                    {s.produces}
                  </div>
                </button>
              </motion.li>
            );
          })}
        </ol>

        <p className="mt-5 text-xs text-muted">
          Select a stage to see what it does. The same nine run on your upload and on
          every screen in the Atlas.
        </p>
      </div>

      <motion.div
        key={stage.n}
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="rounded-[1.5rem] border border-line bg-white p-6 md:p-8 lg:sticky lg:top-24"
      >
        <div className="eyebrow">{`Stage ${stage.n}`}</div>
        <h3 className="mt-3 text-2xl md:text-3xl text-ink font-medium tracking-tight">
          {stage.title}
        </h3>
        <p className="mt-4 text-body leading-relaxed">{stage.detail}</p>

        <dl className="mt-6 grid gap-4 text-sm">
          <div>
            <dt className="label-sm">Produces</dt>
            <dd className="text-ink mt-0.5">{stage.produces}</dd>
          </div>
          <div>
            <dt className="label-sm">How</dt>
            <dd className="text-ink mt-0.5">{stage.tools}</dd>
          </div>
        </dl>

        <div className="mt-6 progress-track">
          <motion.div
            className="progress-fill bg-orange-500"
            initial={false}
            animate={{ width: `${((active + 1) / STAGES.length) * 100}%` }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
      </motion.div>
    </div>
  );
}
