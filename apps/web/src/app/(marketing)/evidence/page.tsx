import { marketingMetadata } from "@/lib/marketing-metadata";
import Link from "next/link";

import { MarketingNav } from "@/components/marketing/nav";
import { benchmark } from "@/lib/content";
import evidence from "../../../../public/evidence/summary.json";

export const metadata = marketingMetadata("/evidence", {
  title: "Evidence and limitations",
  description: "Measured AssayBench results, real sequencing agreement, analysis limitations and downloadable provenance for SplicR.",
});

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
        <p className="mt-4 text-body">{evidence.dataset}: {evidence.split.train.toLocaleString("en-US")} training, {evidence.split.validation} validation and {evidence.split.test} public test screens. The benchmark ranks genes from released experimental context without using target measurements as scoring inputs. Published expert prompts can include post-hoc notes, significance criteria and ranking rationale; this comparison does not establish a clean pre-experiment historical forecast. The official evaluator uses adjusted nDCG@100.</p>
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
      <section id="post-screen" className="scroll-mt-8">
        <h2 className="text-3xl font-medium">Which hits reproduce</h2>
        <p className="mt-4 text-body">{evidence.post_screen_replication.note} Measured {evidence.post_screen_replication.measurement_date} on the {evidence.post_screen_replication.benchmark}. The model was frozen before this split was scored, and this split was scored once.</p>
        <div className="mt-6 overflow-x-auto">
          <table className="table-base w-full"><caption className="text-left text-sm text-muted pb-3">Ranking {evidence.post_screen_replication.cohort.n_units} evaluation units across {evidence.post_screen_replication.cohort.n_screen_pairs} screen pairs. Average precision over non-common-essential genes; higher is better.</caption>
            <thead><tr><th scope="col">Ranking</th><th scope="col">Average precision</th><th scope="col">Precision@10</th></tr></thead>
            <tbody>
              <tr><th scope="row" className="text-left font-normal">SplicR reliability ranking</th><td className="tabular-nums">{evidence.post_screen_replication.primary_mean.toFixed(4)}</td><td className="tabular-nums">{evidence.post_screen_replication.precision_at_10.primary.toFixed(3)}</td></tr>
              <tr><th scope="row" className="text-left font-normal">The screen&apos;s own effect size</th><td className="tabular-nums">{evidence.post_screen_replication.comparator_mean.toFixed(4)}</td><td className="tabular-nums">{evidence.post_screen_replication.precision_at_10.comparator.toFixed(3)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-5 text-body">Paired difference, resampled by screen pair: {evidence.post_screen_replication.paired_difference.mean_difference.toFixed(6)}, 95% interval [{evidence.post_screen_replication.paired_difference.ci95.map(v=>v.toFixed(6)).join(", ")}] over {evidence.post_screen_replication.paired_difference.n_screen_pairs} pairs. On the {evidence.post_screen_replication.non_hub_paired_difference.n_screen_pairs} pairs outside the dominant library comparison the difference is {evidence.post_screen_replication.non_hub_paired_difference.mean_difference.toFixed(6)} [{evidence.post_screen_replication.non_hub_paired_difference.ci95.map(v=>v.toFixed(6)).join(", ")}].</p>
        <ul className="mt-5 space-y-2 text-body list-disc pl-5">{evidence.post_screen_replication.limitations.map(l=><li key={l}>{l}</li>)}</ul>
      </section>
      <section id="research" className="scroll-mt-8">
        <h2 className="text-3xl font-medium">Later research results</h2>
        <p className="mt-4 text-body">Measured {evidence.research_addendum.measurement_date} on the {evidence.research_addendum.split} split. {evidence.research_addendum.note} These are development measurements, shown separately from the public-test table above because the two are not interchangeable.</p>
        <div className="mt-6 overflow-x-auto">
          <table className="table-base w-full"><caption className="text-left text-sm text-muted pb-3">Development results on held-out 2021 screens. Every figure is recomputed from the experiment&apos;s own per-screen results.</caption>
            <thead><tr><th scope="col">Experiment</th><th scope="col">Selected model</th><th scope="col">AnDCG@100</th><th scope="col">95% interval</th><th scope="col">Status</th></tr></thead>
            <tbody>{Object.entries(evidence.research_addendum.experiments).map(([id,x])=>
              <tr key={id}><th scope="row" className="text-left font-normal">{x.title}</th><td>{x.selected_model}</td><td className="tabular-nums">{x.mean.toFixed(6)}</td><td className="tabular-nums">[{x.ci95.map(v=>v.toFixed(6)).join(", ")}]</td><td>{x.promotion_status.replace("_"," ")}</td></tr>)}</tbody>
          </table>
        </div>
        <dl className="mt-6 space-y-5">{Object.entries(evidence.research_addendum.experiments).map(([id,x])=>
          <div key={id}><dt className="font-medium">{x.title}</dt><dd className="mt-2 text-body">{x.comparison} {x.finding}</dd></div>)}</dl>
        <p className="mt-5 text-body">Neither experiment accessed the {evidence.split.test}-screen public test, and neither model is promoted. The comparison table above is unchanged by this work.</p>
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
