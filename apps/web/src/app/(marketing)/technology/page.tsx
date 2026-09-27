import type { Metadata } from "next";
import { Minus, Plus, ArrowUpRight } from "lucide-react";

import { MarketingNav } from "@/components/marketing/nav";
import { CtaSection } from "@/components/marketing/sections/cta";
import { SideCoil, AccentCoil } from "@/components/three";
import { LinkButton, MarkerPill, SectionHeading } from "@/components/ui/bits";
import { Orb } from "@/components/ui/orb";
import { Reveal, Stagger, StaggerItem } from "@/components/ui/reveal";
import { benchmark, benchmarkCite, discoveryQuadrants, moatLayers, modules } from "@/lib/content";
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
                eyebrow="Data beats a smarter AI"
                title={
                  <>
                    The gap is
                    <br />
                    the opportunity.
                  </>
                }
                body="How well each method predicts a new screen's hits. The answer usually sits in an older screen, and text search cannot find it."
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

      {/* Moat */}
      <section className="py-16 md:py-24 relative overflow-hidden">
        <AccentCoil className="absolute -right-24 top-0 w-[520px] h-[520px] opacity-90 hidden lg:block" />
        <div className="container-x relative">
          <Reveal>
            <SectionHeading
              eyebrow="Why it is hard to copy"
              title={
                <>
                  Anyone can copy an app.
                  <br />
                  Nobody can copy the record.
                </>
              }
              body="Labs upload screens and log which hits held up. The record grows, the scores sharpen, and more labs join."
            />
          </Reveal>
          <div className="mt-12 grid md:grid-cols-[1fr_auto] gap-10 items-start">
            <div className="divide-y divide-line border-y border-line">
              {moatLayers.map((m) => (
                <div key={m.layer} className="grid md:grid-cols-[1fr_1fr] gap-4 py-5">
                  <div className="text-ink font-medium">{m.layer}</div>
                  <div className="text-body">{m.copy}</div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4">
              <Orb size={120} />
              <Orb size={80} tone="cyan" />
            </div>
          </div>
          <div className="mt-10 flex items-center gap-4">
            <a href="/pipeline" className="inline-flex items-center gap-2 text-ink underline underline-offset-4">
              Read the full pipeline <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </section>

      <CtaSection />
    </main>
  );
}
