# SplicR evidence and implementation record

Start with [the results](10_FINAL_RESULTS.md) and [the plain-language guide](11_HOW_TO_READ_THE_EVIDENCE.md). This directory distinguishes real public measurements, software test fixtures, historical experiments and unimplemented research ideas. **No new benchmark leadership or perfect accuracy is claimed.**

| Document | Purpose |
|---|---|
| [01 Repository audit](01_REPOSITORY_AUDIT.md) | What is implemented, sample-only, disconnected or planned |
| [02 Scientific research](02_SCIENTIFIC_RESEARCH.md) | Primary-source methods, biology, statistics and foundation models |
| [03 Competitors](03_COMPETITOR_ANALYSIS.md) | Compare methods within the tasks they actually solve |
| [04 Data audit](04_DATA_AUDIT.md) | Provenance, licensing, temporal availability and contamination |
| [05 Reproduction](05_BENCHMARK_REPRODUCTION.md) | Direct official benchmark replay and exact inputs |
| [06 Experiment registry](06_EXPERIMENT_REGISTRY.md) | Hypotheses, failed runs, validation selection and decisions |
| [07 Architecture](07_MODEL_ARCHITECTURE.md) | Implemented equations, interfaces and operating limits |
| [08 Validation](08_VALIDATION_REPORT.md) | Metrics, paired uncertainty, subgroup failures and missing evidence |
| [09 Product and data advantage](09_PRODUCT_AND_MOAT.md) | Real laboratory workflow, privacy and permitted feedback |
| [10 Final results](10_FINAL_RESULTS.md) | Changes, verified results, tests and unresolved blockers |
| [11 Reading the evidence](11_HOW_TO_READ_THE_EVIDENCE.md) | What the numbers mean and what they cannot prove |
| [12 Website consistency](12_WEBSITE_CONSISTENCY.md) | Current website, export, API and documentation corrections |
| [13 Laboratory workspace and statistical roadmap](13_LAB_WORKSPACE_AND_STATISTICAL_ROADMAP.md) | Corrected scientific blueprint, linked lab evidence, export contract and independent benchmark gates |
| [Post-screen implementation](POSTSCREEN_IMPLEMENTATION.md) | Confirmed scientific/software defects and real-count sensitivity runs |

## Reproduce new experiments

From the repository root, using the installed pinned environment and existing local AssayBench snapshot/published predictions:

```sh
export PYTHONPATH=engine
export OPENBLAS_NUM_THREADS=2
export OMP_NUM_THREADS=2
engine/.tools/env/bin/python engine/analysis/reproduce_references.py
engine/.tools/env/bin/python engine/analysis/controlled_benchmark.py select
engine/.tools/env/bin/python engine/analysis/controlled_residual.py select
engine/.tools/env/bin/python engine/analysis/controlled_residual.py replay
engine/.tools/env/bin/python engine/analysis/controlled_router.py select
engine/.tools/env/bin/python engine/analysis/controlled_router.py replay
engine/.tools/env/bin/python engine/analysis/audit_benchmark.py
```

`select` reads training/validation; `replay` checks frozen code/data hashes before public-test comparison. Source or data changes require a new recorded selection, not editing the hash checks. Running the same commands recreates the scientific comparison but **cannot make an already public/explored test set untouched**. JSON research outputs may be regenerated; preserve copies when creating a separate experiment. Prospective prediction receipts use exclusive creation instead.

Large original references, historical caches and new raw tool tables stay in local ignored data paths. Small scores/predictions/manifests live under `artifacts/`. `failed_csr_alias/` is a retained invalid debugging run; never include it in benchmark tables. The environment is pinned in `engine/requirements.txt` and `environment.yml`; clean-platform installation was not independently certified in this pass.

## Engineering checks

```sh
PATH="$PWD/engine/.tools/env/bin:$PATH" PYTHONPATH=engine \
  engine/.tools/env/bin/python -m pytest engine/tests -q
node --test apps/web/tests/*.test.mjs
npm run typecheck
npm run lint
npm run build -w apps/web -- --webpack
```

The default Turbopack build encountered an environment subprocess-port `EPERM`; the webpack production build passed. No privilege escalation, deployment or production data modification was performed. The application's existing public-console disable gate is preserved.
