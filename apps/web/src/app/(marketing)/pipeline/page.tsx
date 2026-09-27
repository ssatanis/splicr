import type { Metadata } from "next";

import { MarketingNav } from "@/components/marketing/nav";
import { PipelineDiagram } from "@/components/marketing/pipeline-diagram";
import { CtaSection } from "@/components/marketing/sections/cta";
import { WaveRibbons } from "@/components/three";
import { LinkButton, MarkerPill } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Pipeline",
  description:
    "From reads to a calibrated Hit Report in nine stages: ingest, detect, count, QC, hit calling, artifact flags, Atlas context, score and report.",
};

const numbers = [
  { value: "9", label: "Stages, start to finish" },
  { value: "4", label: "Hit callers, run side by side" },
  { value: "6", label: "Artifact checks per hit" },
];

export default function PipelinePage() {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      <section className="container-x pt-12 md:pt-20 pb-10">
        <Reveal>
          <h1 className="font-serif text-ink leading-[0.95] tracking-[-0.02em] text-[clamp(2.6rem,7vw,5.5rem)] max-w-3xl">
            From reads to a
            <br />
            calibrated answer
          </h1>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-6 max-w-xl text-lg text-body leading-relaxed">
            One pipeline runs on your screen and on every screen in the Atlas. That is
            what makes the numbers comparable.
          </p>
        </Reveal>

        <Reveal delay={0.2}>
          <div className="mt-10 flex flex-wrap gap-x-12 gap-y-5 border-y border-line py-6">
            {numbers.map((n) => (
              <div key={n.label}>
                <div className="text-3xl md:text-4xl font-medium text-ink tabular-nums">
                  {n.value}
                </div>
                <div className="mt-1 text-sm text-body">{n.label}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </section>

      <div className="relative h-[240px] sm:h-[320px] md:h-[400px] overflow-hidden">
        <WaveRibbons className="absolute inset-0" />
        <MarkerPill value="91%" tone="cyan" className="left-[20%] top-[24%]" />
        <MarkerPill value="9%" tone="cyan" className="left-[68%] top-[56%]" flip />
      </div>

      <section className="container-x py-16 md:py-24">
        <Reveal>
          <div className="eyebrow">The pipeline</div>
          <h2 className="mt-3 display text-ink text-3xl md:text-4xl lg:text-5xl max-w-2xl">
            Nine stages, each one inspectable.
          </h2>
        </Reveal>

        <div className="mt-12">
          <PipelineDiagram />
        </div>

        <Reveal delay={0.1}>
          <div className="mt-14 flex flex-wrap items-center gap-3">
            <LinkButton href="/login" tone="orange" icon="none">
              Run a screen
            </LinkButton>
            <LinkButton href="/technology" tone="ghost" icon="none">
              See the Atlas
            </LinkButton>
          </div>
        </Reveal>
      </section>

      <CtaSection />
    </main>
  );
}
