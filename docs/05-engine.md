# The engine

The local analysis engine turns FASTQ or count tables into method-specific gene
statistics, QC, artifact evidence and a JSON report. It does not currently assign
calibrated validation probabilities. See [pipeline status](02-pipeline.md).

Beyond hit calling, two modules answer the question after "which genes are hits":
`splicr.validate.domain_report` reports how much a gene's guides disagreed and
where each one cut, and `splicr.escape` ranks candidate explanations for a
phenotype weaker than expected. Both are described in
[guide disagreement and Escape](12-escape-and-deep-dive.md), with their validation
status and the claims they refuse to make.

`splicr.api` serves them over HTTP. It is an **internal** service: the engine holds
the Postgres secret key and bypasses Row Level Security by design, so nothing a
browser can reach may call it. Every route authorizes its caller with a SplicR
Connect key and scopes reads to that key''''s organization
(`engine/splicr/api/security.py`).

```bash
bash engine/setup.sh
export PATH="$PWD/engine/.tools/env/bin:$PATH"
export PYTHONPATH="$PWD/engine${PYTHONPATH:+:$PYTHONPATH}"
python engine/tests/smoke_test.py
```

`setup.sh` installs micromamba locally, so it needs no system package manager,
creates the `environment.yml` environment when required, clones BAGEL2 if
absent, and checks the installed tools. Run from the repository root. It is not
a complete reproducibility lock: some conda dependencies are unpinned, the BAGEL2
clone follows its default branch, and an existing environment is not rebuilt
simply because the file changes. Record solved package versions and git revisions
for each research run. Do not erase a working environment to recreate it.

## What is installed

| Tool | Version | Role |
|---|---|---|
| MAGeCK | 0.5.9.5 | RRA and MLE hit calling |
| BAGEL2 | 2.0 build 115 | Bayes factors against reference gene sets |
| bowtie | 1.3.1 | Mismatch-tolerant mapping fallback |
| cutadapt | 5.2 | Anchored 5' trimming, handles staggered primers |
| fastp | 1.3.7 | Read QC with machine-readable output |
| seqkit | 2.14.0 | Read statistics and anchor location |
| samtools | 1.24 | BAM handling |
| Python | 3.11.16 | Interpreter |

These are the recorded local tool versions. `environment.yml` pins Python to
3.11, not a patch version; `doctor` reports the installed executables. Fresh
Linux installation and every optional package combination have not been verified.

## Compatibility and reproducibility notes

**Python 3.11.** This checkout selects Python 3.11 for its tested local
MAGeCK 0.5.9.5 toolchain. Earlier comments claiming a simultaneous `<3.11`
requirement were inconsistent with that selection and are not a verified solver
constraint. Do not infer that MAGeCK development ended in 2021: the separate
[MAGeCK2 project](https://github.com/davidliwei/mageck2-doc) exists, but has not
been substituted into this pipeline or validated against its fixtures.

**NumPy below 2.** BAGEL2 calls `np.in1d`, removed in NumPy 2.0. The failure is
nastier than it sounds: `fc` succeeds and writes its output, then `bf` dies
with an `AttributeError`, so it reads like a BAGEL2 bug rather than a
dependency one.

**MAGeCK needs its environment on `PATH`.** It shells out to the `RRA` binary
by bare name. Calling `engine/.tools/env/bin/mageck` by absolute path leaves
`RRA` unresolvable, and MAGeCK reports `command not found` deep in its log
while exiting non-zero on a missing output file. Always export `PATH`.

**BAGEL2 uses a separate clone in this setup.** Its source revision needs pinning.
Its `-s` flag is registered twice (`--use-small-sample` and `--seed`), so
use the long forms in anything automated.

## Archived synthetic end-to-end check

The smoke test builds a count table from **real Brunello guides**, simulates a
dropout where CEGv2 essentials deplete and NEGv1 nonessentials do not, and runs
both callers:

```
built 2478 guides over 620 genes from real Brunello sequences
MAGeCK: precision@120 = 100%, 120 called at FDR<0.1, 0 nonessential, NNMD -6.40
BAGEL2: precision@120 = 100%, top BF 1084 (CENPA)
```

**Read that honestly.** The separation is planted, so near-perfect recovery is
expected and says nothing about real screens. What it does prove is that the
toolchain is wired correctly, that real library files parse including their
bare CR line endings, and that reference gene sets line up with library gene
symbols. A drop below the thresholds means something broke, not that the
biology got hard.

Top hits are recognisable core essentials either way: MAGeCK returns VARS,
POLR2L, CKAP5 and SPC25; BAGEL2 returns CENPA, RPS13, FARSA and RPL35A.

## Implemented and outstanding

`splicr.pipeline` orchestrates local ingestion, library detection, counting, QC,
applicable callers, artifact annotations and Atlas context. It writes
`postscreen_report.json` and optionally persists results with `--persist`.
The CLI help documents sample roles, fitness applicability and explicit DrugZ
pairing. This local CLI is distinct from a browser-connected worker service.

Outstanding work includes a fitted validation-confidence model, representative
independent validation outcomes, Atlas-distribution QC calibration, a complete
queue worker, connected browser uploads and end-to-end workspace report exports.
Schema support alone does not implement those workflows.

## Research dependencies

`engine/requirements.txt` records the existing research environment and optional
packages; `setup.sh` does not install all of it. Use
`-c engine/constraints.txt` for compatible additions. A single blanket pip install
is not a verified clean-environment recipe: the recorded rs3 dependencies need
special handling and optional git clones have their own revisions/patches. Follow
the notes in that file rather than relaxing constraints until the solver succeeds.
No GPU, paid model API or privileged database write is required for the archived
local prediction replays. Their caches and source files are still prerequisites.

See [analysis entry points](../engine/analysis/README.md) and
[the final measured results](../research/10_FINAL_RESULTS.md). Archived scripts
can overwrite local artifacts or consult exposed test labels; preserve their
outputs and keep new model selection on permitted development data.

## Production note

These are macOS arm64 builds for local work. Workers will need the same
environment in a Linux container and an independent recreation check.
`environment.yml` is a starting specification, not a solved cross-platform lock;
the binaries under `engine/.tools` are not. `setup.sh` detects platform and
handles `linux-64` and `linux-aarch64` as well.
