# Website and project consistency update

Date: 2026-09-28 UTC (2026-09-27 local). Follow-up to the research checkpoint in [10 Final results](10_FINAL_RESULTS.md). Biological measurements are unchanged.

## Implemented changes

- Homepage, Technology, Pipeline, About, Contact, Careers, metadata and footer now distinguish measured evidence, local analysis and unavailable workspace workflows.
- Removed the homepage's invented ferroptosis candidate statistics and validation percentages. It now displays the actual CHD1L processed-count audit, including nonsignificance, native/two-family FDR and QC failure.
- Added `/evidence` with full-precision benchmark values, paired uncertainty, actual count agreement, interpretation and downloadable source-backed reports.
- Homepage and benchmark values read a shared JSON snapshot generated from research artifacts. `scripts/research/publish_evidence.py --check` detects stale downloads; checksums connect the public summary to source files.
- New research router 0.160369 versus published ensemble 0.163091 is stated as no demonstrated improvement. Archived known-library comparisons stay available with their distinct input contract.
- Removed unsupported automatic retraining, uniform Atlas reanalysis, calibration and operational availability claims. The contact form opens an encoded email draft and never claims delivery. Careers lists areas of interest without unverified vacancies, pay or hiring promises.
- Dashboard values and exports label recorded model scores as uncalibrated. No ±0.06 interval is invented. Demo report construction refuses workspace provenance; demonstration methods and outcomes remain explicitly illustrative.
- REST hits output preserves finite recorded numeric precision, including tiny nonzero p-values/FDRs, and unknown copy-number correction. Stored score bounds are explicitly uncalibrated; validation probability remains null. This cannot restore precision already lost upstream.
- Updated README and architecture, pipeline, data model, source, engine and benchmark documentation. Historical experiments and original data are preserved.

## Verification

- **56 frontend tests passed**, zero failures or skips. Tests exercise actual source/serializers with isolated adapters; they are not a live database security audit.
- TypeScript, full ESLint and webpack production build passed.
- Browser: Chrome 154.0.8037.57 via agent-browser 0.38.1. All seven public pages loaded at 390×844 with meaningful headings/content, no horizontal page overflow and no framework error overlays. No browser errors were recorded. Desktop homepage and Evidence navigation/values were also checked.
- Evidence JSON and downloadable files matched source hashes. Contact URL encoding was exercised without sending email.
- The earlier **197 passing Python tests** remain the analysis-engine checkpoint; this follow-up changes website/documentation and environment comments, not the engine's scientific runtime.

Machine-readable follow-up checks: `artifacts/website_verification.json`, `artifacts/website_browser_verification.json`, `artifacts/website_http_verification.json`, and `artifacts/website_source_manifest.json`. Original checkpoint logs remain unchanged.

## Reproduction

From the repository root:

```sh
npm run evidence:generate
npm run evidence:check
npm run test:web
npm run typecheck
npm run lint
npm run build -w apps/web -- --webpack
npm run start -w apps/web -- --hostname 127.0.0.1 --port 3100
```

Inspect `/`, `/technology`, `/pipeline`, `/evidence`, `/about`, `/careers`, and `/contact`. Public downloads are a subset of the research directory; referenced scripts/data remain part of the full repository. The public snapshot generation deliberately fails if source artifacts are missing instead of substituting example data.

## Boundaries

The public-console disable gate is preserved. Connected uploads, workspace CSV/PDF reports, complete outcome entry, independent calibration, and prospective biological validation remain incomplete. No database migration, production data modification or live tenant test was performed. Browser checks used the local production build. A Git push is distinct from confirming successful deployment on the public domain; deployment status must be checked separately.
