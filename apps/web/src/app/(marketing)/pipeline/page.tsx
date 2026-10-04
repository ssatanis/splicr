import { marketingMetadata } from "@/lib/marketing-metadata";

import { MarketingNav } from "@/components/marketing/nav";
import { PipelineDiagram } from "@/components/marketing/pipeline-diagram";
import { CtaSection } from "@/components/marketing/sections/cta";
import { SideCoil } from "@/components/three";
import { LinkButton } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";

export const metadata = marketingMetadata("/pipeline", {
  title: "Pipeline",
  description:
    "From reads to an evidence report: ingest, detect, count, QC, hit calling, artifact flags, Atlas context and review.",
});

export default function PipelinePage() {
  return (
    <main className="sheet">
      {/* Same dark treatment as the Technology and About Us heroes: copy on
          the left, art on the right. Scoped to this section only. */}
      <section className="relative bg-teal-800 text-white overflow-hidden rounded-b-[2rem]">
        <MarketingNav variant="bar" />
        <SideCoil className="hidden lg:block absolute inset-y-0 right-0 w-[52%] pointer-events-none" />

        <div className="relative container-x pt-10 pb-16 lg:pt-16 lg:pb-24">
          <div className="lg:max-w-[46%]">
            <Reveal>
              <h1 className="font-serif text-white leading-[0.95] tracking-[-0.02em] text-[clamp(2.4rem,6vw,4.4rem)]">
                From reads to a
                <br />
                traceable report
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 text-lg text-white/90 leading-relaxed">
                Analyze available reads or counts with explicit QC and statistical methods.
                Atlas entries retain their source studies&apos; methods; they have not all
                been reprocessed through this pipeline. Validation probability is not yet available.
              </p>
            </Reveal>
          </div>

          <div className="relative lg:hidden h-52 my-8">
            <SideCoil className="absolute inset-0" />
          </div>
        </div>
      </section>

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
            <LinkButton href="/contact" tone="orange" icon="none">
              Request access
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
