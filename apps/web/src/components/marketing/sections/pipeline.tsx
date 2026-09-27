import { WaveRibbons } from "@/components/three";
import { LinkButton, MarkerPill } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";
import { pipelineStages } from "@/lib/content";

export function Stepper() {
  return (
    <div className="relative">
      <div className="absolute left-0 right-0 top-[7px] h-px bg-line-strong" aria-hidden />
      <ol className="grid grid-cols-5 gap-2 sm:gap-4">
        {pipelineStages.map((s) => (
          <li key={s.n} className="flex flex-col items-center text-center">
            <span className="w-[15px] h-[15px] rounded-full border-2 border-line-strong bg-white flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-line-strong" />
            </span>
            <span className="mt-3 text-xs sm:text-sm text-ink font-medium">{s.n}</span>
            <span className="mt-1 text-[11px] sm:text-sm text-body leading-snug">{s.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PipelineSection() {
  return (
    <section className="py-14 md:py-20 overflow-hidden">
      <div className="container-x">
        <Reveal>
          <Stepper />
        </Reveal>
      </div>

      <div className="relative h-[280px] sm:h-[360px] md:h-[440px] mt-8">
        <WaveRibbons className="absolute inset-0" />
        <MarkerPill value="91%" tone="cyan" className="left-[20%] top-[24%]" />
        <MarkerPill value="9%" tone="cyan" className="left-[68%] top-[56%]" flip />
      </div>

      {/* Three columns for three children. This declared four, the first of them
          40px wide, so the heading was laid out in a 40px track and wrapped one
          character per line. */}
      <div className="container-x mt-4 grid lg:grid-cols-[1.1fr_1fr_auto] gap-6 lg:gap-10 items-center">
        <Reveal>
          <h2 className="display text-ink text-3xl md:text-4xl lg:text-5xl">
            One pipeline.
            <br />
            Every screen.
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="text-body leading-relaxed max-w-md">
            The same nine stages run on your upload and on every screen in the Atlas. That is what
            makes the numbers comparable, and the score calibrated.
          </p>
        </Reveal>
        <Reveal delay={0.2}>
          <LinkButton href="/pipeline" tone="orange" icon="none">
            See the pipeline
          </LinkButton>
        </Reveal>
      </div>
    </section>
  );
}
