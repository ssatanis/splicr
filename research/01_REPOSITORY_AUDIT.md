# SplicR repository and product audit

> Follow-up: [website and project consistency update](12_WEBSITE_CONSISTENCY.md) records the latest marketing, dashboard, export and API corrections.

Audit date: 2026-09-27. Starting revision: `166cb3c2366424e9fdb6ac47bf051f01a1948c67`. Scope: checked-in application, engine, scripts, migrations, local research artifacts, and live public pages. This is a source audit, not certification of deployed infrastructure. No production database queries or mutations were performed. Existing dirty marketing/research files were preserved.

## Findings that determine the research architecture

SplicR contains a functioning local raw-count analysis engine, substantial offline AssayBench research, and a partially connected application. These are three different maturity levels. The post-screen pipeline explicitly skips calibrated scoring. The offline benchmark scorer does not provide validation probabilities. Much of the detailed console is an explicitly labelled demonstration.

The strongest defensible near-term product is transparent count analysis, artifact evidence and historical context, with reproducible prediction research beside it. Numerical independent-validation confidence requires outcomes that the repository does not establish as available in sufficient quantity.

## Product implementation inventory

| Product | Implementation observed | Status and limitation |
|---|---|---|
| Authentication, workspaces, membership | `apps/web/src/lib/data/org.ts`, `actions.ts`, `accept-invite.ts`; Supabase session clients; identity/RLS migrations | Implemented access paths; live service availability and tenancy tests not established by this audit. Mutations re-authorize and reject demo writes. |
| Dashboard overview | `app/dashboard/page.tsx`, `lib/data/overview.ts` | Reads real organization screens, hits, outcomes, stages. Null score falls back to statistical ordering. Demo mode is separate. |
| Screen list/detail | `components/dashboard/screens-table.tsx`, `app/dashboard/screens/[id]/page.tsx`, `lib/data/screen-detail.ts` | Initial detail route was mock-only. This research pass added real session/organization-scoped details, current-run evidence and paginated gene results. Sample detail imports now require explicit demo mode; real sessions also receive an organization-scoped, paginated screen list. |
| Ingestion UI | `components/dashboard/upload-wizard.tsx`, `app/dashboard/upload/page.tsx` | Illustrative wizard is now explicit-demo-only. Real sessions see browser upload/worker execution unavailable; no job is pretended to be queued. |
| Raw-count CLI | `engine/splicr/cli.py`, `pipeline.py`, `count.py`, `design.py` | Functional local FASTQ/count-table pipeline, optional DB persistence. Does not establish browser-to-worker execution. |
| Atlas data | `splicr/orcs.py`, `atlas.py`, `scripts/data/ingest-orcs.py` | Functional ORCS parsing, measured-background-aware counters and structured historical comparability. Original authors' heterogeneous calls are retained, not uniformly reanalyzed raw reads. |
| Atlas explorer | `components/dashboard/atlas-explorer.tsx`, `app/dashboard/atlas/page.tsx` | Sample browser restricted to explicit demo. Real sessions see the unconnected browser state; no sample screens or totals are substituted. |
| Pre-screen prediction | `benchmark.py`, `features/priors.py`, `features/orcs_retrieval.py`, `assaybench_stack.py`, `assaybench_fusion.py` | Offline research/inference modules. No public prediction API or complete new-description inference path with fresh model-generated rankings established. Published model lists are cached artifacts. |
| Post-screen hit calling | `splicr/hits.py` | MAGeCK RRA default, BAGEL2 default optional failure; DrugZ opt-in. MLE subprocess wrapper exists but `run_mle` was unused in orchestration at initial audit. |
| Copy-number/off-target evidence | `splicr/artifacts.py`, `references.py` | Flags measured or positional CN clusters, guide dominance/disagreement, multiplicity and frequent hitters. Does not perform CERES/Chronos/CRISPRcleanR correction. |
| Validation confidence | `pipeline.py` score stage | Explicitly skipped: no fitted calibrated model. `chance_real` remains null. |
| Hit Reports | `lib/report/document.ts`, serializers and `api/report/[id]/route.ts` | Working CSV/JSON/PDF renderer restricted to explicit demo sessions, labelled in file bodies, filenames and headers. Signed-in real users receive 501 workspace_report_unavailable; anonymous non-demo users receive 401. Workspace renderer remains unimplemented. |
| Discovery Map | marketing quadrants and mock-backed screen workspace | Concept/sample visualization, no independent scientific novelty calibration. |
| Screen Planner | `components/dashboard/planner.tsx`, `app/dashboard/planner/page.tsx` | Arithmetic preview is demo-only. Real sessions receive a truthful unconnected planner state; no assumed power, costs or gene selections are presented. |
| Truth Loop | `app/dashboard/validation/page.tsx`, `lib/data/workspace-lists.ts` | Real sessions now read their own paginated outcome records with exact pending/failed/inconclusive states. Sample outcomes/calibration require explicit demo. Entry, blind reveal and online updating remain unconnected. |
| Atlas Connect | `api/v1/hits/route.ts`, `lib/connect`, migration `20260927000500_connect_api.sql` | Implemented scoped bearer-key hits API with validation/pagination. Advertised MCP server, write endpoints and wider scopes are not implemented merely because selectable scope strings exist. |
| Model serving | Python library/CLI; score-model schema | No calibrated model service/worker deployment discovered. Installed Chronos/RS3/ML libraries are dependencies, not production integrations. |

