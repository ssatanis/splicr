# Discovery implementation verification

Verified on October 5–6, 2026 against the local production build and the configured Supabase database.

## Delivered

The authenticated Discovery workspace connects recorded screen effects and guide support to structured genetic, drug, molecular, reference, partial-suppression and combination evidence. It creates explicit follow-up experiments, shows measured data and unresolved explanations, supports independent investigator nominations, and selects deterministic batches under declared assay costs.

Frozen batches contain the original evidence, source permissions, run/comparison, candidate universe, arm selections, missed sample, costs, endpoint definition and laboratory threshold. The canonical receipt is hashed with SHA-256. Blinded worksheets hide selection arms and ranking. Completed outcomes are immutable and recorded atomically in Discovery and Truth Loop. Yield remains separated by assay modality and excludes unscored or inconclusive results.

Four migrations, `20261006000100` through `20261006000400`, have been applied to the configured database. Migration status confirmed 59 applied migrations and no pending migrations at verification. The web application was built locally; a hosted web release was not deployed.

## Final checks

| Check | Result | Evidence |
| --- | --- | --- |
| Full web suite | 694 passed, 1 skipped, 0 failures | [web-tests.log](web-tests.log) |
| Engine suite, excluding network and slow markers | 713 passed, 2 skipped, 9 deselected | [engine-tests.log](engine-tests.log) |
| Discovery model/data tests | 16 passed; includes 1,000 seeded randomized budget scenarios | [discovery-tests.log](discovery-tests.log) |
| Real database integration | 1,827 checks; includes 1,800 endpoint verdicts against the Python oracle | [database-tests.log](database-tests.log) |
| Repeated browser workflow | 5 passed: authentication setup and two runs each of full workflow and editor regression | [browser-tests.log](browser-tests.log) |
| Production build and TypeScript compilation | Passed | [build.log](build.log) |
| Lint | 0 errors; 1 existing unused-import warning in `apps/web/test-kick.mjs` | [lint.log](lint.log) |
| Whitespace/error check | `git diff --check` passed | Executed after changes |

The browser workflow imports synthetic evidence, saves it, sets costs and investigator/missed selections, freezes a batch, downloads the blinded worksheet, independently recalculates the receipt hash, saves a scored result, reloads it, and verifies the added Truth Loop outcome. Both repeated runs reported no browser page errors. The editor regression verifies that temporarily empty required context values remain editable. Screenshot: [frozen-worklist.png](../frozen-worklist.png).

Database checks exercise viewer permissions, anonymous denial, outsider isolation, scope and current-run provenance, hash tampering, endpoint registry integrity, result forgery, immutable records, atomic rollback without orphan outcomes, consistency of direct API writes, and deletion of a parent screen. Database test fixtures roll back. Browser fixtures used a separately named synthetic account/workspace and were removed after verification. Fixture cleanup uses the Supabase Storage API rather than direct storage metadata deletion.

Additional regressions found during verification were repaired: the engine's misplaced future import, silent unknown/duplicate guide handling and malformed total footers, Screen Doctor severity mismatches, and live-progress typing/lifecycle issues.

## Scientific and operational limits

These results verify the exercised software contracts; they cannot establish perfection or biological discovery performance. Skipped/deselected tests were not counted as passing. Network/slow engine tests and the full live accession/Modal suite were not run.

No prospective laboratory experiment was performed, no Validation Network head was fitted, and no organoid superiority was established. Context summaries are strictly matched descriptive comparisons. GR requires actual cell-count measurements; Bliss excess is descriptive and does not prove synthetic lethality. The worklist selector is a transparent heuristic rather than a validated acquisition policy.

Licensed automated reference ingestion, a held-out context/biomarker predictor, sparse-library copy-number correction, learned adaptive selection and prospective blinded laboratory comparison remain separate work. The current workflow accepts consented laboratory inputs and source rights attestations; those attestations are not independent license verification.

Implementation contract, scientific sources and operating instructions: [docs/13-discovery-worklists.md](../../../docs/13-discovery-worklists.md).

