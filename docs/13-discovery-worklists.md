# Discovery worklists

The authenticated **Discovery** workspace connects recorded screen results to an explicit target–perturbation–model–dose worklist. It is an evidence-based heuristic, not a fitted prediction of validation, an optimized information-gain policy, a biomarker discovery model, or evidence of biological superiority.

## Using the workflow

1. Open **Discovery** from the sidebar or **Plan discovery experiments** from a screen. Select one completed run's comparison.
2. Record the model and independent patient/biological-unit identity. Download the JSON input template, add evidence, and upload it. Save the evidence snapshot before freezing a worklist.
3. Review measured genetic effects, guide support, artifact warnings, drug measurements, descriptive reference differences, molecular annotations, partial-suppression evidence and pair hypotheses.
4. Set actual assay costs and the selection budget. Choose investigator experiments in rank order from the lab's complete workflow; use `nominations` to include targets outside the automated depletion cutoff. Prespecify a missed-candidate sample outside both selected lists.
5. Choose an endpoint and the laboratory's effect threshold before outcomes are available. Freeze the batch. Download the blinded bench worksheet and the complete SHA-256 evidence receipt.
6. Run the union of selected experiments once, plus the missed sample. Record completed measurements, controls, actual cost, successes, failures and inconclusive results. A result with missing endpoint criteria is unscored, not failed. Results are also recorded atomically in Truth Loop.

Each strategy has the same *selection* budget. Running the union and missed sample can cost more than either strategy's budget; the UI shows that total before freezing. Shared experiments are paid for once in the union and credited to both strategies. This is not a claim that the entire union was performed under a single strategy's budget. Incomplete, inconclusive and reported-only results cannot enter the confirmed numerator or decided denominator.

The receipt freezes the evidence snapshot, model, run, comparison, proposed candidate universe, investigator choices, missed sample, costs, endpoint definition, laboratory threshold, method version and cryptographic blind identifiers. Only eligibility rules stated below generate automatic proposals; this universe is not every possible experiment or an exhaustive false-negative cohort. Explicit laboratory nominations permit additional hypotheses.

## JSON input contract

`version` is `1`. Unknown fields and wrong numeric types are refused, rather than coerced into measurements. Empty optional evidence arrays are permitted. Optional measurements use `null`, which differs from zero or false. Imports are capped at 1.5 MB; scoped reference cohorts, rather than entire pan-cancer tables, should be supplied.

| Field | Meaning |
| --- | --- |
| `context` | Model ID; independent biological unit (use the same patient ID for related models); lineage/subtype; culture; medium; matrix; library; perturbation modality; endpoint; duration in hours; effect metric. |
| `sources` | Unique ID, citation, `usage` (`laboratory_owned`, `commercial_permission`, or `licensed_commercial`), and rights statement. These are laboratory attestations, not independently verified licenses. |
| `molecular` | Gene and source; optional expression plus unit, mutation, copy number, paralog/state, pan-essential status and measured protein-loss fraction. Measurements refer to the local model. |
| `drugs` | Unique assay ID, gene/source/model, compound/mechanism, measured dose in µM, duration, relative viability, biological replicates, engagement and selectivity (`yes`, `no`, `unknown`). Optional actual initial/control/treated cell numbers permit a GR calculation. |
| `references` | Unique measurement ID, gene/source/study, full reference context and continuous effect. Author-reported heterogeneous hit statistics are not accepted as a common effect scale. |
| `partial_suppression` | Unique ID, gene/source, full reference context with RNAi/CRISPRi modality, reported selective-dependency flag and orthogonal-confirmation annotation. |
| `pairs` | Unique ID, gene/partner/source, model/biological unit, evidence class (`independent_pair_screen`, `local_drug_sensitization`, `paralog_loss`), reagent availability and notes. |
| `combination_assays` | Unique ID, gene/partner/source/model/biological unit, compounds and both doses, time, each single-agent viability and combination viability, biological replicates and matched-control flag. A flattened matrix has one record per dose pair and timepoint. |
| `nominations` | Unique ID, gene/source, assay (`orthogonal_confirmation`, `partial_suppression`, `pharmacologic_confirmation`), rationale and optional compound/dose/time. Pharmacologic nominations require all three reagent fields. |
| `thresholds` | Prespecified descriptive eligibility criteria: FDR, depletion LFC magnitude, drug viability threshold and minimum biological drug replicates. Defaults: 0.1, 0.5, 0.5 and 3. These thresholds are not new statistics or validated therapeutic criteria. |

