# Making SplicR improve biological decisions

Research date: 2026-10-05. This is a proposed research and product plan, not a new performance result. It combines primary literature with inspection of SplicR's current implementation and recorded experiments. No new model was trained, biological experiment performed, or sales message sent.

## Recommendation

Concentrate on patient-derived organoid target and combination discovery. Build a system that chooses the next target–perturbation–model–dose experiment using the lab's counts, molecular profiles, drug assays, and comparable reference experiments. Evaluate the result as additional independently confirmed, context-specific vulnerabilities per fixed validation budget.

The plausible advantage over an excellent lab is learning from independent outcome-rich experiments across laboratories, integrating evidence quantitatively, and allocating a limited experimental budget better. A large collection of published hit lists, a better interface, or another generic gene ranking does not establish that advantage. Even a successful product will not guarantee discoveries or remove every buyer's hesitation.

## What already exists

| Capability | Current evidence/status | Consequence |
|---|---|---|
| MAGeCK RRA/MLE, DrugZ, BAGEL2, QC, Atlas | Working analysis and contextual annotation | Maintain these as the baseline. Merely adding another caller is not a discovery moat. |
| Guide disagreement and leave-one-guide-out sensitivity | Implemented | Extend measured perturbation evidence; do not rebuild this feature under a new name. |
| Copy-number/proximity warnings | Implemented annotations; private-screen worker explicitly rejects requested Chronos/CN correction | A real correction path is an implementation gap, although correction tools are already public. |
| Baseline molecular dependency predictor | Research model; selective-gene median Pearson r 0.279 on random model splits, 0.223 on held-out lineages | An initial comparator, not an established organoid predictor. Global r 0.916 is misleading as a selling point because the gene-mean baseline reaches 0.911. |
| Guide weighting from Rule Set 3/Lindel | Tested on 100 Avana screens; worsened median essential/nonessential separation and AUROC | Do not promote the tested weighting schemes. The experiment does not disprove every future model using measured guide efficacy. |
| Escape | Paralog hypotheses implemented; other mechanism families named, unimplemented | Pair hypotheses need real combination outcomes and appropriate controls. |
| Validation Network | Built and wired, unfitted; four outcome questions and frozen receipts | Outcome collection is a core research task, not optional paperwork. |
| Historical replication ranking | Retrospective cross-screen proxy with a weak comparator and concentrated study coverage | Does not establish better pharmacology, organoid discovery, or superiority over expert selection. |
| Prescreen ranking research | New router/ranking approaches did not establish superiority | Do not treat an architecture upgrade as evidence of benefit. |

References: [final recorded results](../../research/10_FINAL_RESULTS.md), [dependency model](../../research/17_DEPENDENCY_MODEL.md), [guide experiments](../../research/18_BIOPHYSICAL_VALIDATION.md), [Validation Network](../../research/19_VALIDATION_NETWORK.md), [Escape](../../docs/12-escape-and-deep-dive.md), [replication limitations](../../docs/07-replication-benchmark.md).

A read-only local DuckDB check found that all 1,140 eligible models in the current dependency-model cohort are labelled `Cell Line`; 51 breast models are labelled adherent, suspension, or mixed. This is a metadata audit, not proof of the biological origin of every model. The loader does not currently train a model conditioned on organoid culture format or medium. Some new data are included in public releases beginning 26Q1, so inventory actual model IDs and conditions before claiming that every model in a new manuscript is missing.

## Investment 1: context-specific effect and biomarker ranking

Replace a flat frequent-hit interpretation with an explicit question: is this effect stronger in the customer's biological context than in appropriate references, and what predicts that difference?

Inputs should include guide counts and controls; model/patient identity; assay modality and endpoint; treatment; time and population doublings; library; RNA expression/programs; mutation and copy number; culture format, medium, matrix, and passage. Optional inputs must remain optional, with missingness and uncertainty preserved.

Use comparable continuous reference measurements where available. Keep ORCS author hit calls in a separate evidence channel; their heterogeneous statistics cannot be pooled into a universal effect scale. Audit overlapping HCMI models, repeated patient samples, shared guides, and source reuse. Model IDs alone are not independent biological samples.

