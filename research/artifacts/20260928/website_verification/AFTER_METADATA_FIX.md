# Metadata and benchmark wording correction

The original `README.md`, `static_checks.json` and `summary.json` preserve the before state. After correction, `after_metadata_checks.json` records checks against newly generated production HTML for all seven public pages.

- Canonical and Open Graph URLs identify the correct page on `https://splicr.org`.
- Each page has its own Open Graph title and description, consistent with Twitter sharing metadata. Existing generated sharing images are preserved.
- A shared, typed server-side helper keeps page titles/descriptions and sharing metadata aligned. No layout, browser event handler or scientific metric changed.
- The evidence and technology pages disclose that published expert prompts may include post-hoc notes, significance criteria and ranking rationale. The retrospective ranking comparison does not establish a clean pre-experiment historical forecast.

Verification: **81/81 web tests pass**, including seven route metadata regression cases and the evidence-copy regression; TypeScript, ESLint and webpack production build pass. Logs are saved with the `after_` prefix. Generated HTML checks pass for all seven routes. Review against the React guidance found no new hooks, client work, network requests or serialization boundaries.

Browser verification remains blocked by the environment restrictions recorded in the before report. These metadata checks do not establish successful rendering, console cleanliness, or interactive behavior at the requested viewport sizes. No deployment was performed.
