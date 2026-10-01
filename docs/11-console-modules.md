# Console modules

The five product modules in the console, what each reads and writes, what it
refuses to claim, and how each is tested. The console itself is closed to the
public (`apps/web/src/lib/supabase/proxy.ts`); this describes what is behind the
gate.

Rules every module follows:

- A workspace page never renders sample data. Demonstration data is imported only
  after an explicit demo session, and tests count those imports.
- A rate always names its denominator. A missing value is "Not recorded", never
  zero. A failed read is "unavailable", never an empty list.
- A model output is an uncalibrated stored score, not a probability. There is no
  validation probability and no model retraining anywhere in this repository.
- The address is the state. Filters, sort and page live in the query string, so a
  view can be sent as a link, and a hand-edited link cannot break the page.

## Atlas

`/dashboard/atlas`, `/dashboard/atlas/screens/[id]`, `/dashboard/atlas/export`.

Reads a committed snapshot of the ingested BioGRID ORCS store: 1,952 human screens
and about 29,000 genes with the ids of the screens whose authors called each one.
It needs no database and is the same in demo and workspace mode. Each screen keeps
its authors' analysis method and hit rule, printed verbatim; hit counts are never
added across screens.

- Build: `npm run atlas:snapshot` (`scripts/data/build-atlas-snapshot.py`). It
  cross-checks every gene's screen list against the ingest's own count and fails on
  a mismatch. `npm run atlas:check` fails if the committed files are stale.
- The loader verifies each file's SHA-256 against `manifest.json` before use.
- ORCS is MIT licensed; the notice ships in `src/lib/atlas/data/NOTICE` and the
  export preambles.
- Limits: human screens only (mouse, fly and yeast are not ingested). 177 screens
  list fewer distinct hit symbols than ORCS reports, because repeated identifiers
  collapse to one symbol. The record page prints both numbers.
- Code: `src/lib/atlas/` (pure queries in `query.ts`), `src/components/dashboard/atlas/`.

## Hit Report

`/dashboard/screens/[id]`, `/api/report/[id]?format=csv|json`.

The workspace page shows the current run's recorded statistics, artifact flags with
their reasons, per-guide effects, the Atlas history of each gene (from the snapshot,
human screens only) and its bench status. It filters by direction, FDR, flags,
comparison and gene, sorts by recorded statistics only, and never ranks by
likelihood of validating. The export is the recorded run, written at full precision.

Above the table, an effect-versus-significance plot draws one dot per recorded
gene; clicking one opens that gene's per-guide evidence — how much its guides
disagreed against this screen's own spread, whether the call survives dropping one
guide, where each guide cut, and the AlphaFold model of the unedited protein. The
drawer renders the report the engine stored and recomputes nothing. See
[guide disagreement and Escape](12-escape-and-deep-dive.md).

- Limits: no PDF for workspace runs (501 with a message). Exports stop at 50,000
  rows and say so in the file and in a header. A gene needs at least two guides
  with a recorded fold change to have a disagreement report; runs analysed before
  `public.guide_effects` existed have none, and the drawer says which of those two
  it is rather than implying the guides agreed.
- Code: `src/lib/data/screen-detail.ts`, `screen-report.ts`, `src/lib/report/`,
  `src/components/dashboard/hit-report/`.

## Screen Planner

`/dashboard/planner`.

Design arithmetic with the working shown: cells to transduce, cells held per sample,
reads, gDNA and PCR, library representation (Poisson-lognormal mixture), a sampling
noise floor, a timeline and consumable costs. It needs no account and stores nothing;
the design lives in the address.

- It deliberately gives no statistical power percentage. The noise floor is labelled
  a lower bound. Unit costs are placeholders the reader edits, set beside a
  published service price and not presented as a quote.
- Working ranges are from Joung et al., Nat Protoc 2017, doi 10.1038/nprot.2017.016
  (more than 500 cells and 500 reads per guide, MOI below 0.3, skew under 10). The
  protocol's worked example divides by the MOI; the planner divides by the fraction
  infected, `1 - exp(-MOI)`, and the method panel says the two differ.
- Library sizes are what the engine parses from the library files
  (`python -m splicr libraries`).
- Code: `src/lib/planner/` (`model.ts` is pure), `src/components/dashboard/planner/`.

## Truth Loop

`/dashboard/validation`, `/dashboard/validation/export`.

Members log, amend and (admins) delete bench outcomes. The four results stay four:
validated, did not validate, inconclusive, pending. A validation rate is stated only
over the decided two, with its count and a Wilson interval. Each outcome is linked to
the hit recorded for that gene in the screen's current run when one exists, and the
score stored at the time is kept beside the result.

- Server actions re-check the caller's role, take the organization from the session,
  and refuse a screen from another workspace. Row Level Security is a second lock.
- The demonstration runs the same view over rows held in the browser tab, and says so.
- Code: `src/lib/outcomes/`, `src/lib/data/outcomes.ts`, `outcome-actions.ts`,
  `src/components/dashboard/truth-loop/`.

## Connect

`/dashboard/connect`, `GET /api/v1/hits`.

Admins make scoped keys; only the SHA-256 is stored and the key is shown once. The
page gives curl, Python, R and JavaScript snippets and reference tables.

- Only `hits:read` is checked by any endpoint today; the other scopes are labelled
  reserved. There is no write endpoint and no remote MCP server.
- The parameter, field and status tables are tested against the route's own schema
  and output, so the documentation cannot drift from the endpoint.
- Code: `src/lib/connect/config.ts`, `src/components/dashboard/connect-panel.tsx`.

## Tests

`npm run test:web` runs everything. The module tests load TypeScript with
`apps/web/tests/helpers/load-ts.mjs` and replace the database client with an
in-memory fake, so they verify the application's own rules (who may write, what an
organization scope covers, what is refused before a query) and not the deployed RLS
policies.

Accessibility was audited with axe-core on each page, drawers open and closed; a
wide table's scroll container is a keyboard stop only when it actually scrolls
(`scroll-region.tsx`).
