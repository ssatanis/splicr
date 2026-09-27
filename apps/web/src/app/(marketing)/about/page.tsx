import type { Metadata } from "next";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { Testimonials } from "@/components/marketing/sections/testimonials";
import { DarkHero } from "@/components/three";
import { SectionHeading } from "@/components/ui/bits";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description: "SplicR started at Weill Cornell Medicine to answer one question: which hits are real?",
};

const values = [
  { title: "Only claim what we measured", body: "Every number carries a source. Accuracy we have not benchmarked is accuracy we do not quote." },
  { title: "The record is the product", body: "The statistics are shared with the field. The record of which hits validated is not." },
  { title: "Never favor famous genes", body: "Our scores come from outcomes, so a never-studied gene can still be called real." },
  { title: "Private stays private", body: "Your outcomes tune only your model. Public screens stay public and citable." },
];

const timeline = [
  { when: "2025", what: "SplicR begins as a screen-analysis tool at Weill Cornell Medicine." },
  { when: "Early 2026", what: "AI agents make analysis free. We pivot to the answer key." },
  { when: "Mid 2026", what: "Atlas v0: every ORCS screen plus DepMap, cleaned and re-run." },
  { when: "Now", what: "Blind tests with design partners; AssayBench benchmark run." },
];

export default function AboutPage() {
  return (
    <main className="sheet sheet-dark">
      <MarketingNav variant="bar" />

      <section className="relative overflow-hidden">
        {/* Art is clipped to its own half on large screens and to a fixed
            band on small ones, so it never sits under the copy. */}
        <DarkHero className="hidden lg:block absolute inset-y-0 right-0 w-[52%] pointer-events-none" />
        <div className="relative container-x pt-12 pb-16 lg:pt-20 lg:pb-24">
          <div className="lg:max-w-[46%]">
            <Reveal>
              <h1 className="display text-white text-4xl sm:text-5xl lg:text-[4.2rem]">
                CRISPR, meet
                <br />
                supervised learning.
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 text-lg text-white/80 leading-relaxed">
                We turn the world&apos;s CRISPR screens into ground truth for the next one. Started
                at {site.founded}, built from {site.location}.
              </p>
            </Reveal>
          </div>

          <div className="relative lg:hidden h-56 my-8">
            <DarkHero className="absolute inset-0" />
          </div>

          <div className="mt-10 lg:mt-28 flex flex-wrap gap-y-5 divide-x divide-white/20">
            {[
              ["2,217", "Public screens"],
              ["1.8x", "Retrieval vs best AI"],
              ["334", "Held-out test screens"],
            ].map(([v, l]) => (
              <div key={l} className="px-6 first:pl-0">
                <div className="text-2xl md:text-3xl font-medium tabular-nums">{v}</div>
                <div className="text-white/70 text-xs md:text-sm mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white text-body py-16 md:py-24 rounded-t-[2rem]">
        <div className="container-x grid lg:grid-cols-2 gap-14">
          <Reveal>
            <SectionHeading
              eyebrow="Why we exist"
              title={
                <>
                  AI made analysis free.
                  <br />
                  Value moved to ground truth.
                </>
              }
              body="Anyone can get a screen analyzed for free now. What nobody has is an answer key: the record of which hits turned out to be real. We are building it."
            />
          </Reveal>
          <Stagger className="grid sm:grid-cols-2 gap-4">
            {values.map((v) => (
              <StaggerItem key={v.title} className="card-line p-7">
                <div className="text-ink text-lg font-medium">{v.title}</div>
                <p className="mt-3 text-sm leading-relaxed">{v.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>

        <div className="container-x mt-20 grid lg:grid-cols-[1fr_1.4fr] gap-14">
          <Reveal>
            <SectionHeading eyebrow="How we got here" title="A short timeline." />
          </Reveal>
          <div className="divide-y divide-line border-y border-line">
            {timeline.map((t) => (
              <div key={t.when} className="grid grid-cols-[120px_1fr] gap-6 py-6">
                <div className="text-orange-500 font-medium">{t.when}</div>
                <div className="text-ink">{t.what}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="bg-white">
        <Testimonials />
        <CtaSection />
      </div>
    </main>
  );
}
