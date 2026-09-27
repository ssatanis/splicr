import { LinkButton } from "@/components/ui/bits";
import { Reveal } from "@/components/ui/reveal";

export function CtaSection() {
  return (
    <section className="px-3 md:px-5 pb-6">
      <Reveal>
        <div className="relative rounded-[2rem] bg-orange-500 text-teal-950 overflow-hidden px-7 py-14 md:px-16 md:py-20">
          <svg
            aria-hidden
            className="absolute inset-0 w-full h-full opacity-25"
            viewBox="0 0 1200 500"
            preserveAspectRatio="none"
            fill="none"
            stroke="white"
            strokeWidth="1"
          >
            <path d="M700 520 L900 60 L1150 520" />
            <path d="M780 520 L960 160 L1180 520" />
            <circle cx="1000" cy="420" r="260" />
            <path d="M0 380 C300 200, 500 600, 900 340" />
          </svg>
          <div className="relative max-w-lg">
            <h2 className="display text-teal-950 text-3xl md:text-4xl lg:text-5xl">
              Bring us a finished screen.
            </h2>
            <p className="mt-5 text-teal-950/90 leading-relaxed">
              Do not tell us which hits worked. SplicR calls them blind, then you reveal the
              answer and we are scored on the spot.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <LinkButton href="/contact" tone="teal" icon="none">
                Request a blind test
              </LinkButton>
              <LinkButton href="/login" tone="white" icon="none">
                Try for free
              </LinkButton>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
