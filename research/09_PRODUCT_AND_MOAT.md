# Product differentiation, validation feedback and laboratory utility

Date: 2026-09-27. This document distinguishes implemented foundations from proposed work. Scientific scores and tests belong to the benchmark and validation reports; nothing here implies a deployed feature exists because it is desirable.

## What laboratories can defensibly use now

The local engine provides count analysis, QC, MAGeCK/BAGEL evidence, guide/CN artifact flags and historical ORCS context. The scoped hits API, organization-aware overview and newly connected real screen-detail route provide pieces of a real workflow. Sample Hit Reports demonstrate evidence presentation and export mechanics. Calibrated validation probabilities, live workspace reports, upload workers, a complete Truth Loop and prospective adaptive validation remain incomplete.

The product's useful distinction is the ability to keep statistical effects, assay context, artifact evidence and historical support inspectable together. A ranking gain alone does not establish fewer failed validation experiments. That benefit must be measured against effect size/FDR and investigator-selected candidates under real budgets.

## Honest report contract

Every real report should bind to an immutable run, pipeline version, source file digests, library/build, reference release and model artifact. It should distinguish the following parallel facts:

| Evidence class | Display | Current foundation / remaining work |
|---|---|---|
| Observed measurements | Counts, replicate identities, guide LFCs | Engine data structures and count/QC results exist; workspace report adapter needed. |
| Statistical inference | Effect size, method-specific p/FDR/BF, comparison direction | RRA/BAGEL/DrugZ wrappers exist; valid directional semantics and method applicability require explicit gates. |
| Artifact risk | Specific guide/CN evidence, uncertainty and available controls | `Flag.evidence` exists; remove any inference that a warning proves false biology. |
| Historical evidence | Screen IDs, study, condition, measured denominator, original call type | Atlas local store exists; live report wiring needed. |
| Model prediction | Ranking, task definition, input contract, data cutoff, version | Track A research modules exist; deployment contract and external-prediction provenance needed. |
| Independent validation | Actual assay, result, effect, date, evidence, lab | SQL outcome and publication-record tables exist; complete entry/review workflow absent. |
| Validation probability | Precisely defined event and honest uncertainty | No fitted model; show unavailable or evidence categories. AnDCG, p-values and prior hit frequencies cannot fill this field. |
| Next experiment | Independent guides, rescue/orthogonal assay, specificity controls | Human-reviewable proposal; assay-specific recommendation engine not established. |

The current report builder uses sample versions and sample confidence bands; those values must never be copied into workspace records. Existing sample-watermark protections should be preserved.

## Blind laboratory evaluation protocol (proposed; not a claimed shipped workflow)

1. Define an assay-specific event before prediction: reproducible effect in the same direction, independent perturbations, specified independent assay, stated effect threshold and replicate criterion.
2. Lab deposits primary screen and metadata while a separate custodian retains validation outcomes. Record who has access; future outcomes must be excluded from retrieval/model training as well as direct input.
3. Freeze pipeline, references, candidate universe, comparison and selection budget. Archive all candidates and ranks with a digest and timestamp before reveal.
4. Compare fixed candidate batches from SplicR, primary effect/FDR baseline and investigator selection. Equalize assay budget and clarify overlap handling before execution.
5. Reveal outcomes only after the prediction artifact is sealed. Include failed, inconclusive and unperformed assays as distinct states; unperformed is not negative.
6. Report precision/success per budget, directional consistency, time/cost and failure burden. Bootstrap at independent laboratory/study level; repeated genes/replicates are not independent samples.
7. For adaptation, each new batch is frozen before its own outcomes exist. Fit/update only on previous revealed rounds. Report cumulative discoveries and regret relative to explicit deployable baselines; an omniscient comparator is labelled diagnostic.

A blinded retrospective screen can establish concealment of curated outcomes but still overlap public literature already seen by a model. A prospective unpublished experiment with timestamps is stronger. Existing public-test scores must remain labelled retrospective.

## Decision-aware candidate selection

Until validation probabilities are empirically supportable, use an explicit evidence utility rather than expected-success percentages. A proposed budget selector can combine within-screen evidence rank, novelty defined against a dated corpus, independent evidence count, uncertainty, assay feasibility and user priorities. Add declared costs and pathway/complex redundancy constraints; report each tradeoff and permit user overrides.

The existing shortlist/bench queue is UI behavior, not validation-budget optimization. Any new selector should be compared with top-FDR and random/diversity-aware selection on development data, then frozen. Pathway diversity is useful only when it serves the laboratory's objective; forcibly omitting several true complex members can be harmful. No claimed validated optimum is available today.

## Validation evidence network foundations

Current `validation_outcomes` stores gene, assay, effect, result, prediction/model version, evidence URL and `shared_with_atlas=false` by default. `atlas.validation_records` stores publication, quoted evidence, extraction method and review fields. Organization RLS and API scoping support separation. These are useful foundations, but they are not a fully governed training dataset.

