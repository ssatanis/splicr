**Independent browser benchmark: GSE145743**

The [GEO study](https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE145743) provides HeLa olaparib-versus-DMSO screening data. This is a second experiment structure, separate from the Dow kinase screen.

The count workflow uploaded the original author count table, both original GeCKOv2 guide files and a sample metadata CSV through New analysis. The UI manually mapped gene_id, UID and seq in the guide files, imported a private combined library with 123,411 guides and applied sample roles, replicates, model and timepoint metadata. Baseline columns were excluded from the endpoint drug comparison. A reviewed plan queued MAGeCK RRA plus unpaired DrugZ, median normalization and FDR 0.05. Both callers completed and the full native results were exported through the browser.

The author table contains columns normalized to 10 million reads. It is processed screening input, not raw sequencing depth. Integer values do not make it a raw-depth table. Absolute coverage flags cannot be interpreted as measured library sequencing depth for this input.

The raw workflow uploaded four original FASTQ.gz files totaling 1,263,795,142 bytes through Cloudflare multipart storage. The saved draft reopened through the UI without another upload. The researcher selected GeCKOv2 Set A, two controls, two treatments, RRA and DrugZ, median normalization and FDR 0.05, then confirmed the plan. The cloud worker completed counting, QC, statistical methods, artifacts, Atlas context, guide disagreement and portable reports. Browser result and JSON export checks passed. The saved model category was the default other, with HeLa recorded as the cell-line label. The readout and statistical contrast are explicit; this model-category default is not a new biological classification.

The raw workflow was repeated after changing counting to detect each sample's orientation independently. All four files independently select forward offset 23 from 200,000 reads. The count stage now stores each sample's detected spacer configuration and shows completed-sample progress while counting. The repeated raw run retains the same hit counts. RRA and DrugZ are computed independently; their hit counts are not added together.

Results at method-specific FDR < 0.05:

| Input | QC | Genes | SplicR | RRA depletion | RRA enrichment | DrugZ |
|---|---|---:|---:|---:|---:|---:|
| Author counts, A+B | warn | 20524 | 19 | 1 | 24 | 36 |
| Raw FASTQ, A | fail | 20665 | 5 | 0 | 11 | 19 |

The two inputs cover different libraries, A+B versus A, and are not equivalent numerical reproduction tests. The raw analysis stores 65,383 guide-effect rows and 20,897 guide disagreement reports. Mean mapping rates differ by sample: about 81.4%, 87.1%, 48.4% and 87.0%. DMSO replicate 2 carries the vector anchor in only about 54% of reads, versus about 90% in the other samples. Its low mapping rate remains a QC failure. Other samples receive skew and coverage warnings. Control replicate correlation is about 0.904; treatment correlation is about 0.851. These observations do not establish superior biological accuracy.

The optional validation-probability stage declined to estimate probabilities when the required evidence was unavailable. Those refusals are recorded. Nothing was tuned to the publication's validated genes.

The first reruns preserved run records but replaced their database result rows. The subsequent run-history migration corrects that behavior for future executions. Earlier portable exports and run receipts are retained where available; missing historical database rows are not reconstructed or presented as preserved. The latest repeat is the authoritative current raw result. The whole-screen plot query initially exceeded the database API timeout. Authorizing the workspace once and restricting the query to the current run returned all 20,665 unique genes in about 0.65 seconds; an unowned screen returned no data. [Plot verification](plot-verification.json) records the check.

Artifacts: [cloud verification](cloud-verification.json), [count run receipt](repeat-ui-run.json), [raw run receipt](raw-completed-run.json), [count JSON export](cloud-count-export.json), [raw JSON export](cloud-raw-export.json), [sample spacer checks](per-file-spacer-check.json), [count review](review-plan.png), [raw confirmation](raw-review-plan.png), [raw results](raw-results.png) and [source checksums](source-checksums.json).

These workflows use the browser against hosted Supabase, Cloudflare R2 and Modal. The frontend is tested locally; production deployment through the linked Vercel team could not be verified because the connection returned 403. No universal-file, 100% biological-accuracy or published-result-superiority claim is supported.