Start with a regularized hierarchical model and a simple nearest-neighbour/linear comparator. Predict dependency distributions from context, then combine their uncertainty with independently estimated local effects to prioritize experiments. Report both the observed local effect and the reference expectation. Do not turn an unexpected residual into a new screen p-value without a validated sampling model. Prior disagreement can indicate novel biology or an inadequate reference; it is not automatic evidence against a hit.

Discover candidate effect modifiers with predeclared tests: target expression, paralog loss/expression, selected mutation/CN features, and transcriptional programs. Adjust for lineage, library, culture, and study where identifiable. Apply multiplicity correction and require held-out prediction/replication. Do not infer causal biomarkers from observational association. Two organoid lines alone cannot establish a broadly useful biomarker.

Two August 2026 resources make this feasible: [Broad NextGen](https://www.nature.com/articles/s41586-026-10843-7) reports 147 genome-scale screens plus molecular profiles and culture annotations; [Sanger organoid biobank](https://www.nature.com/articles/s41586-026-10830-y) reports 162 screened organoids, predominantly gastrointestinal. Neither is a ready-made breast-organoid gold standard. Broad's targeted paired-culture experiments found dependency changes involving PTK2, integrins, and metabolic genes. This supports treating culture as explanatory context, not proof that culture explains Dow's PTK2 result.

Deliverable: a ranked candidate table with measured effect, matched reference support, candidate biomarker, uncertainty, independent evidence, and a proposed confirming experiment. Preserve candidates outside the known biology distribution in an exploration allocation so reference priors do not erase discoveries.

## Investment 2: genetic–pharmacologic integration and false-negative investigation

The candidate should be a gene plus a perturbation and context, not just a gene. Full knockout, partial suppression, catalytic inhibition, and degradation test different biology.

[Krill-Burger et al. 2023](https://link.springer.com/article/10.1186/s13059-023-03020-w) compared approximately 400 matched models and found selective RNAi patterns for about half of CRISPR pan-lethal genes. PRMT5/MTAP is an example; ATR also appears among knockout pan-dependencies with selective RNAi suppression. This supports investigating partial inhibition, not assuming every frequent hitter has a therapeutic window. RNAi has off-target liabilities; use normalized references and orthogonal confirmation.

Integrate CRISPR counts, RNAi/CRISPRi references, lab drug dose-response/combination matrices, compound target/selectivity evidence, and measured target engagement/protein loss. Drug phenotype similarity is supporting evidence, not binding or on-target proof. [DeepTarget 2025](https://www.nature.com/articles/s41698-025-01111-4) already integrates genetic and drug profiles with experimental case studies; evaluate or adapt public methods rather than claiming the concept is unique.

For each candidate, distinguish:

1. Reliable genetic depletion and pharmacologic agreement: advance an on-target confirmation.
2. Genetic depletion but no compound effect: test engagement, effective dose, and catalytic versus scaffolding dependence.
3. Drug effect but no genetic depletion: inspect assay power, target expression, measured knockout/protein loss, and off-target explanations.
4. Weak single perturbations with pair evidence: nominate a controlled combination test.

Represent both amplification-associated cutting toxicity and incomplete disruption of amplified genes. They are different mechanisms and can push inference in different directions. Genotype-aware guide matching is supported by [Misek et al. 2024](https://www.nature.com/articles/s41467-024-48957-z), which found target-site variants can reduce cutting. A known variant is useful evidence; predicted repair or high copy number alone does not prove failed knockout.

Luke-specific retrospective examples are FGFR1 in 007 and PTK2/PRKDC genetic–drug discrepancies. [Dow's paper](https://doi.org/10.1158/0008-5472.CAN-24-0775) already discussed and investigated these issues. Use them as engineering checks; recovering them after reading the paper is not a new discovery. The prospective value would be identifying a different unresolved candidate and selecting a discriminating experiment before its outcome is known.

Drug interaction inference should remain separate from baseline essentiality. DrugZ is already an appropriate strong baseline. Its [original paper](https://link.springer.com/article/10.1186/s13073-019-0665-3) discusses timing, dose, and masking by depleted guides. If multiple timepoints/doses are available, evaluate a jointly fitted guide-count model with treatment × gene terms and replicate/batch effects, plus abundance-dependent dispersion and floor/censoring sensitivity. Insufficient endpoint counts should trigger an inconclusive result, not a rescued hit call.

For drug assays, support [growth-rate-aware response metrics](https://pmc.ncbi.nlm.nih.gov/articles/PMC4887336/) when valid baseline/end-point cell measurements are available. Do not derive population growth from sequencing depth or treat ATP luminescence as exact cell counts without validation. Predefine synergy null models and include single-agent curves, replication, and biologically meaningful effect sizes.

Deliverable: an evidence-based target–compound–dose–model shortlist, plus an unresolved-candidate queue. Four separate validation endpoints already exist in SplicR; extend the feature/data layer and outcome collection rather than inventing another opaque confidence score.

## Investment 3: selecting experiments and finding combinations

Expand Escape into experimentally testable pair and resistance hypotheses, starting with paralogs where independent evidence is strongest. [Harle et al. 2025](https://link.springer.com/article/10.1186/s13059-025-03737-w) screened 472 nominated pairs in 27 models and reported 117 hit pairs. Outcomes varied substantially by context. Shared pathway membership and coessentiality alone are not synthetic-lethality proof.

Generate pairs using measured expression/loss of a partner, independent pair screens, local drug-modifier evidence, and suitable reagent availability. Rank separately for likely interaction, informative uncertainty, and experimental cost. Controls must include each single perturbation, nontargeting and matched cutting controls, multiple independent constructs, and measured perturbation efficiency. Fit an interaction relative to the appropriate single-perturbation expectation; double depletion alone is not synergy.

Select a small diverse batch each round. Some experiments should test likely winners; others should distinguish knockout failure from compensation or assay failure. Keep an explicit exploration allocation. Until utility models are fitted, call this a heuristic worklist, not quantified information gain or a calibrated optimum.

[AssayBench-Loop/AssayLoop, September 2026 preprint](https://arxiv.org/abs/2609.11877) provides a useful adaptive-design comparator on historical screens. It does not establish prospective benefit in Luke's organoids. Evaluate on candidate confirmation and discovery under real costs, not enrichment versus random selection alone.

## Supporting measurement improvements

Implement a compatible CN/proximity correction route and compare alternatives. [Vinceti et al. 2024](https://link.springer.com/article/10.1186/s13059-024-03336-1) found AC-Chronos strong with multi-screen/CN data and CRISPRcleanR strong for individual/no-CN screens. Those results primarily concern genome-scale data. A sparse kinase library cannot necessarily support genomic segment inference or de novo guide-efficacy estimation. Correction must preserve genuine amplified oncogene addictions and be shown as a separate measured analysis.

Benchmark learned guide-efficacy sharing only where libraries and guide sequences match, with genotype-specific exceptions. [JACKS](https://genome.cshlp.org/content/29/3/464) is a public comparator. Sharing can improve precision but imposes assumptions; it cannot make an inactive guide informative in a novel context.

For bottlenecked organoid screens, evaluate count asymmetry using [gscreend](https://pmc.ncbi.nlm.nih.gov/articles/PMC7052974/). If future libraries carry clone barcodes, support clone-level analysis: [CRISPR-UMI](https://www.nature.com/articles/nmeth.4466) and [Michels et al. organoid screens](https://pubmed.ncbi.nlm.nih.gov/32348727/) show why clonal drift matters. Ordinary guide counts cannot reconstruct missing lineage barcodes or distinguish every clonal effect.

These are necessary measurement capabilities for some experiments, but public algorithms alone are unlikely to justify a discovery superiority claim.

## Proof that would make purchasing rational

Run two separate studies: fixed-budget post-screen prioritization, then adaptive experiment selection. Otherwise better chemistry, more assays, and better ranking become impossible to disentangle.

For the first, obtain a lab's complete frozen expert ranking using all information it normally has, including MAGeCK/DrugZ, molecular data, literature, and manual review. Give SplicR the same allowed inputs. Use additional external references as a declared part of the product and include a reference-only comparator. Freeze predictions before outcomes. Validate the union of both top-k sets, treating overlapping candidates once and charging actual assay costs. Validate a prespecified sample of lower-ranked and initially missed candidates to measure missed hits and reduce verification bias.

Use target-specific confirmation, meaningful effect size, and the declared context-specific/drug endpoint. Keep failed perturbations, missing results, and true assay negatives distinct. A viability reduction is not necessarily on-target and cancer selectivity is not a measured normal-tissue therapeutic window. Follow up new biomarkers in independent models or isogenic perturbations.

Primary metric: independently confirmed context-specific candidates per fixed bench budget. Report per-study differences and uncertainty clustered by patient/model, study, and lab as appropriate. Different candidates in two ranked lists are not automatically valid matched binary pairs for a McNemar test. Have the statistical design reviewed before enrollment. Do not inherit sample-size power from historical cross-screen replication rates; estimate discordance and outcome variance with a feasibility cohort, then size a confirmatory study.

For the adaptive study, compare with an investigator-selected sequence, a fixed ranking, and established acquisition baselines under equal total costs. Measure validated discoveries after each budget/round. Success on ranking alone does not prove selecting experiments is better.

Evaluate on held-out labs, time, model/patient groups, and genuinely novel conditions. Fit feature selection, model tuning, and calibration within training data. The current dependency-model feature selection uses all eligible models before fold splitting; move that inside training folds for a stricter prospective benchmark. Audit public/pretraining exposure and duplicated models. Public-paper replay is useful for regression checking, not blind discovery evidence.

A possible commercial target is several additional confirmed useful candidates within the same 20-experiment budget. That is a proposed success criterion to agree with partners, not an expected result. Set the threshold from lab value and assay cost. A null or negative trial is a reason to stop/promote a narrower capability, not change the endpoint afterward.

## Build sequence and stopping rules

1. **Evidence and input contract:** fix run/provenance consistency; identify actual reference model coverage; define target/combination endpoints with a partner; extend imports for molecular profiles, engagement, and drug matrices. Resolve data rights for proposed commercial use.
2. **Context and pharmacology prototype:** implement simple interpretable comparators, condition-aware continuous reference evidence, separate observed/predicted effects, and unresolved-candidate worklists. Do not ship invented validation percentages.
3. **Blind retrospective development:** leave studies and models out; benchmark against public methods and expert-equivalent baselines. Use Dow only as a known-answer integration check. Advance only if relevant holdouts improve without loss of rare-context recall.
4. **Prospective feasibility:** collect both successes and failures, assess endpoint practicality and assay cost, and size the confirmation study. The existing Validation Network can record these outcomes.
5. **Confirmatory pilot:** freeze and compare against the complete lab workflow. Release biological-superiority claims only for the population and endpoints demonstrated.
6. **Adaptive pairs/resistance extension:** begin after real outcome coverage supports it. Train and evaluate separate modalities/endpoints; do not reuse a genetic-confirmation model as a pharmacologic-success model.

The first prototype can be bounded as a software project; the time to a credible biological claim depends on partners, assay throughput, and effect size. A calendar promise would be premature.

Commercial reference access is a real dependency: [Sanger's current data policy](https://depmap.sanger.ac.uk/documentation/data-usage-policy/) restricts incorporation/resale and commercial services without appropriate permission. Public accessibility does not establish product rights. Audit the specific files/releases and Broad terms separately; this review did not establish SplicR's existing agreements.

## What to avoid

Do not pitch pan-essential flags as discoveries, lower FDR thresholds as improved accuracy, model confidence as proof, or more published screens as independent validation. Do not recommend the exact guide weighting schemes already shown to underperform. Do not build a giant virtual-cell model first: [2025 perturbation benchmarks](https://www.nature.com/articles/s41592-025-02772-6) and an [October 2026 metric-calibration study](https://www.nature.com/articles/s41587-026-03307-w) show that model conclusions depend on the task and evaluation. Both concern transcriptomic perturbation prediction, not direct evidence of SplicR's fitness-ranking performance.

The durable differentiation, if earned, is a consented, assay-specific dataset of independent validation outcomes, useful context modeling, and demonstrated experimental yield. Public data, an LLM explanation, or an architecture diagram alone cannot supply it.
