# Analysis scripts

Run from the repository root unless a script explicitly says otherwise:

```bash
export PATH="$PWD/engine/.tools/env/bin:$PATH"
export PYTHONPATH="$PWD/engine${PYTHONPATH:+:$PYTHONPATH}"
python -m splicr --help
```

This directory contains research and audit entry points, not a deployed model
service. Full source data, existing caches and optional dependencies are needed
for many scripts; see [engine setup](../../docs/05-engine.md). Local outputs can
be overwritten. Preserve published artifacts before rerunning experiments.

## Current evidence

[Final results](../../research/10_FINAL_RESULTS.md) and
[experiment registry](../../research/06_EXPERIMENT_REGISTRY.md) specify actual
inputs, frozen configurations, source hashes, paired uncertainty and decisions.
The new description-only candidates did not establish an improvement over the
published ensemble and were not promoted. Archived library-aware fusion scores
use a different input contract and do not demonstrate superior biological accuracy.
There is no fitted independent-validation probability model.

| Entry point | Purpose and boundary |
|---|---|
| `reproduce_references.py` | Replay cached official predictions with the official metric |
| `audit_benchmark.py` | Inspect split membership, duplicates, context novelty and leakage risks |
| `controlled_benchmark.py` | Select historical-prior candidates on validation; separate replay phase |
| `controlled_router.py` | Controlled description-only routing over cached expert predictions |
| `controlled_residual.py` | Controlled text residual ranker with separate selection/replay |
| `postscreen_reliability.py` | Real processed-count caller audit; one study, no independent validation labels |
| `assaybench_fusion/` | Preserved historical exploration, including hindsight diagnostics and supplied-library inputs |

Before running any model script, inspect its CLI and output paths. Selection
phases rewrite selection/freeze files. Replaying exposed public test data is useful
for reproducibility, but repeated test-driven choices are not independent final
validation. Current reproducibility commands are recorded in the research report;
do not recreate a prospective claim by rerunning these public experiments.

Pre-screen ranking consumes experiment metadata and permitted prior knowledge.
Post-screen analysis consumes observed counts. Success on one does not establish
performance on the other. A synthetic regression test establishes code behavior;
independent assay outcomes are needed to establish validation success.
