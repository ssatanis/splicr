# Website verification — 2026-09-28

No deployment, messages, or production data changes were performed. This is a local build and filesystem audit. **Current browser verification is blocked**, not passed.

## Executed

- Standard production build: evidence gate passed; Next.js 16.3.6 Turbopack failed when its CSS processing subprocess attempted a prohibited port bind (`Operation not permitted`, OS error 1). See `standard_build.log`.
- Production build with `--webpack`: passed, including evidence gate, compilation, TypeScript and page generation. See `webpack_build.log`.
- Local production server on 127.0.0.1:3100: failed with `listen EPERM`. See `local_server.log`.
- In-app browser: bootstrap returned `No browser is available`; one availability check returned `[]`.
- Standalone agent-browser with a new writable temporary profile: failed because its socket directory `/Users/sahaj/.agent-browser` is not writable. See `browser_launch.log`. No approval bypass or alternate home directory was used.
- Generated HTML for all seven public routes: each has one H1, a title, description and viewport metadata. Internal links and local fragments resolve in the generated files. See `static_checks.json`. File existence does not establish HTTP status.
- All seven downloadable evidence documents/JSON files named by the manifest match their SHA-256 hashes.
- Seven contact/evidence unit tests pass. The contact test verifies an encoded email draft and no false delivery acknowledgment using a mocked window; no email was sent. See `contact_and_evidence_tests.log`.

## Actionable findings

1. All seven pages lack canonical URLs and `og:url`. Their Open Graph title and description are inherited site-wide, rather than describing the individual route. This is a metadata improvement opportunity, not a scientific result or a runtime failure. No source changes were made in this audit.
2. Default Turbopack build is incompatible with this sandbox's port restrictions. The existing webpack option succeeds. This result does not establish a build failure on normal hosting infrastructure.
3. Complete browser verification remains necessary in an environment that permits a server and browser: `/`, `/technology`, `/pipeline`, `/evidence`, `/about`, `/careers`, `/contact` at 390, 768 and 1440 pixels; navigation/mobile menu; downloads; console/hydration; contact validation and draft behavior. All 21 requested viewport cases are explicitly `not_run` in `summary.json`.

Earlier browser artifacts elsewhere in the repository are historical checks and are not presented as fresh checks of this build. External links, actual HTTP download responses, layout, runtime console errors, and browser interaction could not be verified here.
