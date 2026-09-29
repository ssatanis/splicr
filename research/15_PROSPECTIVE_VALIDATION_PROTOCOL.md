# Prospective validation protocol

**Status: designed, not executed.** No prospective cohort exists. Nothing in this
file is a result, and no claim anywhere in this repository rests on it. It is
written now because the design has to be fixed *before* the data exist, and
because "what would it take to establish independent biological superiority" is a
question with a concrete answer.

## 1. Why the retrospective work cannot settle this

Three distinct questions get conflated, and SplicR's evidence sits on the first
two only.

| Question | Evidence available | What it can support |
|---|---|---|
| Can a system rank hits before a screen is run? | AssayBench, 334 public test screens | Nothing: no method here beats the frontier ensemble by a margin that survives publication-clustered uncertainty, and the split is retrospectively explored |
| Does a ranking predict which hits **reproduce in another screen**? | The replication benchmark, 138 pairs | A ranking claim against screen A's own effect size, on a proxy for reproducibility |
| Does using SplicR cause a lab to **confirm more real hits per unit of validation effort**? | none | This is the commercial claim, and it needs this protocol |

The second is a proxy for the third, and the gap between them is not rhetorical:

* B's hit call is a threshold on B's statistic under B's significance criteria. A
  gene can fail to "replicate" because B's threshold was stricter.
* Both screens can share a confounder — copy number, guide sequence overlap,
  library composition — and agree for a non-biological reason.
* A gene both labs miss is invisible to the benchmark entirely.
* Cross-screen agreement says nothing about whether an arrayed single-gene
  experiment reproduces the phenotype.

## 2. The claim to be tested

> Among candidates from a pooled CRISPR-Cas9 knockout fitness screen in a human
> cell line, ranking by SplicR's evidence-informed reliability score yields more
> independently confirmed hits, at a fixed validation budget, than ranking by the
> screen's own effect size under the lab's standard analysis.

Primary endpoint: **confirmed candidates per fixed budget of k arrayed
validations**, k pre-specified per site (default 20).

Secondary: recovery of context-specific dependencies — confirmed candidates that
are *not* common essentials, which is where the commercial value is and where the
retrospective benchmark already shows the signal lives.

Deliberately out of scope for the first study: drug-modifier, host-pathogen and
reporter screens. A 2024 Genome Biology comparison of eight CRISPR-screen
correction methods found no single method dominant across tasks; a first claim
spanning assay types would be weaker, not stronger.

## 3. Design

**Within-screen paired, discordance-enriched, blinded.**

For each participating screen *S*:

1. The site runs its own standard analysis and produces a ranked candidate list
   **E** (effect size / MAGeCK / BAGEL2 — whatever they actually use, recorded).
2. SplicR, **frozen** before seeing *S*, produces ranked list **R** from the same
   counts. No refitting, no per-screen tuning, no human curation.
3. Validation set = the top *k* of each list. The **concordant** candidates
   (in both top-*k*) are validated too, but they carry no information about which
   ranking is better — only the **discordant** set does.
4. The site performs arrayed validation blind to which list proposed which
   candidate, using a pre-specified assay and success criterion.

Analysis is **McNemar on the discordant pairs**, with screens as the unit and a
cluster bootstrap over sites. Only R∖E and E∖R contribute, which is what makes
the study affordable: an equal-cost design that validated two full independent
top-20 lists would waste most of its budget on candidates both methods agree on.

**Why within-screen.** It removes between-lab, between-cell-line and
between-assay variance entirely. The comparison is two rankings of the same
measurements, validated by the same hands, in the same week.

## 4. What must be frozen, and how

Before any prospective screen is seen:

* the model, its weights, and the feature code, hashed;
* the background corpus snapshot, hashed;
* the ranking procedure end to end, runnable from a single entry point;
* *k*, the assay, the success criterion, and the analysis plan.

