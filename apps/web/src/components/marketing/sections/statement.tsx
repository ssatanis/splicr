import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Cite } from "@/components/ui/cite";
import { Reveal } from "@/components/ui/reveal";
import { benchmarkCite } from "@/lib/content";

/* The middle two rows used to read "1.8x retrieval vs best AI" and "0.29
   oracle AnDCG@100". That ratio came from dividing AssayBench's oracle, which
   reads the test labels, by its model ensemble, so it credited us with a
   ceiling nobody can reach. These are the two comparable scores instead.

   Ours read 0.136 until 2026-09-27, when `orcs_retrieval_rate` was scored on
   the test split for the first time and returned 0.1628. The old 0.136 was
   upstream's own hit-frequency prior, not a SplicR method. The two numbers are
   now equal to three decimals and our 95% CI [0.1358, 0.1900] contains theirs,
   so the copy below says we match them and must never say we beat them. */
const stats = [
  { value: "2,217", suffix: "", label: "Published screens indexed" },
  { value: "334", suffix: "", label: "Held-out test screens" },
  { value: "0.163", suffix: "", label: "Our score on that split" },
  { value: "0.163", suffix: "", label: "Best frontier ensemble" },
];

export function StatementCard() {
  return (
    <section className="bg-peach-soft py-6 md:py-10">
      <div className="container-x">
        <Reveal>
          <div className="rounded-[2rem] bg-white/95 shadow-soft px-6 py-12 sm:px-10 md:px-14 md:py-18 relative overflow-hidden">
            <div
              aria-hidden
              className="absolute -top-40 -right-40 w-[520px] h-[520px] rounded-full bg-[radial-gradient(circle,rgba(253,215,169,0.5),transparent_62%)]"
            />
            <div className="relative grid md:grid-cols-[56px_1fr] gap-4">
              <span className="text-xs text-ink/60 font-medium pt-3">01</span>
              <h2 className="display text-ink text-2xl sm:text-3xl md:text-4xl lg:text-[2.9rem] leading-[1.18] max-w-3xl text-balance">
                SplicR pairs every public screen with the record of which hits held up, to give{" "}
                <span className="text-orange-500">calibrated confidence</span> for every hit in yours.
              </h2>
            </div>

            <div className="relative mt-14 grid lg:grid-cols-[1.25fr_1fr] gap-10 lg:gap-16 items-end">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-10">
                {stats.map((s) => (
                  <div key={s.label} className="min-w-0">
                    <div className="flex items-baseline gap-0.5">
                      <span className="text-3xl sm:text-4xl lg:text-5xl font-medium tracking-tight text-ink tabular-nums">
                        {s.value}
                      </span>
                      {s.suffix && (
                        <span className="text-xl lg:text-2xl text-orange-500 font-medium">{s.suffix}</span>
                      )}
                    </div>
                    <div className="mt-2 text-sm text-muted leading-snug">{s.label}</div>
                  </div>
                ))}
              </div>

              <div className="max-w-sm">
                <Link
                  href="/technology"
                  className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-cyan-500 text-white hover:bg-cyan-600 transition-colors"
                  aria-label="Explore the technology"
                >
                  <ArrowUpRight className="w-5 h-5" />
                </Link>
                <p className="mt-6 text-body leading-relaxed">
                  On this benchmark we match the frontier models, by retrieving over 1,574
                  published screens rather than recalling literature. They still cannot read your
                  counts, see the amplified segment your hits sit in, or say how often a call at
                  that confidence held up. That is the part we work on.
                </p>
                <p className="mt-3 text-xs text-muted">
                  <Cite cite={benchmarkCite} prefix="Source:" />
                </p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
