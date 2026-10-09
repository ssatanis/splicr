import { createHash } from "node:crypto";

/** Byte checksums detect missing/changed files; they do not authenticate authors. */
export function fileInventory(files: Record<string, Uint8Array>) {
  return Object.entries(files).sort(([left], [right]) => left.localeCompare(right)).map(([path, bytes]) => ({
    path,
    byte_length: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
}

/** Distributed inside a bundle so a collaborator can check it without SplicR. */
export const VERIFY_BUNDLE = `"""Verify extracted SplicR export bytes against manifest.json (Python 3)."""
import hashlib
import json
import sys
from pathlib import Path, PurePosixPath

root = Path(__file__).resolve().parent
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
inventory = manifest.get("files")
if not isinstance(inventory, list) or not inventory:
    sys.exit("No file inventory in manifest.json")
seen = set()
errors = []
for entry in inventory:
    name = entry.get("path", "")
    relative = PurePosixPath(name)
    if not name or relative.is_absolute() or ".." in relative.parts or "\\\\" in name or name in seen or name == "manifest.json":
        errors.append("Invalid or duplicate inventory path: " + repr(name))
        continue
    seen.add(name)
    path = root.joinpath(*relative.parts)
    if not path.resolve().is_relative_to(root) or not path.is_file() or path.is_symlink():
        errors.append("Missing or unsafe file: " + name)
        continue
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            size += len(chunk)
            digest.update(chunk)
    if size != entry.get("byte_length") or digest.hexdigest() != entry.get("sha256"):
        errors.append("Changed file: " + name)
if errors:
    sys.exit("\\n".join(errors))
print("Verified " + str(len(seen)) + " listed files. Checksums establish byte integrity, not scientific correctness or authorship.")
`;

export function bundleReadme(exportedAt: string): string {
  return `# SplicR recorded-results export

Exported: ${exportedAt}

Each screen folder contains individually usable gene-results.csv and screen.json.
Selected evidence sections have separate CSV files. When Run provenance is
selected, analysis-settings.json preserves the recorded run settings and versions.
methods_text.txt supplies a methods draft for author review, and
methods-record.json retains its exact execution evidence. Completed methods
come from the completed hit-calling stage, not from the requested caller list.
Unknown tool versions and effective parameters remain explicitly unrecorded.
Missing settings are null, not a reconstruction of what the engine probably used.
manifest.json records screen/run identities, comparison IDs, row counts, selected
columns, filters, section selection, and the size and SHA-256 of every other file.
data-dictionary.csv explains the selected gene-result columns.

Extract the complete ZIP, then run Python 3.9 or newer:

    python3 verify-bundle.py

The check streams each listed file, detects missing or changed bytes, and does not
require SplicR, credentials, or internet access. manifest.json is excluded from its
own inventory to avoid a circular checksum. These hashes do not authenticate the
manifest or author, verify biological conclusions, or prove reproducible execution.
Unlisted files are not verified. Keep the original download for comparison.

Statistics are recorded outputs; exporting does not rerun an analysis. Zero,
missing values, and no rows have different meanings. Check recorded_gene_rows,
exported_gene_rows, and selection in manifest.json before interpreting empty tables.
QC verdicts and artifact flags remain applicable when filtering to selected genes.
An uncalibrated model score is not a validation probability.

CSV text beginning with spreadsheet formula characters has an apostrophe prefix.
For exact original text use JSON; for typed gene symbols use the Excel export.
When importing CSV into Excel, set gene_symbol and all identifiers to Text so
date-like gene symbols are not rewritten. CSV numbers retain recorded precision.
When moving a table individually, include its screen.json and data-dictionary.csv
to retain run identity and column meaning.

This is a recorded-results bundle. Raw uploads, notebooks, discussion snapshots,
figure source data, and a locked executable environment are not included.
It is not a certified RO-Crate, Workflow Run Crate, or BagIt package.
`;
}
