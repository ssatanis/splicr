import { marketingMetadata } from "@/lib/marketing-metadata";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { DarkHero, SideFrame } from "@/components/three";
import { SectionHeading } from "@/components/ui/bits";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";

export const metadata = marketingMetadata("/about", {
  title: "About Us",
  description:
    "SplicR was started by researchers at Cornell University to answer one question: which hits are real?",
});

const values = [
  {
    title: "Only claim what we measured",
    body: "Every number carries a source. Accuracy we have not benchmarked is accuracy we do not quote.",
  },
  {
    title: "The record is the product",
    body: "Useful evidence needs source data, assay context, reproducible analysis and permitted follow-up outcomes.",
  },
  {
    title: "Test for biological bias",
    body: "Frequent hits and familiar pathways can bias predictions. We examine these limitations and retain failed hypotheses.",
  },
  {
    title: "Private stays private",
    body: "Workspace records are access-scoped. No automatic training on customer outcomes is implemented; future reuse needs explicit permission.",
  },
];

const timeline = [
  { when: "Implemented", what: "Local analysis, method-specific statistics, QC and evidence reports." },
  { when: "Reproduced", what: "Official AssayBench references and four actual sequencing samples." },
  { when: "Measured", what: "New prediction candidates did not establish a benchmark advantage." },
  { when: "Outstanding", what: "Independent blinded validation and complete connected workspace workflows." },
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
        {/* One full-width canvas, homepage-hero style: the two coils sit at
            the far edges but nothing clips them at a container boundary, so
            they taper off naturally instead of ending in a hard box edge. */}
        <SideFrame className="hidden lg:block absolute inset-x-0 top-24 bottom-0 pointer-events-none" />

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
                are building tools to make CRISPR screen evidence easier to inspect and test.
              </p>
            </Reveal>
          </div>

          <div className="relative lg:hidden h-52 my-8">
            <DarkHero className="absolute inset-0" />
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
              body="Established tools analyze CRISPR screens. We are building traceable evidence and follow-up workflows around them. Independent outcomes are still needed to test whether our recommendations improve experimental decisions."
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
            <SectionHeading eyebrow="Current status" title="What the evidence supports." />
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