The screen's recorded model identity must match the input when available. Local observed effects use recorded `lfc` and `fdr`; no screen statistic is recalculated. The current comparison classification conservatively treats `treatment_vs_control` as a drug-modifier contrast, not baseline essentiality. Other modalities unsupported by the baseline-depletion rules are named as such. Reference effects in other units can be stored but cannot be pooled with local LFCs.

## Scientific rules and limits

Automatic baseline depletion requires recorded negative LFC beyond the declared magnitude and FDR below the declared bar in a baseline knockout/CRISPRi/RNAi LFC assay. Reliable support additionally requires at least two negative guide effects and no named single-guide, coverage, bottleneck, low-representation or copy-number-cluster flag. Missing support is a reason to check, not evidence of a true negative.

Adequately replicated drug measurements are interpreted separately at each compound, dose and timepoint. Conflicting repeated measurements remain unresolved. Agreement nominates independent genetic and pharmacologic confirmation. Genetic depletion with an inactive inhibitor nominates engagement/function tests. Drug activity without supported depletion nominates perturbation and alternative-target checks. Compound selectivity and engagement remain visible; activity alone never establishes on-target action. The displayed viability threshold does not estimate an IC50 or therapeutic window.

Pan-essential knockout annotations do not reduce priority. Context-related selective partial-suppression reports nominate titration and independent-model tests; they do not establish selectivity in the local organoid. Copy-number annotations distinguish possible cutting toxicity from incomplete disruption. They do not perform CN correction.

Reference matching requires identical lineage, culture, medium, matrix, library, perturbation modality, endpoint, time and effect metric, plus subtype when specified locally. The local model and biological unit are excluded. Multiple measurements/models belonging to one biological unit are averaged and count once. The output is a descriptive mean, between-unit spread when at least three units exist, and the local-minus-reference difference. No new p-value, causal biomarker, confidence interval or organoid-superiority claim is produced. Model alias and patient-identity quality still depend on supplied identifiers. A broader learned reference predictor needs independent evaluation.

GR uses `2^(log2(treated/initial)/log2(control/initial)) - 1`. Missing measurements or absent positive control growth make GR unavailable. Actual cell numbers are required; sequencing depth or unvalidated ATP values must not be substituted.

Bliss excess uses `singleA * singleB - combination` for fractional viabilities. It is displayed only for matched-control assays meeting the replicate floor. A positive excess is descriptive, not significance or proven synthetic lethality. Drug pairs remain separate from genetic pair screens. Pair hypotheses require controls for both singles, matched controls, independent constructs/replicates, measured perturbation success and an appropriate prespecified interaction null. Synthetic-lethality/engagement endpoints are not invented: incompatible experiments are reported-only until a validated endpoint registry entry exists.

The selector allocates a declared exploration reserve, then confirmation work, with a diverse first pass across targets. Unspendable exploration capacity is disclosed and reused. All costs must be positive and both selected lists must fit the same budget. This deterministic heuristic has no fitted utility model and makes no optimality claim.

Results use the existing engine-generated endpoint registry, not a separate interpretation of “validated.” Database criteria are replayed against the Python oracle. One endpoint is frozen per batch; create distinct batches for incompatible genetic, pharmacologic or other modalities. Missing criteria override failures, so unknown independence or controls cannot become a counted confirmation. Results and their linked Truth Loop measurements are immutable; unfinished assays remain outstanding. New independent assays are new batches. Authorized deletion of an entire screen removes both representations through the parent cascade.

## Persistence and authorization

