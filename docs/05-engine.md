# The engine

The offline half: the tools that turn reads into scored hits.

```bash
bash engine/setup.sh
export PATH="engine/.tools/env/bin:$PATH"
python engine/tests/smoke_test.py
```

`setup.sh` installs micromamba locally, so it needs no system package manager,
builds the pinned environment, clones BAGEL2, and then verifies every tool
actually runs rather than assuming the install worked.

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

All verified running on this machine, not just present on disk.

## Four pins that are not negotiable

**Python 3.11.** MAGeCK's bioconda package pins `python >=3.10,<3.11` and will
not solve against anything newer. MAGeCK has also been frozen upstream since
December 2021, so it is not going to grow support for a newer interpreter.

**NumPy below 2.** BAGEL2 calls `np.in1d`, removed in NumPy 2.0. The failure is
nastier than it sounds: `fc` succeeds and writes its output, then `bf` dies
with an `AttributeError`, so it reads like a BAGEL2 bug rather than a
dependency one.

**MAGeCK needs its environment on `PATH`.** It shells out to the `RRA` binary
by bare name. Calling `engine/.tools/env/bin/mageck` by absolute path leaves
`RRA` unresolvable, and MAGeCK reports `command not found` deep in its log
while exiting non-zero on a missing output file. Always export `PATH`.

**BAGEL2 is not on bioconda.** It installs by `git clone`, has no release tags,
and its `-s` flag is registered twice (`--use-small-sample` and `--seed`), so
use the long forms in anything automated.

## Verified end to end

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

## Not built yet

The tools are installed and validated. The pipeline that orchestrates them is
not written. What remains:

- Counting from FASTQ: anchor scan, exact match with a one-mismatch fallback
- Library fingerprinting as a service, though the SQL side already works
- QC metric computation and comparison against Atlas distributions
- Artifact flagging: copy number, guide concordance, promiscuity
- The scoring model, which needs validation outcomes before it can be fit
- The worker loop that leases jobs from pgmq and writes results back

The database, the queue and the reference data are all in place for it.

## Production note

These are macOS arm64 builds for local work. Workers will need the same
environment in a Linux container. `environment.yml` is the portable artifact;
the binaries under `engine/.tools` are not. `setup.sh` detects platform and
handles `linux-64` and `linux-aarch64` as well.
