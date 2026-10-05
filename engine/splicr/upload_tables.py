"""Materialize reviewed uploads without guessing missing counts or gene mappings."""
from __future__ import annotations

import csv
import gzip
import io
import json
from pathlib import Path
from decimal import Decimal, InvalidOperation

from .references import Library, Guide


def _rows(path: Path, sheet: str | None = None) -> list[list]:
    if path.suffix.lower() == ".xlsx":
        import openpyxl
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            if sheet not in workbook.sheetnames:
                raise ValueError(f"{path.name}: select a worksheet from {workbook.sheetnames}")
            return [list(row) for row in workbook[sheet].iter_rows(values_only=True)]
        finally:
            workbook.close()
    if path.suffix.lower() == ".ods":
        import pandas as pd
        if sheet is None:
            raise ValueError("Select an OpenDocument worksheet")
        return pd.read_excel(path, sheet_name=sheet, header=None, engine="odf", keep_default_na=False).values.tolist()
    if path.suffix.lower() in {".xls", ".xlsb"}:
        from python_calamine import CalamineWorkbook
        with CalamineWorkbook.from_path(str(path)) as workbook:
            if sheet not in workbook.sheet_names:
                raise ValueError(f"{path.name}: select a worksheet from {workbook.sheet_names}")
            return workbook.get_sheet_by_name(sheet).to_python(skip_empty_area=False)
    opener = gzip.open if path.suffix.lower() == ".gz" else open
    with opener(path, "rt", encoding="utf-8-sig", newline="") as handle:
        text = handle.read()
    if path.name.lower().endswith((".json", ".json.gz")):
        data = json.loads(text)
        if isinstance(data, list) and all(isinstance(row, list) for row in data):
            return data
        if isinstance(data, list) and data and all(isinstance(row, dict) for row in data):
            columns = list(dict.fromkeys(key for row in data for key in row))
            return [columns, *[[row.get(key) for key in columns] for row in data]]
        if isinstance(data, dict) and isinstance(data.get("columns"), list) and isinstance(data.get("data"), list) and all(isinstance(row, list) for row in data["data"]):
            return [data["columns"], *data["data"]]
        raise ValueError("JSON counts need an array of records, rows, or columns and data arrays")
    delimiter = "\t" if text.count("\t") >= text.count(",") else ","
    return list(csv.reader(io.StringIO(text), delimiter=delimiter))


