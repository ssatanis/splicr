# Deterministic validation engine — what exists, and what the premise assumed

Date: 2026-09-30. Written because a build request described a deployed platform that
this repository does not contain, and building on that description would have
produced code that could not be run, let alone verified.

Everything below was checked, not recalled. Commands and outputs are named so the
checks can be repeated.

## 1. The infrastructure the request assumed

The request described upgrading "the Airflow/Modal pipeline you just deployed",
with six Modal containers, a `splicr-ingest` Modal secret, thirteen loaded
libraries and twelve studies in a review queue.

None of that is in this repository:

| Assumed | Found |
|---|---|
| Airflow DAGs | No reference to Airflow in any file |
| Modal containers / secrets | No Modal Labs usage. The 263 matches for "modal" are all the substring in `modality` |
| inDelphi / FORECasT deployed | Named only in `engine/research/frameshift/`, as models that were *not* run |
| AlphaFold / PDB | No reference anywhere |
| Neo4j knowledge graph | No reference anywhere |
| SCEPTRE / causal engine | No reference anywhere |
| SRA / GEO / ENA ingestion | No ingestion code. `scripts/data/ingest-orcs.py` imports BioGRID ORCS summaries; the CLI cannot take an SRA accession (`docs/02-pipeline.md`, stage 01) |
| Autonomous worker + review queue | Migrations define `jobs`, a pgmq queue and leases. No worker consumes them (`docs/01-architecture.md`, "Planned orchestration") |

```sh
grep -ril airflow .            # 0 files
grep -rihoE '\w*modal\w*' engine/splicr/*.py | sort -u   # "modality" only
```

The pipeline that *does* exist is the local CLI: nine stages, `ingest → detect →
count → QC → call hits → flag artifacts → atlas → score → report`, with the score
stage explicitly skipped because no calibrated model is fitted.

## 2. The databases

`supabase/migrations` defines `public`, `atlas` and `private`. The Supabase project
reachable from this session named "SplicR" (`bayelctmjshdgkezhuuv`) **has none of
them** — only Supabase's own `auth`, `storage`, `realtime`, `extensions` and
`vault`. The migrations have never been applied to it.

```sql
select table_schema, count(*) from information_schema.tables
where table_schema not in ('pg_catalog','information_schema') group by 1;
-- auth 27, extensions 2, realtime 3, storage 8, vault 2
```

The project the request named, `afvxbjfreqlmbzsjmzzk`, is **not reachable**: the
connected Supabase credentials return "You do not have permission to perform this
action" for it, and it is not in the connected organisation's project list. It is
presumably where the 1,550,112 GSE145743 guide-count rows and `atlas.gene_stats`
actually live, since `engine/research/frameshift/run.py:300` reads whatever
`SUPABASE_DB_URL` points at and that analysis did run against populated tables.

**Nothing in this session has written to either project.** Which project is
canonical is a question only the repository owner can answer, and picking one
would have been a guess with migrations attached.

## 3. This environment cannot reach any genomic data source

Every host the request's phases depend on is denied by the environment's network
policy:

```
ftp.ensembl.org  hgdownload.soe.ucsc.edu  rest.ensembl.org
eutils.ncbi.nlm.nih.gov  api.ncbi.nlm.nih.gov  ftp.ncbi.nlm.nih.gov  www.ebi.ac.uk
```

all return no response; the proxy logs `403 to CONNECT (policy denial)`. Only
package registries and the Anthropic API are reachable.

The consequences are concrete, not procedural:

- **The NCBI API key cannot be used or validated here.** There is also no `.env`
  in this container — it is gitignored and lives on the author's machine — and
  `NCBI_API_KEY` is not in `.env.example`. Rate limits cannot be the current
  bottleneck for a planner that cannot reach NCBI at all.
- **No hg38.** So no cut-site resolution against a real genome, and no way to run
  inDelphi or FORECasT on real guides.
