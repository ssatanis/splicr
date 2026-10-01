/**
 * What a lab sees on its first day, before it has a screen in the workspace.
 *
 * The three-zone overview is built to answer "what is waiting on a decision", and on
 * an empty workspace the honest answer to all three is nothing. Three zeros and an
 * empty list is not a welcome, it is a page that looks broken, and the first thing a
 * pilot lab would conclude is that the product does not work.
 *
 * So the overview shows this instead until the first screen lands.
 *
 * WHAT THIS DELIBERATELY DOES NOT SAY
 *
 * It does not offer to upload a screen. `app/dashboard/upload/page.tsx` tells a
 * signed-in workspace that "browser analysis is not connected": storage holds no
 * objects, `public.jobs` has no insert policy for a browser, and nothing in engine/
 * consumes a queue. Analysis today is a run of the CLI by someone here.
 *
 * A first-run screen that promised self-serve upload would be caught inside thirty
 * seconds, on the one page whose whole job is to earn a lab's trust before it hands
 * over unpublished data. So the real path is named as what it is: send us the counts,
 * we run the engine, the results appear here. That is concierge onboarding, it is what
 * is actually happening, and saying so costs nothing next to being found out.
 */
import Link from "next/link";

export function FirstRun({ orgName, contactHref }: { orgName: string; contactHref: string }) {
  return (
    <div className="flex flex-col gap-8 pb-4">
      {/* ---------- the welcome ---------- */}
      <section className="overflow-hidden rounded-2xl border border-line bg-white">
        <div className="grid gap-8 p-8 sm:p-10 lg:grid-cols-[1.15fr_.85fr] lg:items-center">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">
              {orgName}
            </p>
            <h1 className="mt-3 font-serif text-[2.4rem] leading-[1.05] tracking-[-0.01em] text-ink">
              Your workspace is ready.
              <br />
              It has no screens yet.
            </h1>
            <p className="mt-4 max-w-[46ch] text-[14px] leading-relaxed text-body">
              Send us a count table and we will run it through the pipeline. The
              results land here, with the evidence behind every call.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={contactHref} className="btn btn-orange btn-sm">
                Send us a screen
              </Link>
            </div>
          </div>

          {/* A quiet picture of the thing they are being sold: guides agreeing,
              and one that does not. No data, no numbers, just the shape. */}
          <div className="hidden rounded-xl bg-cream/70 p-7 lg:block" aria-hidden="true">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
              What you get back
            </p>
            <div className="mt-4 space-y-2.5">
              {[92, 84, 88].map((w, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <span className="w-5 text-right text-[9.5px] text-muted">g{i + 1}</span>
                  <span className="h-2.5 flex-1 rounded-sm bg-white">
                    <span
                      className="block h-full rounded-sm bg-teal-800"
                      style={{ width: `${w}%` }}
                    />
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2.5">
                <span className="w-5 text-right text-[9.5px] text-muted">g4</span>
                <span className="h-2.5 flex-1 rounded-sm bg-white">
                  <span className="block h-full w-[6%] rounded-sm bg-orange-500" />
                </span>
              </div>
            </div>
            <p className="mt-4 text-[11.5px] leading-snug text-body">
              <span className="font-medium text-ink">3 of 4 guides agree.</span>{" "}
              The fourth did nothing, and the gene-level number hides that.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- what happens ---------- */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
          How it works
        </h2>
        <ol className="grid gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-3">
          {[
            {
              n: "01",
              t: "You send counts",
              b: "A guide-level count table, or FASTQ. Any library, any caller you already use.",
            },
            {
              n: "02",
              t: "We run the pipeline",
              b: "MAGeCK, BAGEL2 and DrugZ with a two-family FDR correction, QC and artifact flags.",
            },
            {
              n: "03",
              t: "You pick a round",
              b: "Candidates ranked by what reproduces, with the guide-level evidence behind each one.",
            },
          ].map((s) => (
            <li key={s.n} className="bg-white p-6">
              <span className="font-serif text-[20px] text-orange-500">{s.n}</span>
              <h3 className="mt-2 text-[14px] font-medium text-ink">{s.t}</h3>
              <p className="mt-1.5 text-[12.5px] leading-snug text-muted">{s.b}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- the honest note ---------- */}
      <p className="text-[12px] leading-relaxed text-muted">
        Analysis is run by us during the pilot rather than from this browser, so the
        first screen is a conversation and not an upload form. Nothing here is a
        validation probability, and a candidate that reproduces is not the same as one
        that passes a bench assay.
      </p>
    </div>
  );
}
