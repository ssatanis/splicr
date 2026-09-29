# Evidence publication and registration gates

Implemented 2026-09-28. These are software integrity checks, not an independent biological validation or a proof against dishonest repository changes.

## Current publication contract

`research/evidence_contract.json` approves the existing retrospective snapshot for display. It pins the current source artifacts and public summary/manifest bytes. It explicitly declares that the router is **not promoted**, the public test is retrospective, the legacy baseline has target-universe information, the router does not, and validation probabilities are uncalibrated/absent. No historical artifact or public result was rewritten to introduce these checks.

The single validator is `scripts/research/evidence_gate.mjs`. Both the Python authoring command and the web production build invoke it. The build and `npm run evidence:check` need Node only, using built-in modules. No Python installation, biological data downloads, network requests, API keys, or database access are required to check the website snapshot.

Checks include pinned source and download hashes; the evaluator and dataset version/hash; model-code provenance; complete, unique cohort IDs and publication coverage; equality of prediction and scored cohorts; summary arithmetic; reference-cohort comparability; phenotype and modality coverage; validation-only router selection; preservation of separate input contracts; raw-count provenance; and the observed post-screen QC/CHD1L limitations. Hashes identify declared historical source versions; they do not falsely require today's changing model code to equal old experiment code.

The publisher validates every generated payload before its first write. It refuses a changed summary/manifest unless a replacement publication contract has been deliberately reviewed. Approved file writes use temporary files and replacement, avoiding partially written JSON. It does not silently promote the largest newly observed score.

```sh
npm run evidence:check
python3 scripts/research/publish_evidence.py --check
npm run build -w apps/web -- --webpack
```

## Register a new experiment without changing public results

Registration is a separate append-only research operation. Use a dated directory under `research/artifacts/` and preserve the actual experiment inputs/outputs. An experiment descriptor names its metric summary, per-screen results, and predictions; it does not need to use any particular experiment ID or directory name.

Required descriptor fields:

| Field | Contract |
|---|---|
| `schema_version` | `1` |
| `experiment_id` | Letters, numbers, underscore, dot, hyphen |
| `task` | `pre_screen_prediction` |
| `promotion_status` | `research_only` |
| `evaluation_kind` | `validation_selection`, `retrospective_public_test`, or `retrospective_grouped_holdout` |
| `input_contract` | `metadata_only` or `metadata_plus_measured_universe`; preserve the distinction |
| `calibration_status` / `validation_probability` | `not_fitted` / `null` |
| `cohort` | `n_screens`, `n_publications`, `dataset_sha256`, `metric_sha256`, `assaybench_version` |
| `provenance` | `assaybench_version`, `data_sha256`, `metric_sha256`, `model_code_sha256`, `git_revision` |
| `summary` | Path to a direct metric object containing `mean`, `ci95`, `n_screens`, `n_publications`, `unit: "publication"` |
| `screen_results` | Path to an array with `dataset_name`, `source_id`, `adjusted_ndcg@100` for every expected screen |
| `predictions` | Path to the actual screen-ID-to-ranking object |
| `artifacts` | Object mapping each named artifact's repository-relative path to its SHA-256 |

All artifact paths must stay inside the repository and under `research/artifacts/`. Missing rows, duplicate IDs, mismatched publication coverage, nonfinite metrics, missing provenance, and mismatched hashes are rejected. The currently supported registry is for pre-screen ranking; observed target counts cannot enter this track. Prospective/blinded and calibrated-outcome claims require a separate scientific evidence contract and are rejected by this registration path.

```sh
python3 scripts/research/publish_evidence.py --register-experiment \
  research/artifacts/20260928/model_development/experiment_descriptor.json
```

The command writes `research/evidence_registry/<descriptor-SHA256>.json`. Repeating the identical registration is idempotent; replacing an existing receipt with different content fails. Its status is `registered_research_only` and its independent-verification field explicitly says that scientific verification is not established by this software check. **Registration does not modify public evidence or authorize model promotion.**

A future public replacement needs a frozen selected record, independent scientific review, and an explicitly reviewed replacement contract. Until then the existing public comparison remains authoritative. New negative or exploratory reports can remain in the research directory without altering published benchmark values.

## Verification and boundaries

The complete frontend test suite passed **74 tests** after this change, including **18 new evidence-gate tests**. Tampered fixtures are isolated temporary copies used only to exercise software behavior. Tests cover altered checksums, re-pinned but incomplete cohorts, duplicate IDs, missing predictions/provenance/subgroups, unsupported confidence/superiority/prospective claims, mixed input contracts, modified public manifests, traversal and symlink escape, and research registration that cannot promote or change the current public snapshot.

The webpack production build passed with the Node evidence gate executed first, followed by compilation, TypeScript checks and 21 static pages. The original Python publisher's `--check` also passed and the public evidence files remained byte-for-byte unchanged. No deployment was performed.

These checks cannot prove that metadata was available at the claimed date, that an LLM did not memorize target publications, that reported biological outcomes are independently replicated, or that an author who can change the contract and code together is truthful. Independent scientific verification remains necessary. Confidence intervals are read and checked for consistency; bootstrap uncertainty is not recomputed by the website build.

Local observed post-screen data available for further experiments remain GSE145743 (A/B libraries, multiple arms and replicates). No additional independent raw-count study was found in the local testdata inventory during this work. Reusing another arm of that study would be a sensitivity analysis, not a new independent cohort.