Proposed additional records should capture assay specification/version, primary versus independent experiment relationship, guide sequence/library, cell identity/authentication, treatment/dose/time, direction, biological versus technical replicates, quantitative measurement uncertainty, selection reason, all candidates eligible for selection, lab/study grouping, embargo and outcome revision history. This supports diagnosis of preferential validation and missing-not-at-random reporting.

Consent must separately cover private analysis, sharing identifiable records, inclusion in cross-customer training, aggregate reporting and onward export. A single `shared_with_atlas` flag does not establish every permission. Default to private exclusion from model training. Record consent version/time, revocation and downstream artifact lineage. This is a design requirement, not a claim of deployed controls or legal certification.

Frozen model training manifests should list allowed source records and transformations, not customer secrets in public logs. A customer must be able to retrieve predictions made before an outcome, verify their inputs, and see whether their records entered a model. Aggregated statistics can disclose information about very small cohorts; access rules and minimum cohort reporting require explicit design.

## Why the public Atlas alone is not an exclusive data advantage

ORCS and other public sources remain owned/licensed by their providers. Integration quality, identifier resolution, provenance, release pinning, measured-background semantics and fast retrieval create utility. Exclusive claims about those public data are unjustified. Licenses also vary: unrestricted access is not unrestricted commercial redistribution. Existing `docs/04-data-sources.md` and source notices identify restrictions that require source-specific verification.

The potentially distinctive asset is a permitted collection of assay-defined independent outcomes, including negative and inconclusive evidence, linked to predictions made before reveal. Its value must come from improved calibration and decisions on laboratories excluded from training. Merely accumulating favorable reported hits or calling all public screens an answer key does not provide that evidence.

## Practical implementation priorities

| Priority | Concrete work | Completion criterion |
|---|---|---|
| 1 | Correct claims, strict count handling, direction/method gates, evidence-preserving artifact classification | Regression cases fail explicitly or retain correct statistics; marketing reflects actual capability. |
| 2 | Real screen detail/report adapter using session/RLS or scoped API | Workspace UUID opens real data; exported provenance comes from run; cross-org access tests pass. |
| 3 | Reproducible Track A inference with explicit candidate and metadata contracts | New experiment can be ranked without target labels or cached screen-specific outputs; prospective registry sealed. |
| 4 | Worker and upload execution | Controlled local/staging upload runs end to end; retries/idempotency and checksum verification tested. No production migration implied. |
| 5 | Outcome capture and blinded round artifacts | Prediction timestamps precede reveals; pending/inconclusive remain distinct; provenance and permissions auditable. |
| 6 | Calibration after adequate independent outcomes | Grouped/temporal external validation, Brier/log loss/reliability and interval coverage; honest abstention for unsupported contexts. |
| 7 | Adaptive budget optimization | Better discoveries per fixed budget on independent labs, accounting for assay cost and selection bias. |

Compute should remain outside serverless frontend functions. Keep large guide/ORCS/omics matrices as versioned compressed columnar files with hashes and a bounded cache; store job metadata and small indexed summaries in Postgres. Existing data-lake code already supports this direction. Never reclaim/delete source or production data to make room without a separately authorized operation.

## Commercial claims supported and unsupported

Supported in scope: reproducible local analysis, inspectable evidence, historical context infrastructure, scoped result retrieval, measured retrospective benchmark results when accurately qualified. Not yet supported: a calibrated percentage for any uploaded hit, reduced laboratory spend, universal applicability across modalities, private-model tuning, deployed MCP integration, state-of-the-art prospective biology or 100% accuracy. Independent pilot outcomes and clean prospective evaluation are the evidence required to expand those claims.

## Integration delivered in this research pass

Real screen-detail pages now expose the persisted experiment, run, analysis stages, paginated gene-level statistics, guide LFCs and named artifact evidence. All reads resolve the signed-in organization and apply RLS; failures and missing records cannot substitute demonstration data. Sample details require an explicit demo session. Existing recorded model values are labelled as recorded outputs, with model version where present; the page does not infer calibration from a stored number. Ten isolated application-boundary and server-rendering regression tests cover the loader. This completes the screen-detail portion of priority 2; authenticated report exports and live outcome capture remain outstanding.

Workspace-wide isolation now also connects real screen lists and recorded validation outcomes, while Atlas browsing, browser upload and planning show honest unavailable states for real sessions. Demo interfaces require explicit demo mode; missing accounts/workspaces cannot activate them implicitly. The repository's public-console redirect gate remains unchanged, and no production deployment or live database validation is claimed.

Sample report exports now also require an explicit demo session. Real authenticated sessions receive a truthful `workspace_report_unavailable` response until run-backed export is implemented; anonymous non-demo requests are rejected. Demo CSV/JSON/PDF watermarking remains verified by endpoint tests.