## Live website and repository consistency

The public home, technology, pipeline, about, careers and contact pages returned HTTP 200 on the audit date via read-only HTTP fetch. The web research tool could not open the site, so HTML was fetched directly and parsed locally. The deployed site and dirty local marketing code are different snapshots. The [home page](https://www.splicr.org/) displayed 0.163 for SplicR and frontier ensemble; this is a displayed claim, not a fresh benchmark reproduction. [Technology](https://www.splicr.org/technology) advertises calibration, a uniformly reanalyzed Atlas, statistical power and MCP; implementation above does not support those as finished capabilities. The [contact workflow](https://www.splicr.org/contact) invites blind pilots; invitation is not evidence of completed independent validation.

README and `docs/02-pipeline.md` had similar present-tense claims. Their essential scope/status wording was corrected during this research pass. Older `docs/05-engine.md` says the pipeline is not written, although it now exists. `docs/01-architecture.md` describes queue leasing and 50 GB resumable uploads as implemented without a corresponding executable worker/UI path. These documents must be treated as historical/architectural descriptions where code disagrees.

## Track B: actual input-to-output path

1. `ScreenInput` supplies files, sample roles, contrast, library, cell line, modality and optional DepMap model ID.
2. Ingest checks paths, reads sample names, then `build_design` rejects inconsistent contrasts before expensive analysis.
3. Library is supplied or fingerprinted from reads/counts. `references.py` parses actual library files.
4. `count_fastq` identifies spacer position/anchor, counts exact matches with constrained mismatch fallback, and includes zero-count guides. Count-table parsing was permissive at initial audit; see confirmed risks.
5. `screen_qc` computes sample count distribution, mapping, essential/nonessential separation and replicate concordance. It distinguishes endpoint-versus-baseline dropout from treated-versus-control contrasts. Failed QC is reported but downstream inference continues.
6. `call_hits` writes MAGeCK TSV, invokes RRA, reads guide LFC and gene statistics, and optionally merges BAGEL2/DrugZ fields. Side-by-side statistics are not a trained consensus model.
7. Atlas context is loaded before artifacts for historical frequencies. It returns unavailable with a reason if references are absent. Artifacts add named evidence; they do not adjust the underlying effect estimates.
8. Score stage is skipped, with an explicit reason. No calibrated percentage is generated.
9. In memory, results are returned. Persisted runs write gene/flag rows and mark completion. This stage does not generate the console's sample PDF from the actual run.

`db.write_hits` initially persists RRA, BF, normZ, guide evidence and optional score; fields such as MLE, interval bounds, Atlas counters and neighbors are not automatically populated merely because schema columns exist. Its delete-by-comparison write behavior warrants care on reruns; no existing records were changed in this audit.

## Track A architecture and contamination history

`benchmark.py` contains an optimized adjusted-nDCG implementation plus official parity checks, frequency/retrieval/GBM methods. `features/priors.py` estimates measured-gene-denominator conditional frequencies with shrinkage and direction handling. `features/orcs_retrieval.py` adds safe historical ORCS transfer. `assaybench_fusion.py` combines conditional priors, cached published LLM rankings, inferred donor similarity and external biological channels. These rank candidates; they do not calibrate validation success.

Important qualifications:

- Existing fusion code filters/densifies/pads against the target measured library. This can be a legitimate separate **description plus supplied gene library** deployment task, but cannot be silently equated with description-only published LLM rankings. Do not change official top-k handling in evaluation.
- `engine/analysis/assaybench_fusion/` and `oracle_ceiling/` retain numerous public-test diagnostics, including deliberate test-fitted oracle analyses. The public test is already explored and cannot be described as untouched.
- Historical docstrings disagree about whether test was evaluated; `docs/08-assaybench-headroom.md` demonstrates extensive evaluation. Preserve experiments and report this history.
- `orcs_safe.py` and `_assaybench_safe_orcs.json` provide a publication-based read boundary, safe-only physical caches and coverage tests. Useful protections do not establish historically dated availability for all external sources.
- Cached 2026 model predictions may encode published screen answers through model training. Their original prompts and public release do not prove absence of memorization.
- DepMap 24Q4 data cannot support a strict pre-2021 historical simulation without qualification. Model-specific screens can overlap Track B targets. `replication/dataset.py` correctly identifies this risk and excludes pair publications/cell lines from allowed backgrounds.

## Track B replication evaluation

`splicr/replication/dataset.py`, `baselines.py`, `simple.py` and `_pairs_v1.json` implement an independent-screen replication proxy with strict same-cell-line, unperturbed-proliferation, modality and full-background matching. Query screen A is distinct from label screen B; held-out labels require explicit evaluation access. This is useful evidence of reproducibility across screens, not independent arrayed validation and not proof of a general validation-success probability. ORCS summaries lack observed per-guide concordance. Literature validation and negative outcomes remain a separate curation task.

## Data and infrastructure

Three SQL schemas separate application rows (`public`), references (`atlas`) and helpers (`private`). Migrations define organizations, screens/samples/comparisons, runs/stages/artifacts, jobs/events, counts, QC, hits/flags, neighbors, plans/outcomes, model/calibration registries, reports, genes/libraries/guides, cell models and public screens. RLS and role helpers exist; presence is not an independent penetration test.

Bulk ORCS/guides/CN storage already uses compressed Parquet and DuckDB/R2 (`lake.py`, `build-lake.py`, `ingest-orcs.py`). ORCS import writes partitioned gene rows atomically and creates the manifest last. Readable background and measured masks avoid treating an unassayed gene as a negative. Raw ORCS statistics vary by source and must retain score type. The full Atlas retains original author calls. Customer counts still have a SQL persistence path; large usage requires optional columnar run artifacts plus small indexed summaries, without deleting existing rows.

Local disk inspection measured approximately 12 GB under `engine`, 23 GB under `data`, 1.1 GB under `apps/web`; these include tools/caches, not all source. This is a feasible CPU/local-data environment, not evidence of an available GPU or unlimited API budget. `requirements.txt` pins packages, `environment.yml` partly pins conda dependencies, and `constraints.txt` protects NumPy/BAGEL compatibility. Existing local binaries are macOS builds; clean Linux recreation is a separate gate. Some environment comments contradict their Python constraints, so verify metadata rather than repeat comments.

## Confirmed initial issues and recommended regression coverage

| Issue | Evidence | Consequence / verification |
|---|---|---|
| Invalid counts silently become zero; fractional values truncated, negative/ragged rows accepted | `count.read_count_table` | Missing evidence becomes biological dropout; reject malformed counts with row/sample context. |
| DrugZ FDR chosen with `fdr_supp or fdr_synth` | `hits.run_drugz` | Wrong tail; zero is treated as missing. Select tail by normZ and use explicit null checks. |
| `run_mle` unused | `hits.call_hits` | Requested method silently absent; reject or implement with actual design. |
| Unconditional essential-enrichment exception | `hits.call_hits` | Essential enrichment can occur in phenotypic sorting/differential treatment or CRISPRa; gate using documented design assumptions. |
| Min of separate directional FDR columns reported as one FDR | `hits.run_mageck_rra` | Separate one-sided error control does not automatically control pooled two-direction discovery; retain method/tail semantics or perform declared joint adjustment. |
| Failure records last completed stage | `pipeline.run_pipeline` exception handler | Misdiagnoses actual failed stage; record current stage before execution. |
| Critical flag forces artifact verdict | `db.classify` | A CN flag is not proof a hit is false; preserve real dependencies and distinguish risk from confirmed artifact. |
| Rerun unique key scoped to comparison, not run | `hits` table and `db.write_hits` | Reusing comparison can delete historical hits; use immutable run-specific identity in a future reviewed migration. |
| Real screen links lead into mock-only detail | screen detail route | Production integration incomplete despite working summary/API. |

These are initial findings; implementation/tests performed by the coordinating agent are recorded in the validation and final reports. This document does not claim every listed fix shipped.

## Audit limitations

No private customer data, production migrations, destructive reclaim scripts, emails or deployments were invoked. Source was inventoried across all relevant subsystems and key execution paths traced; this does not imply every line or dataset row was reviewed. Installed dependencies, example outputs and historical comments are not treated as freshly reproduced evidence. Benchmark reproduction and quantitative comparisons are recorded separately.

## Implemented integration and independent regression review

The real screen-detail route now reads the current organization's screen and run using the session client and RLS. It selects hits by both screen and run, paginates 100 records at a time, displays recorded stage/tool provenance, guide effects, method statistics and artifact messages, and distinguishes unavailable reads from an empty/unrun experiment. It never fills missing values with mock results. The old detailed workspace remains accessible only to explicit demo sessions. Workspace PDF/CSV export and outcome-entry remain unconnected, and the page says so.

`apps/web/tests/screen-detail.test.mjs` exercises the actual TypeScript data loader with isolated authentication/database adapters. Ten tests cover anonymous/demo reads, invalid identifiers/pages, scoped inaccessible screens, exact run identity/pagination, dangling current run, unrun screen, database failure, exact rendered FDR, null confidence and explicit-only demo rendering. These verify application boundaries, not live RLS deployment. `engine/tests/test_prescreen_protocol.py` adds independent tests for metadata-only contexts, label poisoning, missing versus negative observations, publication exclusion/weighting, signed relevance, official-metric cutoff, bootstrap pairing/clusters, immutable prediction receipts and split IO. Quantitative final checks are reported in the coordinating validation report.

Frontend verification after the real-detail and marketing edits:

- `node --test apps/web/tests/screen-detail.test.mjs`: 10 passed.
- `npm run typecheck`: passed.
- Targeted ESLint on the detail page, data loader and test file: passed.
- `npm run build`: blocked by a Turbopack/PostCSS subprocess attempting to bind a port (`EPERM`, operation not permitted).
- `npm run build -w apps/web -- --webpack`: passed, including TypeScript and 25 static pages; the screen-detail route remains dynamic.

No privileges were escalated. Live database/RLS behavior and browser visual interaction were not tested by these checks; database adapters and static server rendering verify application logic without publishing or mutating customer data.

## Workspace-wide demo isolation

The screen list and Truth Loop now use `lib/data/workspace-lists.ts`: session-resolved organization, RLS, deterministic pagination, exact counts, and separate missing-workspace/unavailable/empty states. Atlas, upload and planner routes import their illustrative components only inside an explicit demo branch. Real sessions see connection limitations instead. Overview and member pages no longer substitute demonstrations when a session/workspace cannot be resolved; the shell no longer names an expired session as a demo user.

Operational limitation: `lib/supabase/proxy.ts` intentionally redirects `/dashboard`, `/login`, `/signup` and `/invite` to the home page. This gate was preserved. These changes improve the runnable application behind that gate; they are not a claim that a public console has been enabled or deployed. No live database query was run. Supabase SSR documentation and changelog were checked; existing session-client/RLS conventions were retained without schema or policy changes.

Final verification after the wider workspace isolation changes: `node --test apps/web/tests/screen-detail.test.mjs apps/web/tests/workspace-routes.test.mjs` passed **31/31** tests; `npm run typecheck`, full `npm run lint`, and `npm run build -w apps/web -- --webpack` all exited zero. Commands, counts, timing, log hashes and source hashes are recorded in `research/artifacts/final_web_verification.json`; raw logs are adjacent `final_web_*.log` files. This supersedes the earlier 10-test checkpoint.

The sample-report API exception is also closed: `/api/report/[id]` checks explicit demo state before loading sample records or report builders. Non-demo requests cannot receive sample exports; signed-in workspace requests return `501 workspace_report_unavailable`, while anonymous non-demo requests return `401 authentication_required`. Eight new endpoint regression tests use the actual sample CSV/JSON/PDF serializers and verify their labels remain intact. Final gates after this change: **39/39 frontend tests**, typecheck, full lint and Webpack build all passed; `final_web_verification.json` and adjacent logs were refreshed. This supersedes both earlier frontend checkpoints.
