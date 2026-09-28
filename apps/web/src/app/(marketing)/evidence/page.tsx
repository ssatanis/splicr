import type { Metadata } from "next";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing/nav";
import { benchmark } from "@/lib/content";
import evidence from "../../../../public/evidence/summary.json";

export const metadata: Metadata = {
  title: "Evidence and limitations",
  description: "Measured AssayBench results, real sequencing agreement, analysis limitations and downloadable provenance for SplicR.",
};

const files = [
  ["summary.json", "Machine-readable measurements"],
  ["manifest.json", "SHA256 checksums for these downloads"],
  ["05_BENCHMARK_REPRODUCTION.md", "Benchmark reproduction and protocol"],
  ["08_VALIDATION_REPORT.md", "Validation results and limitations"],
  ["10_FINAL_RESULTS.md", "Research results and implementation status"],
  ["11_HOW_TO_READ_THE_EVIDENCE.md", "How to read the evidence"],
  ["POSTSCREEN_IMPLEMENTATION.md", "Post-screen methods and audit"],
  ["12_WEBSITE_CONSISTENCY.md", "Website and project verification"],
];

export default function EvidencePage() {
  return <main className="sheet">
    <MarketingNav />
    <div className="container-x py-14 md:py-20 space-y-16">
      <header className="max-w-3xl">
        <div className="eyebrow">Research measurements · {evidence.measurement_date}</div>
        <h1 className="mt-4 display text-ink text-4xl md:text-6xl">Evidence you can inspect.</h1>
        <p className="mt-6 text-lg text-body">We reproduced published benchmarks, tested new models and audited actual sequencing data. The work corrected reliability problems; it did not demonstrate a new benchmark leader or perfect biological accuracy.</p>
        <p className="mt-4 text-body">Public workspace access is not enabled. These results describe the documented research snapshot and local implementation, not a completed prospective laboratory validation.</p>
      </header>
      <section id="prediction" className="scroll-mt-8">
        <h2 className="text-3xl font-medium">Pre-screen prediction</h2>
        <p className="mt-4 text-body">{evidence.dataset}: {evidence.split.train.toLocaleString("en-US")} training, {evidence.split.validation} validation and {evidence.split.test} public test screens. The task ranks genes from experimental context before seeing target measurements. The official evaluator uses adjusted nDCG@100.</p>
        <div className="mt-6 overflow-x-auto">
          <table className="table-base w-full"><caption className="text-left text-sm text-muted pb-3">Official evaluation replay. Higher is better; these scores are not percentages of accuracy.</caption>
            <thead><tr><th scope="col">Method</th><th scope="col">AnDCG@100</th></tr></thead>
            <tbody>{benchmark.map(row=><tr key={row.label}><th scope="row" className="text-left font-normal">{row.label}</th><td className="tabular-nums">{row.value.toFixed(6)}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="mt-5 text-body">Router minus ensemble: {evidence.router.paired_vs_ensemble.mean.toFixed(6)}; paired publication-bootstrap 95% interval [{evidence.router.paired_vs_ensemble.ci95.map(v=>v.toFixed(6)).join(", ")}]. No advantage was established and the candidate was not promoted.</p>
        <p className="mt-4 text-body">Published model rankings were replayed from saved files. No fresh model API calls were made. The oracle selects with test answers and is not deployable. The public test had already been explored historically, so it is not an untouched prospective cohort.</p>
        <details className="mt-5 rounded-xl border border-line p-5"><summary className="cursor-pointer font-medium">Why earlier SplicR numbers differ</summary><p className="mt-3 text-body">The original supplied-library phenotype prior reproduced at {evidence.legacy_prior.andcg100.toFixed(6)}. A separate archived fusion scored 0.219952 versus 0.219324 for an equally filtered/padded ensemble, with a paired interval spanning zero. Those experiments used the target&apos;s measured gene library and different training inputs. Their scores cannot be compared directly with the unaltered rankings above. Full details remain in the reproduction report.</p></details>
        <p className="mt-4 text-sm"><a className="underline" href="https://github.com/Genentech/AssayBench">Official implementation</a>{" · "}<a className="underline" href="https://huggingface.co/datasets/Genentech/assaybench">Official dataset</a></p>
      </section>
      <section id="counting" className="scroll-mt-8">
        <h2 className="text-3xl font-medium">Actual sequencing, compared with deposited counts</h2>
        <p className="mt-4 text-body">Four GSE145743 FASTQ files: {evidence.counts.samples.reduce((n,s)=>n+s.reads,0).toLocaleString("en-US")} reads, with 65,383 guides compared per sample. The author table merges libraries A and B; the comparison uses library A counts per million (CPM). {evidence.counts.note}</p>
        <div className="mt-6 overflow-x-auto"><table className="table-base w-full min-w-[660px]">
          <caption className="text-left text-sm text-muted pb-3">Agreement for one study, not universal counting accuracy.</caption>
          <thead><tr><th scope="col">Sample</th><th scope="col">Reads</th><th scope="col">Median CPM ratio</th><th scope="col">Spearman</th><th scope="col">Within 25%</th></tr></thead>
          <tbody>{evidence.counts.samples.map(s=><tr key={s.fastq}><th scope="row" className="text-left font-normal">{s.published_column}</th><td>{s.reads.toLocaleString("en-US")}</td><td>{s.median_cpm_ratio.toFixed(4)}</td><td>{s.spearman.toFixed(4)}</td><td>{(s.fraction_within_25_percent*100).toFixed(2)}%</td></tr>)}</tbody>
        </table></div>
        <p className="mt-4 text-body">A median ratio near one checks scale. Correlation and tolerance describe guide-level agreement; neither proves perfect counts. The downloadable JSON includes mapping rates and dropout differences.</p>
      </section>
      <section id="postscreen" className="scroll-mt-8">
        <h2 className="text-3xl font-medium">Post-screen analysis is a different task</h2>
        <p className="mt-4 text-body">MAGeCK and DrugZ analyzed {evidence.postscreen.n_guides.toLocaleString("en-US")} author-processed guide rows from GSE145743. Correcting selection across two directional FDR families changed q &lt; 0.1 calls from {evidence.postscreen.original_min_directional_fdr_hits} to {evidence.postscreen.corrected_two_family_fdr_hits}. Native statistics remain inspectable.</p>
        <p className="mt-4 text-body">CHD1L was not significant under this analysis. QC failed under the existing dropout/depth criteria. The input is author-processed and subsampled; these findings are not interchangeable with the earlier raw-read experiment. No gain in independent validation precision is established.</p>
        <a className="mt-4 inline-block underline" href={evidence.postscreen.source}>Source study and deposited data: GSE145743</a>
      </section>
      <section>
        <h2 className="text-3xl font-medium">What the numbers mean</h2>
        <dl className="mt-6 grid md:grid-cols-3 gap-6">
          <div className="card-line p-5"><dt className="font-medium">AnDCG</dt><dd className="mt-2 text-body">Ranking quality relative to the benchmark&apos;s ideal and random baselines. A score of 0.16 does not mean 16% accuracy.</dd></div>
          <div className="card-line p-5"><dt className="font-medium">FDR</dt><dd className="mt-2 text-body">A statistical error-rate measure for a selected set of discoveries under a method&apos;s assumptions. It is not one gene&apos;s validation probability.</dd></div>
          <div className="card-line p-5"><dt className="font-medium">Independent validation</dt><dd className="mt-2 text-body">New experimental outcomes withheld during development. No adequate cohort was established here, so validation-success percentages remain unavailable.</dd></div>
        </dl>
      </section>
      <section id="downloads">
        <h2 className="text-3xl font-medium">Download the evidence</h2>
        <p className="mt-4 text-body">These files are generated from the research records. Source-artifact hashes are included in the JSON. Technical reports refer to scripts and additional artifacts in the project repository; the downloads alone are not a complete computational environment.</p>
        <ul className="mt-5 space-y-3">{files.map(([name,label])=><li key={name}><a href={`/evidence/${name}`} download className="underline underline-offset-4 text-orange-600">{label}</a></li>)}</ul>
        <Link href="/technology" className="mt-8 inline-block underline">Review current feature availability</Link>
      </section>
    </div>
  </main>;
}
