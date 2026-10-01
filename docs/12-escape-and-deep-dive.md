# Guide disagreement, and SplicR Escape

Two capabilities that answer the question after "which genes are hits": what
actually happened to this gene's reagents, and what could account for a phenotype
that is weaker than it should have been.

Status of each claim in this document is stated explicitly. Nothing below is
described as validated unless a named experiment validated it.

---

## 1. Guide disagreement — implemented

### The question

Four guides target a gene. One depletes hard, three do nothing. The gene's mean
lands near zero, the hit caller returns nothing, and the target is dropped. The
opposite happens too. Either way the number that reaches the reader is a mean over
reagents of unequal and unknown quality, reported without its spread.

### What is computed, and where

One implementation, in `engine/splicr/validate/domain_report.py`. The offline
worklist, the pipeline and the service API all call `build_report`, so a gene
cannot be described one way offline and another way in the console. There used to
be three implementations with three different thresholds; `engine/tests/
test_domain_report.py` exists partly to keep that from recurring.

| Quantity | What it is | Why it is that and not something else |
|---|---|---|
| `spread` | sample standard deviation of the gene's guide fold changes | — |
| `spread_vs_screen` | that spread over the median spread of same-size genes **in the same comparison** | An absolute variance cut calls every gene in a noisy screen discordant and no gene in a quiet one. Keyed by guide count because a 2-guide sd is not comparable with a 10-guide one. |
| `fragile`, `pivotal_guide` | whether the call survives dropping one guide | A sensitivity statement. It makes no claim about *which* guide is right — the measurements in `engine/research/{frameshift,isoform}/` say that claim cannot be supported. |
| `concordance` | Fisher exact test on (guide depleted) × (guide cuts the feature the depleting guides share), with the **smallest p those margins allow** | With four guides the test has almost no power. Printing the floor beside the observed p shows how little the table could ever have shown. |
| per-guide residue, features | MANE Select CDS → residue → curated UniProt features | Interpretation for a reader deciding what to test next. It is not evidence about the screen. |

### What it does not say

It does not answer "structural vulnerability confirmed". An earlier endpoint did,
whenever a gene's depleting guides happened to share one annotated feature. That
is a conclusion four correlated guides cannot support: guides that cut near each
other share chromatin, copy number, off-target neighbourhoods and often exons, so
their fold changes are correlated for reasons unrelated to the domain. The response
states the observation, gives the test, and names the confound in a `confound`
field that the console prints.

It also changes no measurement. Re-weighting and filtering guides by predicted
quality were both tested on the largest data available and both made gene calls
worse.

### Where the numbers live

Computed once at analysis time and stored, so a reader sees a recorded value with
its reference releases rather than whatever a live lookup returns today.

| Table | Contents |
|---|---|
| `public.guide_effects` | one row per guide per comparison: MAGeCK's own per-guide fold change **under the guide id MAGeCK printed**, the library's verified cut coordinates, and the residue and curated features that cut falls in when they resolve |
| `public.gene_disagreement` | one report per gene with ≥2 guides: the queryable scalars, plus the whole report as a schema-checked `jsonb` document |

`public.hits.guide_lfcs` remains what it was: an unlabelled `real[]` for the
single-guide artifact check. It is *not* used for the deep dive. Recovering the
guide→effect pairing by array position is not a join — MAGeCK's sgRNA summary is
not ordered by the library file, guides with no reads never appear in it, and a
library can hold more guides for a gene than the comparison scored — and a table
built that way attributes measurements to the wrong reagents.

