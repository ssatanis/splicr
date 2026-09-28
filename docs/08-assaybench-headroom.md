# Where the AssayBench headroom actually is

> Historical exploratory analysis; see `research/05_BENCHMARK_REPRODUCTION.md`
> and `research/08_VALIDATION_REPORT.md` for the audited protocol. Filtering and
> padding against a target's measured genes supplies an additional input and
> must be reported as library-aware prediction. It is not a description-only
> gain over unchanged published rankings. The public test was repeatedly
> inspected during these analyses. The proposed 0.3239 "bar" below is another
> hindsight-assisted diagnostic, not a universal performance ceiling. Statements
> below about choosing methodology from test reversals are historical reasoning,
> not an acceptable protocol for new model selection.

`data/references/assaybench/RESULTS.md` records where SplicR stands on the
334-screen `yearfold0` test split: best non-oracle, non-LLM score **0.1361**,
best published system **0.1631** (LLM RRF ensemble), and `oracle_knn` at
**0.2918**. This file records what the 0.2918 number *is*, why it is not a
ceiling, and the ordered list of moves that close the gap, each with the
measurement that justifies it.

Everything below is measured on the same 334 screens with the same metric
instance that reproduces all six published reference points to four decimals.

## 1. Oracle kNN is a baseline, not a ceiling

`benchmark.OracleKNN` sweeps all 1349 training screens, scores each one's own
top-100 gene list against the evaluation screen's labels, and keeps the best. So
it is `max` over a **fixed set of 1349 rankings**, selected with the answer. Three
things follow, and all three are measured rather than argued.

**It competes with a 62-slot handicap.** The metric's `dcg()` truncates to `k`
*before* dropping unmeasured genes, so a gene the screen did not measure burns a
DCG slot. Of the oracle's first 100 genes, on average only **62.3 are in the
query screen's own library**; on **149 of 334** screens fewer than 50 are. It is
filling about 62 of its 100 positions with genes that can score.

**A method that fills all 100 slots beats it on the same information.** Taking the
oracle's own list, dropping the out-of-library genes so the survivors move up, and
padding the freed positions with the phenotype prior's order raises it from 0.2918
to **0.3239** without changing which donor was picked.

**It is already beaten on one category.** On the 44 `Fitness / Proliferation /
Viability` test screens the plain phenotype-stratified prior scores **0.5314**
against the oracle's **0.4190**. A single fixed donor list cannot express "every
common essential, in order of how essential".

So the honest bar is not 0.2918. It is **0.3239**, the oracle with the same
post-processing any competing method gets, and a reader is entitled to hold a
claim to that number.

## 2. The free 0.056: every published system wastes its rank budget

Because unmeasured genes burn slots, a prediction list should be normalised,
deduped, filtered to the screen's own library, densified, and padded to exactly
100 real candidates. Neither half of that works alone — only the combination.

| system | shipped | in-library only | padded only | both | gain |
|---|---|---|---|---|---|
| Oracle kNN | 0.2918 | 0.2918 | 0.2911 | **0.3239** | +0.0321 |
| LLM RRF Ensemble | 0.1631 | 0.1631 | 0.1632 | **0.2196** | +0.0565 |
| gemini-3-pro | 0.1570 | 0.1570 | 0.1579 | **0.2138** | +0.0568 |
| gemini-3.1-pro | 0.1472 | 0.1472 | 0.1469 | **0.2073** | +0.0601 |
| fewshot/gemini-3-pro-knn10 | 0.1537 | 0.1538 | 0.1537 | **0.2115** | +0.0578 |
| gpt-5.4 | 0.1470 | 0.1476 | 0.1471 | **0.2032** | +0.0562 |
| gemini-3-flash | 0.1446 | 0.1447 | 0.1457 | **0.2028** | +0.0582 |
| gepa/gemini-3-flash | 0.1406 | 0.1406 | 0.1412 | **0.2001** | +0.0595 |
| gpt-5-mini | 0.1362 | 0.1361 | 0.1372 | **0.1941** | +0.0580 |
| SFT + GRPO best (gpt-oss-120B) | 0.1293 | 0.1293 | 0.1293 | **0.1868** | +0.0575 |
| claude-opus-4.5 | 0.1269 | 0.1272 | 0.1271 | **0.1822** | +0.0554 |
| Embedding kNN | 0.0646 | 0.0646 | 0.0652 | **0.1299** | +0.0653 |