The freeze goes through the existing mechanism — `publish_evidence.py
--register-experiment` writes an exclusive-creation receipt with artifact
hashes — so that the frozen state is checkable afterwards by a third party. A
prospective claim registered after the outcomes are known is worth nothing, and
the receipt is what makes that auditable.

`research/evidence_contract.json` must not be moved to
`prospective_validation != null` until outcomes are in hand and independently
reviewed; the evidence gate enforces this and rejects a contract that claims
prospective evidence without it.

## 5. Sample size

The power calculation is driven by two quantities that the held-out replication
measurement estimates directly: the **discordance rate** between the two rankings
at *k*, and the **difference in confirmation rate within the discordant set**.
Both are computed in
`engine/analysis/replication_power.py` from the held-out per-unit results, so the
number of screens is derived from measurement rather than assumed.

Measured on the held-out replication set
(`research/artifacts/20260928/replication_verify/verification.json`):

| budget *k* | discordant candidates per screen | confirm, SplicR-only | confirm, comparator-only | excess confirmations per screen |
|---:|---:|---:|---:|---:|
| 10 | 6.6 | 0.898 | 0.585 | **+2.06** |
| 20 | 12.3 | 0.787 | 0.555 | +2.85 |
| 50 | 26.7 | 0.624 | 0.476 | +3.96 |

Read the *k* = 10 row as the commercial case: the two rankings disagree about
6.6 of the 10 candidates, and among exactly those, SplicR's picks reproduce at
90% against the comparator's 59%. Testing the union costs 16.6 validations
instead of 10 and returns about two more confirmed candidates per screen.

**Sizing.** With an excess of +2.06 per screen and the between-screen spread
observed here, a paired McNemar analysis clears conventional power at well under
ten screens *if the arrayed confirmation rates resemble the replication rates*.
They will not. Arrayed single-gene validation is a different assay with its own
failure modes, and the honest planning assumption is that the true excess is a
fraction of +2.06. The protocol therefore specifies **at least 8 screens across
3-5 sites**, powered for an excess of +0.75 per screen — roughly a third of the
retrospective effect — with an interim futility look after the first third.

Sizing from a proxy endpoint is the weakest step in this design and is labelled
as such. The interim look exists because of it.

## 6. What would falsify the claim

Stated now, so it cannot be renegotiated later:

* McNemar on discordance not favouring R at the pre-specified level;
* R winning only on candidates that are common essentials — that would mean the
  system recovers textbook biology rather than context-specific dependencies, and
  the secondary endpoint exists to detect exactly this;
* the advantage vanishing once the site's own analysis is used as E rather than a
  reconstructed effect size;
* the advantage existing only in cell lines heavily represented in the background
  corpus.

Each of these is a real possibility. The third is the one I would bet on being
the hardest, because the retrospective comparator is a reconstruction of what a
lab does, not the thing itself.

## 7. Partner requirements

The minimum viable study is **3–5 sites**, each contributing 1–3 genome-scale
knockout fitness screens with raw counts, and arrayed validation capacity for
~2·k candidates per screen.

What a partner gets: their screen analysed through the full pipeline with
provenance, the frozen ranking, and co-authorship. What they must accept:
blinding, and publication of the result whichever way it falls.

The single highest-value partner is a lab that is **neither Sanger nor Broad**
running a proliferation screen in a cell line those two already cover. That would
simultaneously serve this protocol and repair the retrospective benchmark's
biggest structural weakness — 113 of its 124 held-out pairs are one library
comparison, so its effective n for cross-library generalisation is near 1.

## 8. Honest accounting of what this would and would not prove

It would establish that, for pooled knockout fitness screens in human cell lines,
SplicR's ranking returns more confirmed candidates per unit of validation effort
than the site's own standard ranking, under blinded arrayed validation.

It would **not** establish: a calibrated probability that any individual gene
validates; transfer to drug-modifier, infection or reporter screens; superiority
over methods not tested; or that confirmation in an arrayed assay means the
dependency matters in vivo.
