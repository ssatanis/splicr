# Deployment checklist — evidence snapshot `20260928-post-screen-replication`

**Deployment is not authorized and has not been performed.** `https://www.splicr.org/`
still serves the previous build. This file is what a deployment would require,
and how to undo it.

## What changed in this release

| Area | Change |
|---|---|
| Publication contract | `20260928-research-addendum` → `20260928-post-screen-replication`, with each superseded snapshot's hashes retained under `previous_snapshot` |
| Public evidence | `summary.json` gains a `post_screen_replication` block (and retains `research_addendum`); the two published reports gain a dated section |
| Website | `/evidence` gains a "Which hits reproduce" section; the homepage states the measured precision@10 instead of a hedge |
| Registration | new `--register-replication` path and `validateReplicationExperiment`, separate from the pre-screen validator |
| Benchmark chart | **unchanged** — no pre-screen number moved |

## Pre-deployment gates

Every one of these must pass on the commit being deployed. None may be skipped
or weakened to obtain a green run.

```bash
npm run typecheck
npm run lint
npm run test:web                       # includes the evidence-addendum agreement tests
npm run evidence:generate              # must leave the tree clean
npm run evidence:check                 # must report snapshot 20260928-research-addendum
npm run build -w apps/web -- --webpack
PYTHONPATH=engine engine/.tools/env/bin/python -m pytest engine/tests -q
```

Then confirm the published evidence still derives from the artifacts:

```bash
git diff --exit-code apps/web/public/evidence   # regeneration must be a no-op
node scripts/research/evidence_gate.mjs --check-public
```

`apps/web/package.json` runs the gate as part of `build`, so a build cannot
succeed against unapproved evidence.

## Verification after deploying

1. `GET /evidence` returns 200 and contains "Later research results".
2. The two research rows show `0.180985` and `0.099450`, labelled `research only`.
2b. "Which hits reproduce" shows `0.3538` against `0.2464`, precision@10 `0.915` against `0.696`, with five published limitations.
2c. The homepage reads "nine of its top ten reproduced in an independent screen, against seven" — a web test pins that wording to the measured precision@10.
3. The benchmark table still shows `0.163091` for the published ensemble and
   `0.160369` for the SplicR research router.
4. All eight files under `/evidence/*` return 200 with non-zero length.
5. `GET /evidence/summary.json` — its `research_addendum.experiments` means match
   the two values above exactly.
6. No console errors on `/`, `/technology`, `/pipeline`, `/evidence`, `/about`,
   `/careers`, `/contact` at 390px, 768px and 1440px.

A successful `git push` is not evidence that any of this is true in production.
Check the live domain.

## Rollback

The release is a static content change plus one page section. To roll back:

1. `git revert <deploy commit>` and redeploy, **or** redeploy the previous
   deployment from the hosting dashboard.
2. Restore the previous contract if the working tree is being reset: the prior
   snapshot's identity and both public hashes are preserved verbatim in
   `research/evidence_contract.json` under `previous_snapshot`
   (each `previous_snapshot` carries its own `public_summary_sha256` and
   `public_manifest_sha256`, chained back to `20260927-retrospective-checkpoint`).
3. Re-run `npm run evidence:generate && npm run evidence:check` after any
   rollback; the gate is what proves the restored snapshot is internally
   consistent.

Rolling back removes a research disclosure. It does not change any model,
because no model was promoted in this release.

## What this release does not do

- It promotes no model. `model_promotion_status` remains `not_promoted`.
- It changes no public-test result.
- It claims no superiority: `claims.superiority_over_ensemble` is still `false`,
  and the gate rejects the contract if that flips without a reviewed replacement.
- It establishes no prospective or calibrated validation probability.
