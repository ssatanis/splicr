import type { Metadata } from "next";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { SideCoil, AccentCoil } from "@/components/three";
import { LinkButton, SectionHeading } from "@/components/ui/bits";
import { Orb } from "@/components/ui/orb";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import {
  benchmark,
  benchmarkCite,
  comparisonCaveats,
  discoveryQuadrants,
  modules,
  proofPoints,
} from "@/lib/content";
import { Cite } from "@/components/ui/cite";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Technology",
  description:
    "Five parts that share one brain: the Atlas, the Hit Report, the Screen Planner, the Truth Loop and Connect.",
};

export default function TechnologyPage() {
  return (
    <main className="sheet">
      <MarketingNav variant="pill" />

      {/* Split hero: artwork left, copy right.
          Three marker pills reading 82%, 11% and 71% used to float over the
          ribbon, next to a zoom rail that zoomed nothing. On a page whose
          subject is a calibrated chance a hit is real, three loose percentages
          read as three scores, and they were not measurements of anything. The
          artwork carries the section on its own. */}
      <section className="grid lg:grid-cols-[1.15fr_1fr] min-h-[600px]">
        <div className="relative min-h-[460px] overflow-hidden">
          <SideCoil className="absolute inset-0" mirror />
        </div>

        <div className="container-x lg:pl-14 py-14 lg:py-20 flex flex-col justify-between">
          <div>
            <Reveal>
              <h1 className="display text-ink text-4xl sm:text-5xl lg:text-[4.2rem]">
                Screens, meet
                <br />
                the answer key.
              </h1>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-8 max-w-md text-lg text-body leading-relaxed">
                Precision statistics, plus the record of what actually validated.
              </p>
            </Reveal>
          </div>
          <div className="mt-16 flex items-end justify-between gap-8">
            <div className="flex gap-12">
              <div>
                <div className="text-4xl md:text-5xl font-medium text-orange-500 tracking-tight">2,217</div>
                <div className="mt-1 text-body">Published screens in BioGRID ORCS</div>
              </div>
              <div>
                <div className="text-4xl md:text-5xl font-medium text-orange-500 tracking-tight">1 pipeline</div>
                <div className="mt-1 text-body">Every screen, same way</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="py-16 md:py-24 bg-mist-soft">
        <div className="container-x">
          <Reveal>
            <SectionHeading
              eyebrow="Five parts, one brain"
              title={
                <>
                  Five parts,
                  <br />
                  one record.
                </>
              }
              body="The Atlas is the answer key. The other four are how labs use it, before and after a screen."
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
                    Real on one axis.
                    <br />
                    New on the other.
                  </>
                }
                body="Tools built on published literature push famous genes up. Our scores come from measured outcomes, so a never-studied gene can still be called real."
              />
            </Reveal>
            <Reveal delay={0.1} className="mt-8">
              <LinkButton href="/dashboard/screens/scr_demo?tab=map" tone="cyan">
                See it in the dashboard
              </LinkButton>
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            {/* A labelled 2x2, laid out as a real grid rather than a rotated
                label floated over the cards. The old version put the y axis in
                an absolutely positioned -rotate-90 span, which rotates about its
                centre, so a long label overhung the first card and sat on top of
                its text. writing-mode gives the track its true rotated width, so
                the gutter is sized correctly and nothing overlaps.

                The cards are also in their correct quadrants now. With "chance
                it is real" increasing rightwards and "how new" increasing
                upwards, real belongs on the right and new at the top, which puts
                "Real and new" in the top right where the eye goes. The previous
                order flipped both axes, so the map contradicted its own labels. */}
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
                chance it is real
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
                eyebrow="Where we stand today"
                title={
                  <>
                    Predicting a new screen,
                    <br />
                    including our own score.
                  </>
                }
                body="How well each method ranks a new screen's hits from its description alone. The frontier models are ahead of us here, and the top row is an oracle that reads the answers, so it is a ceiling rather than a result."
              />
            </Reveal>
            <p className="mt-6 text-sm text-white/80">
              <Cite cite={benchmarkCite} prefix="Source:" />
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
                  {/* Widths are a share of the oracle row, which is the ceiling
                      this whole chart is measured against. A 0 to 1 axis would
                      render every bar as a sliver and hide the differences the
                      section is about. */}
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        ours && "bg-orange-500",
                        b.tone === "teal" && "bg-cyan-400",
                        b.tone === "muted" && "bg-white/30",
                      )}
                      style={{ width: `${(b.value / 0.292) * 100}%` }}
                    />
                  </div>
                </StaggerItem>
              );
            })}
            <li className="pt-2 text-xs text-white/70 list-none">
              Higher is better. Bars are drawn against the oracle row.
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
                  checked against someone else.
                </>
              }
              body="Not our own benchmarks. Each of these is measured against a published screen or a published method, so it can be disagreed with."
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
              <LinkButton href="/pipeline" tone="ghost" icon="none">
                How the pipeline works
              </LinkButton>
            </div>
          </Reveal>
        </div>
      </section>


      {/* Where the other tool is the right answer */}
      <section className="py-16 md:py-24 bg-teal-800 text-white">
        <div className="container-x grid lg:grid-cols-[1fr_1.2fr] gap-14">
          <div>
            <Reveal>
              <SectionHeading
                tone="dark"
                eyebrow="Use something else"
                title={
                  <>
                    Six cases where
                    <br />
                    we are not the answer.
                  </>
                }
                body="If any of these is your question, the tool named will serve you better than we will, and two of them are about us rather than about you."
              />
            </Reveal>
            <Reveal delay={0.1} className="mt-8 flex items-center gap-4">
              <Orb size={110} />
              <Orb size={74} tone="cyan" />
            </Reveal>
          </div>
          <Stagger className="space-y-5">
            {comparisonCaveats.map((c) => (
              <StaggerItem key={c.title} className="rounded-2xl bg-white/10 p-6">
                <h3 className="font-medium text-white">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/90">{c.body}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <CtaSection />
    </main>
  );
}
