import Link from "next/link";

import { Reveal } from "@/components/ui/reveal";
import evidence from "../../../../public/evidence/summary.json";

/** Actual processed-count audit; no synthetic candidate effects or probabilities. */
export function HitReportPreview() {
  const hit = evidence.postscreen.CHD1L;
  return (
    <section className="py-16 md:py-24">
      <div className="container-x grid lg:grid-cols-2 gap-10 items-start">
        <Reveal>
          <div className="eyebrow">Measured analysis</div>
          <h2 className="mt-4 display text-ink text-3xl md:text-4xl">A result you can inspect, including its limits.</h2>
          <p className="mt-6 text-body leading-relaxed">This CHD1L row comes from the actual GSE145743 processed-count audit. It was not significant under the corrected q &lt; 0.1 rule. No probability of successful validation has been assigned.</p>
          <p className="mt-4 text-body leading-relaxed">The earlier raw-read analysis used a different input and reported a different rank. It is retained in the research history and is not interchangeable with this result.</p>
        </Reveal>
        <Reveal delay={0.1} className="min-w-0">
          <article className="rounded-3xl border border-line bg-white p-6 shadow-card">
            <div className="eyebrow">GSE145743, olaparib versus DMSO</div>
            <h3 className="mt-3 text-2xl font-medium">{hit.gene}</h3>
            <dl className="mt-5 grid grid-cols-2 gap-5 text-sm">
              <div><dt className="text-muted">Observed log₂ fold change</dt><dd className="mt-1 tabular-nums">{hit.lfc}</dd></div>
              <div><dt className="text-muted">MAGeCK depletion FDR</dt><dd className="mt-1 tabular-nums">{hit.depleted_fdr}</dd></div>
              <div><dt className="text-muted">Two-family adjusted FDR</dt><dd className="mt-1 tabular-nums">{hit.fdr.toFixed(3)}</dd></div>
              <div><dt className="text-muted">DrugZ FDR, unpaired</dt><dd className="mt-1 tabular-nums">{hit.drugz_fdr}</dd></div>
            </dl>
            <p className="mt-6 rounded-xl bg-orange-50 p-4 text-sm text-ink">QC failed under the current dropout/depth criteria. Those criteria are not universal assay-quality standards. This single case does not establish validation precision.</p>
            <Link href="/evidence#postscreen" className="mt-5 inline-block text-orange-600 underline underline-offset-4">Inspect methods, source and audit</Link>
          </article>
        </Reveal>
      </div>
    </section>
  );
}
