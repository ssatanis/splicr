import { Wordmark } from "@/components/brand/logo";
import { MarketingNav } from "@/components/marketing/nav";
import { HeroField } from "@/components/three";
import { LinkButton, ScrollCue } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";

export function Hero() {
  return (
    <section className="relative min-h-[88vh] flex flex-col">
      <HeroField className="absolute inset-0" />

      <MarketingNav variant="pill" />

      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center container-x py-16 md:py-20">
        <Reveal>
          <span className="chip chip-dot text-orange-600 bg-cream">The answer key for CRISPR screens</span>
        </Reveal>

        <Reveal delay={0.1} className="w-full">
          <Wordmark
            tone="ink"
            className="mt-8 h-20 sm:h-28 md:h-36 lg:h-44 mx-auto max-w-[min(90vw,42rem)]"
          />
          <span className="sr-only">SplicR</span>
        </Reveal>

        <Reveal delay={0.2}>
          <p className="mt-8 max-w-xl text-lg md:text-xl leading-relaxed text-body text-balance">
            Know which hits are real before you spend months finding out.
          </p>
        </Reveal>

        <Reveal delay={0.3} className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <LinkButton href="/login" tone="teal" size="lg" icon="play">
            Try for free
          </LinkButton>
          <LinkButton href="/technology" tone="ghost" size="lg" icon="none">
            How it works
          </LinkButton>
        </Reveal>

        <Reveal delay={0.4} className="mt-12">
          <ScrollCue />
        </Reveal>
      </div>
    </section>
  );
}