def canonical_counts(path: Path, library: Library, samples: list[str], dest: Path,
                     sheet: str | None = None, aliases: dict[str, str] | None = None,
                     mapping: dict | None = None) -> Path:
    """Join guide IDs or exact sequences to the confirmed library; preserve observed rows only."""
    rows = _rows(path, sheet)
    if mapping:
        rows = mapped_count_rows(rows, mapping)
    clean = [["" if cell is None else str(cell).strip() for cell in row] for row in rows]
    header_index = next((i for i, row in enumerate(clean[:40]) if all(sample in row for sample in samples)), None)
    if header_index is None:
        raise ValueError(f"{path.name}: the reviewed sample columns are not present")
    header = clean[header_index]
    if len(set(samples)) != len(samples) or any(header.count(sample) != 1 for sample in samples):
        raise ValueError("Sample columns must be nonempty and unique")
    indices = [header.index(sample) for sample in samples]
    guide_index = next((i for i, name in enumerate(header) if name.lower() in {"id", "guide_id", "sgrna", "guide", "grna", "sgid", "name"}), 0)
    sequence_index = next((i for i, name in enumerate(header) if name.lower() in {"sequence", "sgrna_sequence", "sg rna sequence", "spacer", "protospacer"}), None)
    by_id = {guide.guide_id: guide for guide in library.guides}
    ambiguous_ids: dict[str, list] = {}
    for guide in library.guides:
        if "__sequence_" in guide.guide_id:
            ambiguous_ids.setdefault(guide.guide_id.rsplit("__sequence_", 1)[0], []).append(guide)
    for key, group in ambiguous_ids.items():
        if len({guide.gene for guide in group}) == 1 and key not in by_id:
            by_id[key] = Guide(key, "", group[0].gene, is_control=group[0].is_control)
    by_sequence: dict[str, list] = {}
    for guide in library.guides:
        by_sequence.setdefault(guide.sequence, []).append(guide)
    output = []
    seen: set[str] = set()
    for row_number, row in enumerate(clean[header_index + 1:], header_index + 2):
        if not any(row):
            continue
        guide_key = row[guide_index] if guide_index < len(row) else ""
        guide = by_id.get((aliases or {}).get(guide_key, guide_key))
        if guide is None:
            sequence = row[sequence_index] if sequence_index is not None and sequence_index < len(row) else guide_key
            candidates = by_sequence.get(sequence.upper(), [])
            if len(candidates) == 1:
                guide = candidates[0]
        if not guide_key and row_number == len(clean) and output:
            if all(Decimal(row[index]) == sum(record[j + 2] for record in output) for j, index in enumerate(indices)):
                continue  # Verified footer totals, not a guide with missing identity.
        if guide is None:
            continue
        if guide.guide_id in seen:
            continue
        seen.add(guide.guide_id)
        counts = []
        for sample, index in zip(samples, indices):
            try:
                value = Decimal(row[index])
                if not value.is_finite() or value < 0 or value != value.to_integral_value():
                    raise InvalidOperation
                counts.append(int(value))
            except (InvalidOperation, IndexError, ValueError):
                raise ValueError(f"{path.name}, row {row_number}, {sample}: expected a nonnegative integer count; missing is not zero") from None
        output.append([guide.guide_id, guide.gene or "CONTROL", *counts])
    if not output:
        raise ValueError("The selected table has no guide count rows")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("w", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t", lineterminator="\n")
        writer.writerow(["sgRNA", "Gene", *samples])
        writer.writerows(output)
    return dest


def mapped_count_rows(rows: list[list], mapping: dict) -> list[list]:
    """Use the frozen column declaration; never fill absent measurements with zero."""
    header_row = mapping.get("header_row")
    if not isinstance(header_row, int) or not 1 <= header_row <= 40 or header_row > len(rows):
        raise ValueError("Invalid reviewed header row")
    header = [str(value).strip() if value is not None else "" for value in rows[header_row - 1]]
    if len(set(filter(None, header))) != len(list(filter(None, header))):
        raise ValueError("Duplicate source column names")
    body = [[str(value).strip() if value is not None else "" for value in row] for row in rows[header_row:] if any(value is not None and str(value).strip() for value in row)]
    def index(key, required=False):
        name = mapping.get(key)
        if not name and not required:
            return None
        if name not in header:
            raise ValueError(f"Reviewed column {name!r} is missing")
        return header.index(name)
    def value(row, i):
        return row[i] if i is not None and i < len(row) else ""
    layout = mapping.get("layout", "wide")
    if layout == "transposed":
        names = [value(row, 0) for row in body]
        if not all(names) or len(set(names)) != len(names):
            raise ValueError("Transposed rows need unique sample names")
        return [["guide_id", *names], *[[guide, *[value(row, i + 1) for row in body]] for i, guide in enumerate(header[1:])]]
    guide = index("guide_column", True)
    if layout == "long":
        sample, count = index("sample_column", True), index("count_column", True)
        names = list(dict.fromkeys(value(row, sample) for row in body))
        if not all(names):
            raise ValueError("Long counts need sample labels")
        guides = {}
        for row in body:
            key, label = value(row, guide), value(row, sample)
            if not key:
                raise ValueError("Long counts need guide IDs")
            counts = guides.setdefault(key, {})
            if label in counts:
                raise ValueError(f"Duplicate count for {key} / {label}")
            counts[label] = value(row, count)
        return [["guide_id", *names], *[[key, *[counts.get(label, "") for label in names]] for key, counts in guides.items()]]
    if layout != "wide":
        raise ValueError("Unknown reviewed count layout")
    gene, sequence = index("gene_column"), index("sequence_column")
    sample_names = mapping.get("sample_columns") or []
    if not sample_names or len(set(sample_names)) != len(sample_names):
        raise ValueError("Choose unique count columns")
    indices = [header.index(name) for name in sample_names]
    return [["guide_id", *(["Gene"] if gene is not None else []), *(["Sequence"] if sequence is not None else []), *sample_names],
            *[[value(row, guide), *([value(row, gene)] if gene is not None else []), *([value(row, sequence)] if sequence is not None else []), *[value(row, i) for i in indices]] for row in body]]
