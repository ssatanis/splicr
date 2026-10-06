# SplicR · Dow kinome screen

Recorded analysis outputs for the six completed screens associated with experiment `01a10e40-27c0-77ec-b80e-d8a307fc32fd` and source table `can-24-0775_table_s6_suppst6.xlsx`.

The Excel workbook, JSON document and CSV archive were downloaded through SplicR’s authenticated bulk export. The downloaded files were copied here without modifying their contents.

## Files

| File | Use |
|---|---|
| `SplicR-Dow-kinome-results.xlsx` | Researcher review: six results worksheets, an overview, QC, guide results, guide disagreement, provenance, a data dictionary and an export record. |
| `SplicR-Dow-kinome-results.json` | Complete structured export, grouped by screen, with all selected recorded result columns and evidence. |
| `SplicR-Dow-kinome-results-csv.zip` | Separate tables for each screen, with a manifest and data dictionary. |
| `verification.json` | File checksums, screen/run identifiers, row counts and verification results. |

## Contents

| Screen | Gene/comparison rows | Recorded screen QC |
|---|---:|---|
| Essentiality ICSBCS002 | 489 | fail |
| Gefitinib ICSBCS002 | 488 | fail |
| Trametinib ICSBCS002 | 488 | fail |
| Essentiality ICSBCS007 | 489 | warn |
| Gefitinib ICSBCS007 | 488 | warn |
| Trametinib ICSBCS007 | 488 | warn |

The export contains 2,930 gene/comparison rows, 18,240 guide rows and 2,928 guide-disagreement rows. All 37 result-column choices and all four evidence sections were selected; no FDR row filter was applied.

## Reading the results

Start with the **Screens** worksheet, then open the named results worksheet. **Data dictionary** defines the result columns; **Quality control** preserves the recorded metrics and warnings. **Run provenance** contains the recorded run settings, tool stages and timings. **Export record** identifies the file schema, selected content and export time in UTC.

Combined SplicR FDR and native caller FDRs have separate columns. Missing statistics remain blank in Excel and CSV and null in JSON. Measured zero remains zero. JSON-encoded arrays and objects are labelled in the column definitions. Guide keys and comparison IDs join the guide evidence to the appropriate gene results; the stored guide LFC array does not establish sequence-to-effect pairing.

QC verdicts apply to the results. Artifact flags and Atlas recurrence provide context rather than proving a false hit. Atlas values are those stored when the analysis ran. Stored model scores, bounds, novelty scores and explanations are identified as recorded model outputs; they do not establish a validation probability or a new discovery.

CSV files contain no worksheets. Text that could be interpreted as a spreadsheet formula is prefixed with an apostrophe in CSV; JSON preserves the original text, and Excel stores text as typed cells. Use the Excel workbook for viewing date-like gene symbols in spreadsheet software.

## Verification

Every exported gene, guide, disagreement, QC and provenance cell was compared across Excel, JSON and CSV. Screen IDs, run IDs, QC statuses, worksheet counts, typography, filters and frozen panes were also checked. The file hashes and exact counts are in `verification.json`.

The product checks passed: type checking, lint, production build, the full web test suite, and the export/deletion browser scenarios. The browser checks exercised full 20,000-row exports, content selection, FDR filtering, failure handling, workspace access and deletion of newly created disposable fixtures. The Dow screens were preserved.
