import type { Metadata } from "next";
import { Minus, Plus, ArrowUpRight } from "lucide-react";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { SideCoil, AccentCoil } from "@/components/three";
import { LinkButton, MarkerPill, SectionHeading } from "@/components/ui/bits";
import { Orb } from "@/components/ui/orb";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import {
  benchmark,
  benchmarkCite,
  comparison,
  comparisonCaveats,
  discoveryQuadrants,
  modules,
  verifiedClaims,
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

      {/* Split hero: ribbon with zoom rail and markers, copy on the right */}
      <section className="grid lg:grid-cols-[1.15fr_1fr] min-h-[600px]">
        <div className="relative min-h-[460px] overflow-hidden">
          <SideCoil className="absolute inset-0" mirror />
          <div className="absolute left-6 md:left-10 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3 text-ink/70" aria-hidden>
            <span className="w-7 h-7 rounded-full border border-line-strong bg-white flex items-center justify-center">
              <Plus className="w-3.5 h-3.5" />
            </span>
            <span className="w-px h-28 bg-line-strong relative">
              <span className="absolute left-1/2 -translate-x-1/2 top-2 w-[3px] h-14 bg-ink rounded-full" />
            </span>
            <span className="w-7 h-7 rounded-full border border-line-strong bg-white flex items-center justify-center">
              <Minus className="w-3.5 h-3.5" />
            </span>
          </div>
          <MarkerPill value="82%" className="left-[48%] top-[18%]" />
          <MarkerPill value="11%" className="left-[18%] top-[62%]" />
          <MarkerPill value="71%" className="left-[70%] top-[66%]" />
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
                <div className="mt-1 text-body">Public screens</div>
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
          <Stagger className="space-y-3">
            {benchmark.map((b) => (
              <StaggerItem key={b.label} className="grid grid-cols-[1fr_auto] gap-4 items-center">
                <div>
                  <div className="text-sm text-white/90 mb-1.5">{b.label}</div>
                  <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        b.tone === "orange" && "bg-orange-500",
                        b.tone === "teal" && "bg-cyan-500",
                        b.tone === "muted" && "bg-white/40",
                      )}
                      style={{ width: `${(b.value / 0.3) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="text-lg font-medium tabular-nums w-14 text-right">{b.value.toFixed(3)}</div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* What we measured that the alternatives do not do */}
      <section className="py-16 md:py-24 relative overflow-hidden">
        <AccentCoil className="absolute -right-24 top-0 w-[520px] h-[520px] opacity-90 hidden lg:block" />
        <div className="container-x relative">
          <Reveal>
            <SectionHeading
              eyebrow="What we measured"
              title={
                <>
                  Seven things we can
                  <br />
                  show you the number for.
                </>
              }
              body="Each of these is reproducible from this codebase, and the file that produces it is named. Where a figure comes from one screen we say so, because one screen is one screen."
            />
          </Reveal>
          <ol className="mt-12 divide-y divide-line border-y border-line">
            {verifiedClaims.map((c, i) => (
              <Reveal key={c.id} delay={0.04 * i}>
                <li className="grid md:grid-cols-[1fr_1.6fr] gap-4 md:gap-10 py-6">
                  <h3 className="text-ink font-medium leading-snug">{c.claim}</h3>
                  <div>
                    <p className="text-body leading-relaxed">{c.measured}</p>
                    <p className="mt-2 text-sm text-muted font-mono">{c.checkedIn}</p>
                  </div>
                </li>
              </Reveal>
            ))}
          </ol>
          <div className="mt-10 flex items-center gap-4">
            <a href="/pipeline" className="inline-flex items-center gap-2 text-ink underline underline-offset-4">
              Read the full pipeline <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      {/* The alternatives, each on its own terms */}
      <section className="py-16 md:py-24 bg-mist-soft">
        <div className="container-x">
          <Reveal>
            <SectionHeading
              eyebrow="The alternatives"
              title={
                <>
                  What else a lab
                  <br />
                  would reasonably use.
                </>
              }
              body="Most of these are free, and three of them run inside our own pipeline. The point of listing what each one is good at is that it is the only way the previous section means anything."
            />
          </Reveal>

          {/* Cards rather than a four-column table: the same content reflows to
              one column on a phone without changing markup, so the row and
              field association a table would carry is not something a screen
              reader loses at a breakpoint. Each field keeps its own <dt>, so
              "Good at" is read out with its answer either way. */}
          <div className="mt-14 grid md:grid-cols-2 xl:grid-cols-3 gap-5">
            {comparison.map((row, i) => (
              <Reveal key={row.id} delay={0.03 * i}>
                <article className="h-full rounded-[1.5rem] bg-white shadow-card p-7 flex flex-col">
                  <div className="eyebrow eyebrow-orange">{row.kind}</div>
                  <h3 className="mt-3 text-xl font-medium text-ink tracking-tight">{row.name}</h3>
                  <dl className="mt-5 space-y-4 text-sm leading-relaxed flex-1">
                    <div>
                      <dt className="text-ink font-medium">Good at</dt>
                      <dd className="mt-1 text-body">{row.good}</dd>
                    </div>
                    <div>
                      <dt className="text-ink font-medium">Does not do</dt>
                      <dd className="mt-1 text-body">{row.gap}</dd>
                    </div>
                    <div>
                      <dt className="text-ink font-medium">Cost</dt>
                      <dd className="mt-1 text-body">{row.cost}</dd>
                    </div>
                  </dl>
                  <p className="mt-6 pt-4 border-t border-line text-sm text-muted">
                    <Cite cite={row.cite} />
                  </p>
                </article>
              </Reveal>
            ))}
          </div>
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