`concordance_status = 'not_evaluated'` means the protein context was never looked
up for this gene (it was outside the run's annotation shortlist, `pipeline.py:
GUIDE_ANNOTATION_LIMIT`). `'no_features'` means it *was* looked up and nothing
curated covers any resolved cut. The console prints different sentences for them.

### The contract with the console

The console renders the stored document and recomputes nothing, so the document is
a contract between two languages:

```
engine/splicr/api/schemas.py                    the pydantic models
apps/web/src/lib/data/disagreement.schema.json  generated, committed
engine/tests/test_api_schema.py                 fails if the model changed and the file did not
apps/web/tests/disagreement.test.mjs            fails if the TypeScript stops covering the file
```

Regenerate with:

```bash
engine/.tools/env/bin/python -m splicr schema disagreement \
  > apps/web/src/lib/data/disagreement.schema.json
```

### Reading it

`GET /api/v1/screens/{screenId}/genes/{gene}/disagreement` — a Next.js route
handler, read under the reader's own session, where Row Level Security applies and
the organization comes from the session and never from the URL. GET rather than
POST because it is a read with no side effect: cacheable, linkable, and cancellable
when the reader clicks a different gene.

The engine's own `GET /v1/screens/{id}/genes/{gene}/disagreement` serves the same
document to service callers holding a SplicR Connect key. The console does not use
it: the engine holds the Postgres secret key and bypasses RLS by design, so
nothing a browser can reach may call it.

### In the console

`/dashboard/screens/[id]` gains an **Effect and significance** panel above the
gene table. One dot per recorded gene at its recorded effect and FDR — a canvas,
because a genome-wide comparison is twenty thousand dots and a plot that drops
rows for frame rate is still dropping rows. Genes with no recorded FDR sit on a
separate labelled row below the axis rather than at the top as if they were the
most significant. Dots beyond an axis limit are drawn hollow. The FDR and effect
thresholds emphasise dots and recompute nothing, and the axis caption says so.

Clicking a gene opens its guide evidence: the engine's sentence, the four facts
behind it each with its denominator, every guide with its own fold change and
where it cut, the protein track, the AlphaFold model, and the concordance table.

The drawer has no "recalculation" control. An earlier version let the reader untick
guides and watch a "Bonferroni p" — the smallest guide p-value times the guide
count — move. That is not a gene-level p-value: the guides are not independent
tests of separate hypotheses and MAGeCK's gene statistic is a rank aggregation, not
a combination of per-guide p-values. The leave-one-out range is shown instead,
computed once by the engine.

The structure viewer states every outcome separately — no reviewed accession, no
AlphaFold model for that accession, a load failure, or a model shown — and never
leaves a spinner standing in for an answer. It says, in the viewer, that the model
is of the **unedited** protein and is not a prediction of what the edit did.

---

## 2. SplicR Escape — paralog compensation implemented, four families named

### The scope, and what is not in it

Escape asks: this target's phenotype is weaker than the evidence says it should
be — what could account for that? Several mechanism families can:

| Family | Status |
|---|---|
| paralog compensation | implemented |
| pathway bypass | named, not implemented |
| feedback activation | named, not implemented |
| state adaptation | named, not implemented |
| variant-mediated resistance | named, not implemented |

The four are named in `engine/splicr/escape/__init__.py` because an engine that
reported paralog compensation as *the* escape mechanism would be claiming to have
ruled out four families it never looked at.

### The trigger: when is a phenotype weaker than it should have been

`engine/splicr/escape/trigger.py`. Not `LFC ≈ 0`: a gene at zero is the normal
state of almost every gene in a screen. What makes zero interesting needs three
things a fold change does not carry.

1. **A reason to expect depletion.** An independent source must say this gene
   should deplete here, and the model must express it.
2. **A screen that could have measured depletion.** The contrast must be a declared
   loss-of-function fitness endpoint, QC must not have failed, and the screen's own
   essential/non-essential separation must reach |NNMD| ≥ 1.25. If a screen's known
   essentials did not deplete either, the gene's zero is the screen's zero.
3. **A scale.** "Weak" is measured against the depletion *this screen* produced for
   the ≥50 reference essentials it measured, at the 90th percentile. The same fold
   change is unremarkable in a shallow screen and unexpected in a deep one, and a
   test in `test_escape_paralogs.py` pins exactly that.

It refuses to flag a gene whose own call is fragile, or whose guides disagree
≥2× more than this screen's norm: then thin reagent evidence explains the result
without invoking any mechanism, and the guide-disagreement report already says so.
Every refusal is returned with its reason, and ineligible genes stay in the
worklist so a caller can see how many the gate excluded and why.

No p-value is produced. There is no sampling model for "genes that should have
depleted"; what is reported is a percentile with its denominator.

### The paralog layer

`engine/splicr/escape/paralogs.py`, built by `scripts/data/build-paralogs.py` into
a pinned Parquet. Two channels, kept apart:

| Channel | Source | What it claims |
|---|---|---|
| `ensembl_compara` | Ensembl Compara paralogues, REST, condensed | Ensembl's own `homology_type` and the taxonomic level it places the duplication at. Sequence-based. |
| `hgnc_gene_group` | HGNC gene groups, local file, no network | Two genes curated into the same group. **Not** a sequence claim. |

They are separate rows with separate provenance and are never merged into one
score. Agreement between them is reported as what it is: two independent sources.
Groups larger than 25 members are dropped — a pair drawn from "Zinc fingers"
shares a motif, not a function.

`paralogs_of` returns a `Lookup`, not a list. A gene the build never covered
answers `covered = False`, which every caller handles separately from a gene that
was covered and has no paralog. Returning an empty list for both would let the
console print "no paralog" about a gene nobody looked up.

The Ensembl channel is **partial by design**: the endpoint answers one gene per
request, so the build is incremental and resumable, and genes it has not reached
are reported uncovered. `data/references/paralogs/SOURCES.txt` records the counts
and hashes of whatever is built in a given checkout. `data/references/` is not
committed; both channels rebuild from the script.

### The six evidence channels

`engine/splicr/escape/evidence.py`. Each returns its own value, its availability,
its source and what it cannot establish.

| Channel | Source | Limitation it states |
|---|---|---|
| `paralogy` | the pinned build | A paralogy call is about sequence or curation, not functional interchangeability in this cell. |
| `expression` | DepMap `expression_tpm_log1p` | **Can only rule the candidate out, never in.** A paralog can be abundant and do something else, or scarce and sufficient. |
| `conditional_dependency` | DepMap `gene_effect`, split by the target's own state | A difference here is an association across cell lines, not a demonstration that losing the target creates the dependency. |
| `pathway_overlap` | Reactome, via the knowledge graph | Sharing a pathway says the genes act in the same program, not that either replaces the other. |
| `complex_membership` | STRING v12 physical links | For a duplicate pair this is weak: paralogous subunits often interact, and so do proteins that cannot substitute. |
| `paired_validation` | the workspace's own recorded outcomes | Only this channel can establish compensation. |

**Expression alone never raises a hypothesis, at any level.** A paralog being
abundant is the single most common substitute for evidence in this area, and the
strength rule is written so that it cannot be one.

**The conditional channel is the informative one.** It is the only one that asks a
counterfactual: across DepMap models, is the candidate more essential where the
target is already broken? Computed as a difference of medians with a **cluster
bootstrap over cell lines**, because the models are the independent unit — a
per-gene test over thousands of correlated measurements would manufacture
significance. It supports the hypothesis only when the candidate is more essential
where the target is lost *and* the 95% interval excludes zero. Below ten models on
either arm it reports insufficient models rather than a number.

"The target is lost" is three things — damaging mutation, deep deletion, or not
expressed — and a model not profiled on all three is in **neither** arm, because
defaulting it to "intact" would dilute the comparison with unknown states.

### Strength, and why there is no score

A weighted sum of six correlated, differently-scaled, differently-trustworthy
quantities produces a number nobody can interpret and that no outcome data
calibrates. What is reported is each channel's own value plus one ordered label,
whose rule is written out in the module and printed with the result:

```
insufficient  paralogy unavailable, or nothing but paralogy and expression evaluable
weak          paralogy holds; the conditional channel did not support it
moderate      paralogy and the conditional channel both support it
strong        those two, plus pathway or complex overlap, and expressed in this model
```

It is a reading order, not a probability, and the summary says so.

### What it never says

Not "Gene Y buffered Gene X". That is causal and needs a paired perturbation.
`test_escape_paralogs.py` asserts the absence of `buffered`, `rescued`,
`compensated for`, `proves`, `confirms` and `established that` from every generated
statement. When the workspace *has* recorded a paired perturbation, the validation
channel becomes available, `direct_causal_evidence` is true, and the statement
changes to point at that record.

### Validation status

Not a unit test — a check against data the engine did not choose.

**Sensitivity.** ARID1B's dependence on ARID1A loss is one of the best-established
paralog relationships in cancer genetics, reported from screens independent of
anything here. On DepMap 26Q1 the conditional channel measures ARID1B at median
Chronos effect **−0.204** in the 108 models where ARID1A is broken against
**−0.034** in the 997 where it is intact — a difference of **−0.170**, 95%
cell-line bootstrap **[−0.263, −0.110]**. The full analysis ranks ARID1B first of
fourteen candidates, then ARID2, both `strong`.

**Specificity.** ACTB — essential in nearly every model, unrelated to ARID1A —
gives **−0.030** with interval **[−0.154, +0.116]** and does **not** support the
hypothesis. A channel that flagged it would be detecting "is essential", not
"becomes conditionally essential", and would support a compensation hypothesis for
any pan-essential gene in the genome.

Both are regression tests (`test_escape_paralogs.py`), skipped when the reference
lake is absent.

**What this does not establish.** One relationship recovered and one negative
control held is not a calibrated detector. There is no held-out set of confirmed
escape mechanisms to measure enrichment against, so the promotion criterion in the
roadmap — prospective or held-out enrichment of confirmed escape mechanisms — is
**not met**, and the module is research-grade for that reason.

### Running it

```bash
engine/.tools/env/bin/python -m splicr escape ARID1A --model ACH-000001
```

Every candidate is evaluated and `--limit` shortens the printout. An earlier
version capped the candidate list *before* evaluating it, ordered by paralogy
strength; with only the HGNC channel built every candidate has the same claim, the
order fell through to a sort on Ensembl id, and a cap of six evaluated JARID2,
ARID4A and KDM5D for ARID1A while never looking at ARID1B. That regression is
pinned.

---

## 3. The dual-knockout proposal — implemented, with four refusals

`engine/splicr/multiplex.py`. Escape can say a compensation hypothesis is strong;
the experiment that settles it is a paired perturbation. This proposes one: two
spacers per gene as a Cas12a crRNA array, with every constraint it checked and
every warning it found.

**It will not score Cas12a guides with Rule Set 3.** RS3 is a SpCas9 on-target
model trained on SpCas9 data; Cas12a has a different PAM, a staggered rather than
blunt cut, and its own published activity models. Handing a Cas12a spacer to a Cas9
model returns a number, which is exactly the problem. No Cas12a activity model is
installed here, so `predicted_activity` is `None` on every spacer and the reason is
a warning on every design. Selection is on sequence constraints and **measured**
genomic specificity — perfect and one-mismatch occurrences counted with bowtie —
and the report says so.

**It will not invent a crRNA scaffold.** The direct repeat depends on the ortholog
and the vector, a construct is what a laboratory orders, and a sequence recalled
rather than read from a source does not belong in front of a bench. The array
layout is emitted always; the construct only when the caller supplies their
vector's repeat.

**It will not design without being asked.** `nuclease` is a required argument with
no default. Engineered variants with expanded PAMs are absent from the registry
rather than treated as wild type, and the refusal says so.

**It will not treat a design as evidence.** Every statement ends by saying it is a
proposed experiment for an untested hypothesis.

What it checks: inside the MANE Select CDS; not in the last exon, where a
frameshift often escapes nonsense-mediated decay; the nuclease's own PAM at its own
spacing; GC range, no long homopolymer, and no `TTTT`, which terminates a pol III
transcript; and genomic uniqueness, measured. Specificity that was never measured
is reported as unknown and does **not** count as unique.

---

## 4. Tests

```bash
cd engine && ../engine/.tools/env/bin/python -m pytest -q -m "not network"
node --test apps/web/tests/*.test.mjs
```

| File | Covers |
|---|---|
| `engine/tests/test_domain_report.py` | the one calculation, the stored annotation, and that every kind of missing annotation says which kind it is |
| `engine/tests/test_guide_disagreement.py` | the report's claims, the exact Fisher test, the screen-relative spread, and the absence of the old verdict |
| `engine/tests/test_api_schema.py` | the committed schema is the model's |
| `engine/tests/test_escape_paralogs.py` | coverage vs emptiness, expression never raising a hypothesis, the cluster bootstrap, ARID1A/ARID1B and the ACTB control |
| `engine/tests/test_multiplex.py` | the four refusals, selection order, and the real-genome proposal |
| `apps/web/tests/disagreement.test.mjs` | the schema contract from the TypeScript side, query scoping, every route status, and what each component may say |

Tests that need the reference lake or the 3 GB genome skip with a message naming
the script that builds it.