`discovery_inputs`, `discovery_batches` and `discovery_results` have RLS, explicit role grants and database scope/immutability triggers. Viewers can read their workspace; members can insert evidence, batches and outcomes. Anonymous and cross-workspace access is refused. Inserts validate current completed-run provenance and comparison ownership. Database-generated timestamps prevent backdating. The canonical JSON is stored alongside its SHA-256 hash and checked against the JSON record. Endpoint definitions are checked against the synchronized registry. Rejected result writes roll back both the discovery and Truth Loop records. Private inputs are not exported into Atlas or shared training cohorts by this workflow.

Migrations `20261006000100`–`20261006000400` create the feature, synchronize the initial registry's placeholder hashes with the engine definitions, and protect consistency of linked outcomes, including direct Data API writes. The synchronization refuses to change scoring criteria under an existing endpoint version. It only pins correct hashes and descriptive metadata after that check.

## Evidence basis

The rationale is supported by primary research, not a measured SplicR discovery improvement:

- [Krill-Burger et al. (2023)](https://link.springer.com/article/10.1186/s13059-023-03020-w): knockout pan-essentiality and selective partial suppression differ; neither establishes a therapeutic window for a nominated target.
- [DeepTarget (2025)](https://www.nature.com/articles/s41698-025-01111-4): genetic, pharmacologic and molecular integration is an existing method family to compare against.
- [Harle et al. (2025)](https://link.springer.com/article/10.1186/s13059-025-03737-w): pair interactions depend on biological context; pathway relationships alone are inadequate proof.
- [DrugZ](https://link.springer.com/article/10.1186/s13073-019-0665-3): genetic drug-modifier contrasts have their own interpretation and depletion-floor limitations.
- [Broad NextGen (2026)](https://www.nature.com/articles/s41586-026-10843-7) and [Sanger organoids (2026)](https://doi.org/10.1038/s41586-026-10830-y): culture-aware reference resources, subject to cohort coverage and actual access rights.
- [Sanger usage policy](https://depmap.sanger.ac.uk/documentation/data-usage-policy/): public availability does not confer rights to incorporate datasets into a commercial service. This change does not import Sanger data.
- [Vinceti et al. (2024)](https://link.springer.com/article/10.1186/s13059-024-03336-1): CN correction must be validated for the available screen design. No sparse-library CN-correction performance is claimed here.
- [AssayLoop preprint (2026)](https://arxiv.org/abs/2609.11877): an adaptive-selection comparator, not evidence that this heuristic improves prospective organoid discovery.

## Verification

Commands:

```sh
node --test apps/web/tests/discovery.test.mjs
node scripts/validation/test_discovery_database.mjs
npm run test:web
npm run test:engine
npm run typecheck
npm run lint
npm run build
# From apps/web, with the production build and configured disposable fixture:
SPLICR_E2E_NAMESPACE=discovery SPLICR_E2E_PORT=3225 npx playwright test --project=fast e2e/fast/discovery.spec.ts --repeat-each=2
```

The rule tests include 1,000 seeded randomized budgets; context, identity and assay-scale exclusions; conflicts and missing measurements; pan-essential handling; partial evidence and nominations; combinations, GR and Bliss; receipts, blinded export and overlapping-arm accounting. The database suite rolls back synthetic data and checks 1,800 Python-oracle endpoint decisions plus actual RLS, scope, stale-run, integrity, immutability and atomic-outcome behavior. Browser tests use synthetic disposable workspace data; they cannot establish scientific performance.

The final verification counts, exclusions and logs are recorded in [the verification report](../artifacts/discovery-20261005/verification/README.md).

## Work that still requires separate research or laboratory work

No neural model or Validation Network head is trained by this change. No prospective experiment was performed. Automatic licensing and ingestion of organoid reference releases, a held-out hierarchical dependency/biomarker predictor, compatible sparse-library CN correction, learned adaptive acquisition, validated combination/synthetic-lethality endpoints, prospective power analysis and a blinded lab comparison remain necessary to earn the original biological superiority claim. Software verification cannot substitute for those studies. A deployed web release is also distinct from a local production build and database migration.