- **No SRA/GEO/ENA.** Ingestion code could be written but not exercised against a
  single accession, which is how untested network code gets described as built.

The engine toolchain is also absent from this container: no bowtie, samtools,
seqkit, cutadapt, fastp or MAGeCK, and no numpy. `engine/requirements.txt` pins an
environment built for macOS arm64.

## 4. The repair-outcome hypothesis was already tested, and was null

This matters most, because Phase 1 of the request is the moat.

`engine/research/frameshift/` pre-registered thresholds, then tested whether a
sequence-derived frameshift prediction explains which guides deplete, using
GSE145743 and the 1,034 genes `atlas.gene_stats` marks common-essential as ground
truth — a cell cannot lose one and keep growing, so a guide that targets one and
fails to deplete is a failed knockout.

**Result: rho 0.0162, p 0.415, n 2,531.** Fails all three pre-registered
thresholds (direction, p < 0.01, |rho| >= 0.05). The secondary within-gene test is
also null: median difference −0.03, p 0.883. The dud guide's score sits inside its
working siblings' range every time; all three of NOL10's guides score 0.62 while
one does nothing.

What that settles: a frameshift proxy from the bare 20bp protospacer carries no
usable signal here. What it does not settle: inDelphi and FORECasT read ~60bp of
genomic context, and `atlas.guides.cut_pos` is 0 for every GeCKOv2 guide, so that
sequence did not exist in the database and a real repair model was never tested.

So the honest status of "the cheap route is closed, the expensive route is
untested" is unchanged — and the blocker is a named, specific, missing capability
rather than a missing GPU.

Worth keeping in view either way: JACKS and MAGeCK-NEST already down-weight weak
guides by *measuring* what they do. An empirical measurement beats a prediction of
the same quantity, so a repair model has to beat that baseline, not MAGeCK's
unweighted default.

## 5. What was built

`engine/splicr/cutsite.py` — the step the null result named as missing: a guide
sequence to its genomic coordinates to the surrounding sequence a repair model
reads. Tested by `engine/tests/test_cutsite.py`, which passes.

Two design decisions carry the weight:

**Conventions are verified, not assumed.** Brunello's column is "Position of Base
After Cut (1-based)", which does not say whether the position counts along the
forward strand or along the guide. Guessing wrong shifts every context window by a
few bases — invisible in the output, fatal to the model reading it. So an
annotated coordinate is accepted only when the genome at that locus actually
spells the protospacer. Three candidate conventions are tried; one must survive,
or `CutSiteError` names what was tried and why each failed.

**Ambiguity is returned, not resolved.** `resolve_by_search` finds a protospacer by
exact match in a bounded window on both strands and returns *every* hit. A 20-mer
can occur twice; taking `[0]` would manufacture a coordinate.

That search path is how the GeCKOv2 gap closes without a whole-genome index: the
library row already names the target gene, so scoping the window to that gene's
locus makes the search exact and small.

The genome sits behind a `GenomeSource` protocol with two implementations —
`InMemoryGenome` for tests, and `IndexedFasta`, which reads a `.fa` through its
`.fai` with no compiled dependency.

### What the tests establish, and what they do not

The suite plants the protospacer at a known coordinate on a synthetic contig, so
both strands and all three conventions are asserted against values derived by hand
rather than by round-tripping the code. It checks the cut lands between
protospacer positions 17 and 18 on each strand, that reverse-strand context is
reverse-complemented (asserting explicitly against the un-complemented slice,
which keeps the right length and centre and is the mistake that hides), that the
two arms partition the window at every flank from 1 to 60, that wrong coordinates
and wrong strands raise instead of returning a plausible window, that duplicate
hits both come back, and that `IndexedFasta` agrees with the in-memory genome
across line-wrap boundaries.

It does **not** establish anything against a real genome. hg38 is unreachable from
this container, so the module has never been run on a real locus or a real library
row. The arithmetic is verified; the integration is not. That is the next check,
and it needs one command on a machine with the genome:

```sh
samtools faidx hg38.fa
# then resolve a few hundred Brunello rows, which ship their own coordinates,
# and confirm the annotated convention that survives is the same one for all of them
```

If Brunello's rows resolve under a single consistent convention and the PAM is NGG
throughout, the resolver is sound and GeCKOv2 can be run through the search path.
If they do not, the convention assumption is wrong and that has to be fixed before
any repair model reads a single window.

## 6. What each requested phase would actually take

Stated so the sequencing is explicit, not as a promise that any of it pays off.

**Phase 1, biophysical layer.** Needs, in order: hg38 reachable; §5's real-genome
check passing; cut contexts for GeCKOv2 via the search path; then inDelphi or
FORECasT run over those contexts. Only then is there a real test of the hypothesis
the proxy failed. A structural layer on top of that is a further step and needs its
own pre-registration — "the deletion removed a floppy loop" is a hypothesis about
effect size, and AlphaFold confidence in a loop region is itself low, which is the
first confound to handle rather than the evidence.

A "TrueKnockout Confidence Score" cannot ship before that test passes. Shipping a
score whose underlying signal measured rho 0.016 would state as fact something this
repository has already measured as absent.

**Phase 2, custom library extraction.** The real limitation is accurate: twelve
`LibrarySpec` entries in `engine/splicr/references.py`, and only Brunello and Brie
carry `chrom_col`/`pos_col`/`strand_col` — which is precisely why GeCKOv2 has no
`cut_pos`. Parsing a supplementary table into a library is tractable and does not
need a repair model to be real. It needs the extraction to be checked rather than
trusted: a parsed library whose guides do not match the deposited FASTQs at the
rate `detect.py` expects is a wrong parse, and that check is available already.

**Phase 3, resolving complex designs.** Reading a Methods section to identify which
sample is the T0 control is a reasonable use of a language model. It should write
into the review queue as a *proposal with its evidence quoted*, not overwrite the
planner's uncertainty. The queue exists in the migrations; the worker that would
consume it does not.

**Ingestion of "all public CRISPR screens".** ORCS import is real and is gene-level
summaries retaining the original authors' hit calls — explicitly not a uniform
raw-read reanalysis (`README.md`). Turning that into raw-read reanalysis of every
public screen is a petabyte-scale claim and the honest version is a counted,
auditable subset with the failures listed.

**Entity harmonisation.** Already built, and it is the one requested item that
needs no new science. `engine/splicr/harmonize.py` maps genes to HGNC (carrying
Ensembl and NCBI Gene), cell lines to Cellosaurus `CVCL_` accessions and compounds
to ChEMBL, with a fixed match precedence reported per result, and it refuses to
guess: a multi-match returns `ambiguous` with every candidate, a non-match returns
`unresolved`. Its module docstring names the ERBB2 / HER2 / CD340 collapse as the
failure it exists to prevent — the same example the request gives.

Its 22 tests in `test_harmonize.py` **skip in this container**, each guarded on a
reference file that is not downloaded (`HGNC_PATH`, `CELLOSAURUS_PATH`,
`CHEMBL_PATH`) and cannot be, since those hosts are blocked per §3. So the resolver
is read and present; it was not executed here, and this document does not claim it
works.

The gap is **enforcement, not capability**. Only `scripts/data/build-depmap-lake.py`
calls it. `scripts/data/ingest-orcs.py` — the path that actually populates the
Atlas — does not, and neither does `pipeline.py`. Routing every ingest through the
resolver and failing the ingest on an unresolved entity is a contained change
against code that already exists and is already tested, and it is the cheapest real
win on this list.

```sh
grep -rln harmonize --include='*.py' engine scripts
# engine/tests/test_harmonize.py, engine/tests/test_depmap_lake.py,
# scripts/data/build-depmap-lake.py   -- note which files are absent
```
