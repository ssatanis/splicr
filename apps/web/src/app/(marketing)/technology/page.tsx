import { marketingMetadata } from "@/lib/marketing-metadata";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { Faq } from "@/components/marketing/faq";
import { SideCoil, AccentCoil } from "@/components/three";
import { LinkButton, SectionHeading } from "@/components/ui/bits";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import {
  benchmark,
  benchmarkCite,
  replicationCite,
  faq,
  discoveryQuadrants,
  modules,
  proofPoints,
} from "@/lib/content";
import { Cite } from "@/components/ui/cite";
import { cn } from "@/lib/utils";

export const metadata = marketingMetadata("/technology", {
  title: "Technology",
  description:
    "Explore SplicR's screen analysis, published evidence, planning estimates, outcome records and REST integration.",
});

export default function TechnologyPage() {
  return (
    <main className="sheet">
      {/* Same dark treatment as the About Us hero, mirrored: art on the left,
          copy on the right. Scoped to this section only, same as About. */}
      <section className="relative bg-teal-800 text-white overflow-hidden rounded-b-[2rem]">
        <MarketingNav variant="bar" />
        <SideCoil mirror className="hidden lg:block absolute inset-y-0 left-0 w-[52%] pointer-events-none" />

        <div className="relative container-x pt-10 pb-16 lg:pt-16 lg:pb-24">
          <div className="lg:max-w-[46%] lg:ml-auto">
            <Reveal>
              <h1 className="font-serif text-white leading-[0.95] tracking-[-0.02em] text-[clamp(2.4rem,6vw,4.4rem)]">
                CRISPR screens,
                <br />
                with context.
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-md text-lg text-white/90 leading-relaxed">
                Screen statistics, published context and inspectable evidence.
              </p>
            </Reveal>
          </div>

          <div className="relative lg:hidden h-52 my-8">
            <SideCoil mirror className="absolute inset-0" />
          </div>

          <div className="mt-10 lg:mt-16 lg:ml-auto lg:max-w-[46%] flex flex-wrap gap-y-5 divide-x divide-white/20">
            {[
              ["2,217", "ORCS v2.0.18 reference screens"],
              ["1 workflow", "QC, hit calling and evidence review"],
            ].map(([v, l]) => (
              <div key={l} className="px-6 first:pl-0">
                <div className="text-2xl md:text-3xl font-medium tabular-nums text-orange-400">{v}</div>
                <div className="text-white/90 text-xs md:text-sm mt-1">{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="py-16 md:py-24 bg-mist-soft">
        <div className="container-x">
          <Reveal>
            <SectionHeading
              eyebrow="Capabilities and status"
              title={
                <>
                  Five parts,
                  <br />
                  one record.
                </>
              }
              body="Public workspace access is not enabled. The analysis engine and research tools are implemented locally; workspace and demonstration features have different availability, stated below."
            />
          </Reveal>

          <div className="mt-14 space-y-6">
            {modules.map((m, i) => (
              <Reveal key={m.id} delay={0.05 * i}>
                <article
                  id={m.id}
                  className={cn(
                    "grid lg:grid-cols-[1fr_1.3fr] gap-8 rounded-[1.75rem] p-8 md:p-12 scroll-mt-24",
                    i % 2 === 0 ? "bg-white shadow-card" : "bg-teal-800 text-white",
                  )}
                >
                  <div>
                    <div className={cn("eyebrow", i % 2 === 0 ? "eyebrow-orange" : "text-cyan-400")}>{m.eyebrow}</div>
                    <h3 className={cn("mt-3 text-3xl md:text-4xl font-medium tracking-tight", i % 2 === 0 ? "text-ink" : "text-white")}>
                      {m.title}
                    </h3>
                    <p className={cn("mt-5 leading-relaxed max-w-md", i % 2 === 0 ? "text-body" : "text-white/90")}>{m.blurb}</p>
                    <p className="mt-4 text-sm font-medium">Status: {m.status}</p>
                  </div>
                  <ul className="grid sm:grid-cols-3 gap-4 content-start">
                    {m.points.map((p) => (
                      <li
                        key={p}
                        className={cn(
                          "rounded-2xl p-5 text-sm leading-relaxed",
                          i % 2 === 0 ? "bg-mist-soft text-ink" : "bg-white/10 text-white",
                        )}
                      >
                        {p}
                      </li>
                    ))}
                  </ul>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Discovery Map */}
      <section className="py-16 md:py-24">
        <div className="container-x grid lg:grid-cols-2 gap-14 items-center">
          <div>
            <Reveal>
              <SectionHeading
                eyebrow="The Discovery Map"
                title={
                  <>
                    Evidence on one axis.
                    <br />
                    New on the other.
                  </>
                }
                body="A conceptual way to separate experimental support from how well a gene is studied. These categories guide review; they do not establish that a hit is real or provide a calibrated validation probability."
              />
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            {/* A labelled 2x2, laid out as a real grid rather than a rotated
                label floated over the cards. The old version put the y axis in
                an absolutely positioned -rotate-90 span, which rotates about its
                centre, so a long label overhung the first card and sat on top of
                its text. writing-mode gives the track its true rotated width, so
                the gutter is sized correctly and nothing overlaps.

                Evidence increases rightwards and novelty upwards. The labels
                describe a conceptual review aid, not measured probabilities. */}
            <div className="grid grid-cols-[auto_1fr] grid-rows-[1fr_auto] gap-x-3 gap-y-2">
              <div
                className="row-start-1 col-start-1 flex items-center justify-center
                           text-[0.7rem] tracking-[0.2em] uppercase text-muted"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                how new it is
              </div>

              <div className="row-start-1 col-start-2 grid grid-cols-2 gap-3">
                {discoveryQuadrants.map((q) => (
                  <div
                    key={q.title}
                    className={cn(
                      "rounded-2xl p-6 min-h-[150px] flex flex-col justify-end",
                      q.tone === "orange" && "bg-orange-500 text-white",
                      q.tone === "teal" && "bg-teal-800 text-white",
                      q.tone === "muted" && "bg-mist-soft text-ink",
                    )}
                  >
                    <div className="font-medium text-lg">{q.title}</div>
                    <div
                      className={cn(
                        "text-sm mt-1",
                        q.tone === "muted" ? "text-body" : "text-white/90",
                      )}
                    >
                      {q.body}
                    </div>
                  </div>
                ))}
              </div>

              <div className="row-start-2 col-start-2 text-[0.7rem] tracking-[0.2em] uppercase text-muted text-center">
                strength of evidence
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Benchmark */}
      <section className="py-16 md:py-24 bg-teal-800 text-white">
        <div className="container-x grid lg:grid-cols-[1fr_1.2fr] gap-14">
          <div>
            <Reveal>
              <SectionHeading
                tone="dark"
                eyebrow="Measured research comparison"
                title={
                  <>
                    Level with the frontier,
                    <br />
                    screen for screen.
                  </>
                }
                body="SplicR, built on published rankings, ties the frontier ensemble on the same library, 0.220 to 0.219. After the screen, it adds published-screen history to effect size: 9.2 of its top ten reproduce in an independent screen, up from 7.0 on effect size alone."
              />
            </Reveal>
            <p className="mt-6 text-sm text-white/80">
              <Cite cite={benchmarkCite} prefix="Chart:" />
            </p>
            <p className="mt-1 text-sm text-white/80">
              <Cite cite={replicationCite} prefix="9.2 of 10:" />
            </p>
          </div>
          <Stagger className="space-y-5">
            {benchmark.map((b) => {
              const ours = b.tone === "orange";
              return (
                <StaggerItem key={b.label}>
                  <div className="flex items-baseline justify-between gap-6 mb-2">
                    <span
                      className={cn(
                        "text-sm leading-snug",
                        ours ? "text-white font-medium" : "text-white/80",
                      )}
                    >
                      {b.label}
                    </span>
                    <span
                      className={cn(
                        "tabular-nums tracking-tight shrink-0",
                        ours ? "text-2xl text-orange-400 font-medium" : "text-lg text-white/90",
                      )}
                    >
                      {b.value.toFixed(3)}
                    </span>
                  </div>
                  {/* Widths are a share of the oracle reference row (the first entry). A
                      0 to 1 axis would render every bar as a sliver and hide the
                      differences the section is about. */}
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        ours && "bg-orange-500",
                        b.tone === "teal" && "bg-cyan-400",
                        b.tone === "muted" && "bg-white/30",
                      )}
                      style={{ width: `${(b.value / benchmark[0].value) * 100}%` }}
                    />
                  </div>
                </StaggerItem>
              );
            })}
            <li className="pt-2 text-xs text-white/70 list-none">
              Higher AnDCG is better; it is not percent accuracy. A retrospective replay, not prospective validation. Bars scale to the oracle, which is not a ceiling.
            </li>
          </Stagger>
        </div>
      </section>

      {/* Four numbers, each legible without a background in screening */}
      <section className="py-16 md:py-24 relative overflow-hidden">
        <AccentCoil className="absolute -right-24 top-0 w-[520px] h-[520px] opacity-90 hidden lg:block" />
        <div className="container-x relative">
          <Reveal>
            <SectionHeading
              eyebrow="What we measured"
              title={
                <>
                  Four numbers,
                  <br />
                  with their limitations.
                </>
              }
              body="Measured benchmark and real-data checks, including a failed research hypothesis. Inspect downloadable evidence, data provenance and uncertainty on the Evidence page."
            />
          </Reveal>

          <div className="mt-14 grid sm:grid-cols-2 gap-5">
            {proofPoints.map((p, i) => (
              <Reveal key={p.id} delay={0.05 * i}>
                <article className="h-full card-line p-8 flex flex-col">
                  <div className="flex items-baseline gap-3">
                    <span className="font-serif text-ink leading-none text-[clamp(2.6rem,5vw,3.6rem)]">
                      {p.figure}
                    </span>
                    <span className="text-sm text-muted">{p.scale}</span>
                  </div>
                  <h3 className="mt-6 text-lg text-ink font-medium leading-snug">{p.title}</h3>
                  <p className="mt-2.5 text-body leading-relaxed">{p.body}</p>
                </article>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1}>
            <div className="mt-10">
              <LinkButton href="/evidence" tone="ghost" icon="none">
                Inspect the measured evidence
              </LinkButton>
            </div>
          </Reveal>
        </div>
      </section>



      {/* FAQ */}
      <section className="py-16 md:py-24 bg-mist-soft">
        <div className="container-x grid lg:grid-cols-[0.8fr_1.4fr] gap-12 lg:gap-20">
          <div>
            <Reveal>
              <SectionHeading
                eyebrow="Questions"
                title={
                  <>
                    The ones we
                    <br />
                    get asked.
                  </>
                }
              />
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            <Faq items={faq} />
          </Reveal>
        </div>
      </section>

      <CtaSection />
    </main>
  );
}
