import type { Metadata } from "next";
import { Search } from "lucide-react";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { Stepper } from "@/components/marketing/sections/pipeline";
import { WaveRibbons } from "@/components/three";
import { Dots, LinkButton, MarkerPill, SectionHeading } from "@/components/ui/bits";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { howItWorks } from "@/lib/content";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pipeline",
  description:
    "From FASTQ to a calibrated Hit Report: ingest, detect, count, QC, hit calling, artifact flags, Atlas context, score and report.",
};

const stageDetail = [
  {
    title: "Ingest",
    tools: "Resumable upload, checksums, SRA fetch",
    in: "FASTQ(.gz), count tables, MAGeCK output, or an SRA accession",
    out: "A screen record with files, samples and a design sketch",
    notes: "Multi-gigabyte files upload directly to object storage in 6 MB chunks and resume if the browser closes.",
  },
  {
    title: "Detect",
    tools: "Library fingerprinting, anchor scan",
    in: "First 200k reads, or the guide column of a count table",
    out: "Library call with match rate, guide position and strand, design proposal",
    notes: "Guides are matched against Brunello, GeCKOv2, TKOv3, Avana, Humagne, Yusa and more by sequence-set overlap, not by file name.",
  },
  {
    title: "Count",
    tools: "Exact match, 1-mismatch fallback, MAGeCK count",
    in: "Reads plus the detected library",
    out: "Guide × sample count matrix, mapping summary",
    notes: "Counts are produced once and stored as Parquet. Every downstream stage reads the same matrix.",
  },
  {
    title: "QC",
    tools: "Gini, zero fraction, skew ratio, replicate agreement, control separation",
    in: "Count matrix, design, essential and nonessential gene sets",
    out: "Per-sample and per-screen QC with pass, warn, fail verdicts",
    notes: "Each metric is compared against the Atlas distribution for the same library, so 'high' means high for that library, not in the abstract.",
  },
  {
    title: "Call hits",
    tools: "MAGeCK RRA and MLE, BAGEL2, DrugZ, CRISPRcleanR",
    in: "Count matrix, design, control guides",
    out: "One consensus hit table with per-method statistics",
    notes: "Methods are run in parallel and never silently overwritten. Copy-number correction is applied when coordinates are known.",
  },
  {
    title: "Flag artifacts",
    tools: "Positional clustering, guide concordance, off-target counts, frequent-hitter lookup",
    in: "Hit table, guide coordinates, Atlas hit frequencies",
    out: "Named flags with evidence per hit",
    notes: "Copy number, one-guide hits, promiscuous guides, generic essentials and bottlenecked replicates each get their own flag and reason.",
  },
  {
    title: "Atlas context",
    tools: "Similar-screen retrieval, hit history",
    in: "Screen metadata, hit profile",
    out: "Nearest screens, each hit's history and novelty",
    notes: "A learned sense of 'similar' closes part of the gap between text search (0.065) and the right past screen (0.292).",
  },
  {
    title: "Score",
    tools: "Gradient boosting, isotonic calibration, conformal bounds",
    in: "Statistics, flags, Atlas features, validation outcomes",
    out: "Chance real, calibration band, top reasons",
    notes: "When SplicR says 80%, about 8 in 10 of those hits validate. The model is retrained as outcomes are logged.",
  },
  {
    title: "Report",
    tools: "Hit Report, Discovery Map, validation plan",
    in: "Everything above",
    out: "Interactive report, PDF, CSV, and a validation plan with guides, plate map and order file",
    notes: "Reports are versioned. A re-run never overwrites what a lab already cited.",
  },
];

export default function PipelinePage() {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      <section className="container-x pt-10 md:pt-16">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <Reveal>
            <h1 className="display text-ink text-5xl md:text-6xl lg:text-7xl">
              Cas9 to
              <br />
              Calibrated.
            </h1>
          </Reveal>
          <div className="flex items-center gap-3 rounded-full border border-line-strong px-5 py-3 text-muted w-full md:w-80">
            <Search className="w-4 h-4" />
            <span className="text-sm">Search a stage, tool or metric…</span>
          </div>
        </div>
        <div className="mt-12">
          <Reveal>
            <Stepper />
          </Reveal>
        </div>
      </section>

      <div className="relative h-[360px] md:h-[440px] mt-6 overflow-hidden">
        <WaveRibbons className="absolute inset-0" />
        <MarkerPill value="57.2%" tone="cyan" className="left-[24%] top-[24%]" />
        <MarkerPill value="12.87%" tone="cyan" className="left-[66%] top-[56%]" flip />
      </div>

      <section className="container-x pb-20 grid lg:grid-cols-[40px_1fr_1fr_auto] gap-8 items-center">
        <Dots />
        <Reveal>
          <h2 className="display text-ink text-4xl md:text-5xl">
            One pipeline.
            <br />
            Every screen.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-body leading-relaxed max-w-md">
            The same nine stages run on your upload and on every public screen in the Atlas.
            That is what makes the numbers comparable, and what makes the score calibrated.
          </p>
        </Reveal>
        <LinkButton href="/dashboard/upload" tone="orange">
          Start a run
        </LinkButton>
      </section>

      {/* How it works cards, from the mobile reference */}
      <section className="bg-mist-soft py-20 md:py-28">
        <div className="container-x">
          <Reveal>
            <SectionHeading align="center" title="How It Works" />
          </Reveal>
          <Stagger className="mt-12 grid md:grid-cols-3 gap-4">
            {howItWorks.map((s, i) => (
              <StaggerItem
                key={s.n}
                className={cn(
                  "rounded-2xl p-6 flex items-center justify-between",
                  i % 3 === 1 ? "bg-teal-800 text-white" : "bg-white border border-line",
                )}
              >
                <div className="flex items-start gap-3">
                  <span className={cn("mt-2 w-1.5 h-1.5 rounded-full", i % 3 === 1 ? "bg-orange-400" : "bg-orange-500")} />
                  <div>
                    <div className={cn("text-lg font-medium", i % 3 === 1 ? "text-white" : "text-ink")}>{s.title}</div>
                    <div className={cn("text-sm", i % 3 === 1 ? "text-white/70" : "text-body")}>{s.sub}</div>
                  </div>
                </div>
                <span className={cn("text-3xl font-light", i % 3 === 1 ? "text-white" : "text-cyan-500")}>{s.n}</span>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Stage detail */}
      <section className="py-20 md:py-28">
        <div className="container-x">
          <Reveal>
            <SectionHeading
              eyebrow="Stage by stage"
              title="What goes in, what comes out."
              body="Every stage writes a versioned artifact and a row in the jobs table. Nothing is recomputed unless its inputs changed."
            />
          </Reveal>
          <div className="mt-12 divide-y divide-line border-y border-line">
            {stageDetail.map((s, i) => (
              <Reveal key={s.title} delay={0.03 * i}>
                <div className="grid md:grid-cols-[80px_1fr_1fr_1fr] gap-6 py-8">
                  <div className="text-cyan-600 font-medium">0{i + 1}</div>
                  <div>
                    <div className="text-2xl text-ink font-medium">{s.title}</div>
                    <div className="mt-2 text-sm text-muted">{s.tools}</div>
                  </div>
                  <div className="text-sm">
                    <div className="label-sm">In</div>
                    <div className="text-ink mt-1">{s.in}</div>
                    <div className="label-sm mt-4">Out</div>
                    <div className="text-ink mt-1">{s.out}</div>
                  </div>
                  <div className="text-body text-sm leading-relaxed">{s.notes}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <CtaSection />
    </main>
  );
}
