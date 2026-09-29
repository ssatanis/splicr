import { SideCoil } from "@/components/three";
import { LinkButton } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";

export function AgeSection() {
  return (
    <section className="relative overflow-hidden">
      <div className="grid lg:grid-cols-2 items-center">
        <div className="container-x py-14 lg:py-20 order-2 lg:order-1">
          <Reveal>
            <h2 className="display text-ink text-4xl md:text-5xl lg:text-[3.8rem]">
              Hundreds of hits.
              <br />
              Budget for twelve.
            </h2>
          </Reveal>
          <div className="mt-10 flex gap-6">
            <div className="max-w-md space-y-5 text-body leading-relaxed">
              <Reveal delay={0.1}>
                <p>
                  A screen can return hundreds of candidates. Effect size, guide support and technical artifacts all matter when choosing follow-up experiments.
                </p>
              </Reveal>
              <Reveal delay={0.2}>
                <p>
                  SplicR turns the accumulated record of every published screen into a judgement about yours — which candidates survive contact with a second experiment, and the evidence behind every call. Across 124 held-out screen pairs, nine of its top ten reproduced in an independent screen, against seven for the screen&apos;s own effect size.
                </p>
              </Reveal>
              <Reveal delay={0.3}>
                <LinkButton href="/technology" tone="cyan" size="sm" icon="none">
                  How it works
                </LinkButton>
              </Reveal>
            </div>
          </div>
        </div>

        <div className="relative h-[320px] sm:h-[420px] lg:h-[560px] order-1 lg:order-2">
          <SideCoil className="absolute inset-0" />
        </div>
      </div>
    </section>
  );
}