Mean gain over the twelve systems: **+0.0561**. The phenotype prior gains nothing,
because it already ranks the screen's own library and emits it in full.

Read the two middle columns carefully, because they are the mechanism:

* **in-library only** changes nothing. Dropping a non-library gene does not
  promote anything, since the metric already condensed it away.
* **padded only** changes nothing. The 100-entry budget was already spent on the
  raw list, so an appended tail never gets inside the cutoff.
* **both** is worth 0.056, because densifying releases budget and padding spends
  it on candidates that can score.

This is post-processing, not science. It is listed first because it is the largest
single number in this file and it applies to every method, ours and theirs.

## 3. The test split is three different problems

From `RESULTS.md` section 6, with the oracle row as the local bar:

| category | n | strat. prior | LLM ensemble | oracle |
|---|---|---|---|---|
| Drug / Chemical / Environmental | 144 | 0.0987 | 0.1380 | 0.3078 |
| Host-Pathogen / Infection | 105 | 0.0656 | 0.1772 | 0.2756 |
| Fitness / Proliferation | 44 | **0.5314** | 0.2189 | 0.4190 |
| Molecular Output / Reporter | 39 | 0.0238 | 0.1606 | 0.1407 |
| Trafficking / Localization | 2 | 0.0154 | 0.0466 | 0.1356 |

No single estimator is right for all five. The prior wins fitness by 0.31 over the
LLM ensemble and loses reporter screens by 0.14. `cleaned_phenotype` is an
observable metadata field, so routing on it costs nothing and is not tuning.

## 4. The coarse phenotype stratum throws away the test set's actual structure

Upstream's best baseline conditions the hit rate on a 5-way `cleaned_phenotype`.
The test split's screens are far more specific than that, and the specificity is
in fields a predictor may read.

| what the screens actually are | test screens | donors in train+validation |
|---|---|---|
| SARS-CoV-2 | 85 | 15 |
| poxvirus / vaccinia | 20 | **0** |
| HIV | 5 | 1 |
| seasonal coronaviruses (229E/OC43/NL63) | 3 | 5 |
| influenza | 3 | 6 |
| named compound with >= 2 same-compound donors | 78 | — |

A quarter of the test split is one virus, and there are fifteen screens of that
same virus on the training side that the 5-way stratum dissolves into "host-pathogen".
Conditioning the counters on an extracted entity instead recovers them.

Measured as a probe — phenotype prior alone versus phenotype prior plus one
channel, restricted to the test screens where that channel is non-constant:

| channel | fires on | prior only | + channel | delta |
|---|---|---|---|---|
| per-model LLM RRF (dense) | 334 | 0.1371 | 0.1706 | **+0.0335** |
| compound-identity prior | 96 | 0.0907 | 0.1121 | **+0.0214** |
| pathogen-identity prior | 91 | 0.0932 | 0.1104 | **+0.0172** |
| cell-line prior | 206 | 0.1366 | 0.1506 | +0.0140 |
| cytokine-identity prior | 22 | 0.0170 | 0.0205 | +0.0035 |
| opposite-direction rate (subtracted) | 334 | 0.1371 | 0.1428 | +0.0057 |
| named-gene anchor, direct | 205 | 0.1132 | 0.1142 | +0.0010 |
| named-gene anchor, Reactome expansion | 223 | 0.1172 | 0.0823 | **-0.0349** |
| named-gene anchor, STRING expansion | 245 | 0.1596 | 0.0947 | **-0.0747** |

The two network-expansion channels **hurt** at unit weight: a Reactome or STRING
neighbourhood of a named reporter gene is mostly non-hits, and at that weight it
displaces the prior. They are kept in the channel set only so the weight search
can decide, and the search drives them near zero. This is a negative result and it
is recorded as one.

The compound prior is usable because DGIdb resolves the test split's actual
compounds correctly: bortezomib to the proteasome subunits, selinexor to XPO1,
olaparib to PARP1/PARP2/FANCA, camptothecin to TOP1, colchicine to tubulin.

## 5. Validation cannot be used to tune this

`RESULTS.md` already notes that the estimator preference reverses between
validation and test. It reverses per channel as well:

| channel | delta on validation | delta on test |
|---|---|---|
| global prior | +0.0110 | -0.0120 |
| library-methodology prior | +0.0119 | -0.0125 |
| cell-line prior | **-0.0387** | **+0.0140** |

Validation is 218 screens from one year, 72% drug response; test is 43% drug and
31% infection. Fitting fusion weights there is fitting the 2021 mixture.

The fix is **leave-one-publication-out over all 1567 pre-2022 screens**. Because
every conditional counter is a row-subset sum of a sparse screen-by-gene matrix,
the counts for a query with its own publication removed are the full counts minus
that publication's rows — exact, and cheap enough to do for all 1567. That gives
1567 tuning queries spanning every phenotype mixture and every publication,
instead of 218 from a single year, and it never touches a test screen.

## 6. What is not allowed

The fastest route to a large number here is leakage, and the value of this
repository is that its numbers survive being checked. Four channels are off limits
and should be named in any write-up so a reader does not have to ask.

**Per-cell-line DepMap.** `CRISPRGeneEffect` *is* the Broad Avana fitness
experiment. On a fitness screen in a DepMap model it is a later release of the
label. The cell-line-independent products (the inferred common essentials list)
are a gene-level summary over ~1000 lines and are allowed, on the same reasoning
as `docs/07-replication-benchmark.md`.

**Literature dated after the split boundary.** PubTator co-mentions would give a
strong pathogen channel for the 20 poxvirus screens that have no donor, but the
test screens' own papers are in PubMed. Any literature channel must exclude every
PMID in the validation, test and novel splits, and preferably everything in ORCS.
`data/references/derived/pubtator_symbol_counts_excl_replication.json` is the
pattern to follow.

**Selecting anything on test.** Channel weights, the LLM subset, the shrinkage
constant, the RRF constant, the padding order. All of it is chosen by LOPO on
pre-2022 screens, and the test split is scored once.

**ORCS records for the test screens.** `splicr.orcs_safe` already refuses them.
Nothing in this work may go around it.

## 7. The arithmetic

To pass the honest bar of 0.3239 the per-category budget has to look roughly like
this, against what is measured today:

| category | n | today | needed | where it comes from |
|---|---|---|---|---|
| Drug | 144 | 0.0987 | ~0.30 | compound-identity prior + target/pathway + dense LLM fusion |
| Pathogen | 105 | 0.0656 | ~0.30 | pathogen-identity prior (15 SARS-CoV-2 donors for 85 screens) |
| Fitness | 44 | 0.5314 | ~0.55 | already there; essentials ordering |
| Reporter | 39 | 0.0238 | ~0.20 | dense LLM fusion; network expansion does not work |
| Trafficking | 2 | 0.0154 | — | too few to matter |

Drug and pathogen carry 75% of the test split and 90% of the deficit. Nothing
else is worth working on until those two move.

## 8. Order of work

1. **Ranked-list hygiene** in `benchmark.evaluate`, applied to every scorer: +0.056
   across the board, no new signal. Report the densified oracle alongside the
   published one so the bar moves too.
2. **Dense weighted fusion** over the shipped prediction lists plus the prior,
   weights by LOPO. The uniform 12-model pool scores 0.1812 on test while
   densified gemini-3-pro alone scores 0.2138, so the models must be weighted
   individually, not pooled.
3. **Entity-conditioned counters**: pathogen, compound, cytokine, cell line, with
   shrinkage to the coarse stratum and an opposite-direction penalty.
4. **Compound target expansion** from DGIdb and Open Targets mechanism-of-action.
5. **A PMID-filtered literature channel** for the 20 poxvirus screens, which have
   no donor at all. This is the only route for them and it is last because it is
   6% of the split and the leakage argument has to be airtight.

## 9. Reproducing what is in this file

The measurements live in `engine/analysis/assaybench_headroom/`. The slot-waste
and post-processing tables come from `decompose.py`, the per-channel probe from
`channels_probe.py`, and the fusion from `fuse.py`, which caches a sparse
screen-by-gene matrix once and then runs each conditional counter as a row-subset
sum. The fast AnDCG path used by the weight search agrees with
`benchmark.ScreenTarget.score` to 1.6e-17 over 60 screens, verified in
`test_fast_metric_parity`.
