import type { Metadata } from "next";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { DarkHero, SideCoil } from "@/components/three";
import { SectionHeading } from "@/components/ui/bits";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "SplicR was started by researchers at Cornell University to answer one question: which hits are real?",
};

const values = [
  {
    title: "Only claim what we measured",
    body: "Every number carries a source. Accuracy we have not benchmarked is accuracy we do not quote.",
  },
  {
    title: "The record is the product",
    body: "The statistics are shared with the field. The record of which hits validated is not.",
  },
  {
    title: "Never favour famous genes",
    body: "Our scores come from outcomes, so a never-studied gene can still be called real.",
  },
  {
    title: "Private stays private",
    body: "Your outcomes tune only your model. Public screens stay public and citable.",
  },
];

const timeline = [
  { when: "2025", what: "SplicR begins as a screen-analysis tool at Cornell University." },
  { when: "Early 2026", what: "Analysis becomes commodity. We pivot to the answer key." },
  { when: "Mid 2026", what: "Atlas v0: every public screen, cleaned and re-run one way." },
  { when: "Now", what: "Blind tests with design partners, benchmarked on AssayBench." },
];

/**
 * A founder's name, linked out. Underlined rather than recoloured, so the
 * sentence still reads as a sentence: this sits on the dark hero where a
 * link colour would either vanish or shout.
 */
function FounderLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-white underline decoration-white/40 underline-offset-4
                 hover:decoration-white transition-colors"
    >
      {children}
    </a>
  );
}

export default function AboutPage() {
  return (
    <main className="sheet">
      {/* The dark treatment is scoped to this section only. Applying it to the
          whole sheet made the headings in the white sections below render
          white on a light background. */}
      <section className="relative bg-teal-800 text-white overflow-hidden rounded-b-[2rem] lg:min-h-[640px]">
        <MarketingNav variant="bar" />
        {/* Art frames both edges, homepage-hero style, and sits behind the
            centered copy rather than sharing a column with it. */}
        <SideCoil mirror className="hidden lg:block absolute top-24 bottom-0 left-0 w-[34%] pointer-events-none" />
        <SideCoil className="hidden lg:block absolute top-24 bottom-0 right-0 w-[34%] pointer-events-none" />

        <div className="relative container-x pt-10 pb-16 lg:pt-0 lg:pb-0 lg:absolute lg:inset-0 lg:flex lg:flex-col lg:items-center lg:justify-center">
          <div className="lg:max-w-2xl lg:text-center">
            <Reveal>
              <h1 className="font-serif text-white leading-[0.95] tracking-[-0.02em] text-[clamp(2.4rem,6vw,4.4rem)]">
                Started by researchers
                <br />
                at Cornell University
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 text-lg text-white/90 leading-relaxed lg:max-w-lg lg:mx-auto">
                <FounderLink href="https://www.linkedin.com/in/sahajsatani/">
                  Sahaj Satani
                </FounderLink>{" "}
                and{" "}
                <FounderLink href="https://ishaansamantray.com/">
                  Ishaan Samantray
                </FounderLink>{" "}
                turn the world&apos;s CRISPR screens into ground truth for the next one.
              </p>
            </Reveal>
          </div>

          <div className="relative lg:hidden h-52 my-8">
            <DarkHero className="absolute inset-0" />
          </div>

          <div className="mt-10 lg:mt-10 flex flex-wrap justify-center gap-y-5 divide-x divide-white/20">
            {/* "1.8x, retrieval vs best AI" used to sit in the middle here. It
                was AssayBench's label-reading oracle divided by its model
                ensemble, so it was not a result of ours, and the technology
                page says plainly that the models are ahead of us. */}
            {[
              ["2,217", "Published screens indexed"],
              ["334", "Held-out test screens"],
            ].map(([v, l]) => (
              <div key={l} className="px-6 first:pl-0">
                <div className="text-2xl md:text-3xl font-medium tabular-nums">{v}</div>
                <div className="text-white/90 text-xs md:text-sm mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24">
        <div className="container-x grid lg:grid-cols-2 gap-12 lg:gap-16">
          <Reveal>
            <SectionHeading
              eyebrow="Why we exist"
              title={
                <>
                  Analysis became free.
                  <br />
                  Value moved to ground truth.
                </>
              }
              body="Anyone can get a screen analysed now. What nobody has is an answer key: the record of which hits turned out to be real. We are building it."
            />
          </Reveal>
          <Stagger className="grid sm:grid-cols-2 gap-4">
            {values.map((v) => (
              <StaggerItem key={v.title} className="card-line p-6">
                <div className="text-ink text-lg font-medium">{v.title}</div>
                <p className="mt-2.5 text-sm text-body leading-relaxed">{v.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>


      <section className="py-16 md:py-24">
        <div className="container-x grid lg:grid-cols-[1fr_1.4fr] gap-12 lg:gap-16">
          <Reveal>
            <SectionHeading eyebrow="How we got here" title="A short timeline." />
          </Reveal>
          <div className="divide-y divide-line border-y border-line">
            {timeline.map((t) => (
              <div key={t.when} className="grid grid-cols-[110px_1fr] gap-6 py-5">
                <div className="text-orange-500 font-medium">{t.when}</div>
                <div className="text-ink">{t.what}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaSection />
    </main>
  );
}
