#!/usr/bin/env python
"""Verify the public Ferrarone counts and package original bytes for SplicR.

Run with engine/.tools/env/bin/python scripts/data/prepare-ferrarone-demo.py.
No guide counts are generated, filtered, or filled in. Canonical copies are
audit outputs; upload the original files to trigger the verified study profile.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
from splicr.references import load_library
from splicr.upload_tables import canonical_counts

SOURCES = {
    "2d_crispr_screen_read_counts.txt": (7440985, "47a694a20d470868daf9c3695e932a73"),
    "spheroid_crispr_screen_read_counts.txt": (7440983, "079c7294fb7c663956637efb7d360efb"),
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--downloads", type=Path, default=Path.home() / "Downloads")
    parser.add_argument("--output", type=Path, default=ROOT / "artifacts/ferrarone-20261007")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    package = args.downloads / "SplicR-Ferrarone-demo"
    package.mkdir(parents=True, exist_ok=True)
    metadata_path = args.output / "dataverse-metadata.json"
    subprocess.run(["curl", "-fsSL", "--retry", "2", "https://dataverse.harvard.edu/api/datasets/:persistentId/?persistentId=doi:10.7910/DVN/8DEPIT", "-o", str(metadata_path)], check=True)
    metadata = json.loads(metadata_path.read_text())["data"]["latestVersion"]
    library = load_library("tkov3")
    guide_map = {guide.guide_id: guide for guide in library.guides}
    manifest, annotations, matrices = [], [], []
    for item in metadata["files"]:
        data = item["dataFile"]
        name = data["filename"]
        entry = {"filename": name, "id": data["id"], "bytes": data["filesize"], "md5": data["checksum"]["value"], "url": f"https://dataverse.harvard.edu/api/access/datafile/{data['id']}"}
        if name in SOURCES:
            file_id, md5 = SOURCES[name]
            assert data["id"] == file_id and entry["md5"] == md5
            source = args.downloads / name
            if not source.exists():
                subprocess.run(["curl", "-fsSL", "--retry", "2", entry["url"], "-o", str(source)], check=True)
            raw = source.read_bytes()
            assert len(raw) == entry["bytes"] and hashlib.md5(raw).hexdigest() == md5, f"Archive mismatch: {name}"
            entry["sha256"] = hashlib.sha256(raw).hexdigest()
            entry["verified"] = True
            with source.open() as handle:
                reader = csv.DictReader(handle, delimiter="\t")
                header, rows = reader.fieldnames, list(reader)
            assert len(rows) == 70116 and len({row["sgRNA"] for row in rows}) == len(rows)
            for row in rows:
                guide = guide_map[row["sgRNA"]]
                for sample in header[2:]:
                    assert int(row[sample]) >= 0 and str(int(row[sample])) == row[sample]
                if row["Gene"] != guide.gene:
                    annotations.append({"file": name, "guide_id": row["sgRNA"], "deposited_gene": row["Gene"], "reference_gene": guide.gene})
            canonical_counts(source, library, header[2:], args.output / "canonical" / name)
            shutil.copyfile(source, package / name)
            entry.update(rows=len(rows), sample_columns=header[2:], deposited_gene_labels=len({row["Gene"] for row in rows}), canonical_gene_labels=len({guide_map[row["sgRNA"]].gene for row in rows}), reference_guides_absent=len(guide_map) - len(rows))
            matrices.append({row["sgRNA"]: row for row in rows})
        manifest.append(entry)
    assert len(matrices) == 2 and set(matrices[0]) == set(matrices[1])
    assert all(matrices[0][guide]["tkov3_plasmid"] == matrices[1][guide]["tkov3_plasmid"] for guide in matrices[0])
    (args.output / "source-manifest.json").write_text(json.dumps({"doi": "10.7910/DVN/8DEPIT", "version": metadata["versionNumber"], "library_sha256": hashlib.sha256(library.source_file.read_bytes()).hexdigest(), "identical_shared_plasmid": True, "files": manifest}, indent=2) + "\n")
    with (args.output / "gene-annotation-audit.csv").open("w") as handle:
        writer = csv.DictWriter(handle, fieldnames=["file", "guide_id", "deposited_gene", "reference_gene"])
        writer.writeheader()
        writer.writerows(annotations)
    instructions = """Upload both original .txt files together in SplicR > New analysis > My experiment.
The verified profile selects A549, human TKOv3 knockout, day-21 replicates,
and six comparisons across 2D and spheroid cultures. Review the plan and launch.
Use the date of your reanalysis; the original experimental date is not in the files.
No additional sequencing or proteomics downloads are needed for this count-table demo.
Dataset: https://doi.org/10.7910/DVN/8DEPIT
Paper: https://doi.org/10.1073/pnas.2403685121
This is a declared reanalysis, not a claim of exact published beta-score reproduction.
FIG4 and VAC14 were genetic screen findings; PIKFYVE required follow-up evidence.
"""
    (package / "START-HERE.md").write_text(instructions)
    zip_path = args.downloads / "SplicR-Ferrarone-demo.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(package.glob("*_read_counts.txt")):
            archive.write(path, path.name)
    print(json.dumps({"package": str(zip_path), "verified_count_files": 2, "guide_rows_per_file": 70116, "annotation_differences_per_file": len(annotations) // 2}, indent=2))

if __name__ == "__main__":
    main()
