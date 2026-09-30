"""
Run-level metadata for a discovered study: what was sequenced, where the reads
are, and what the depositors said each sample was.

    fetch_runs(candidate) -> list[RunRecord]

Reads come from ENA's filereport, never from SRA: ENA serves every public run
(SRA, ENA and DDBJ alike) as plain gzipped FASTQ over HTTPS with an MD5 per
file, so fetching needs no SRA toolkit and can verify what it downloaded.

What each sample WAS comes from GEO when the study is in GEO. GEO's per-sample
title and "characteristics" (cell line: HeLa / treatment: DMSO / library: A)
are the only structured description of a screen's design most depositors
write, and they are much richer than the SRA sample title. They are joined to
runs by GSM, which GEO-brokered submissions carry in ENA's sample_alias; the
experiment title ("... GSM4332020: ...") and GEO's SRA relation (SRX) are
fallbacks, in that order.

For studies outside GEO, BioSample attributes stand in for characteristics.

READ 1 ONLY. The analysis counts read 1 (the spacer sits in read 1 in every
common amplicon protocol). For a paired run fastq_urls therefore lists only the
`_1` file, and the plan records that assumption in its notes. A single-end run
that nevertheless has several FASTQ files keeps them all, so the planner can
refuse it rather than guess which file carries the spacer.
"""

from __future__ import annotations

import functools
import re
import time
from typing import Any

from .discover import ENA_PORTAL, gds_summaries, http_get
from .models import RunRecord, StudyCandidate

GEO_ACC = "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi"

RUN_FIELDS = ("run_accession,experiment_accession,sample_accession,secondary_sample_accession,"
              "sample_title,library_strategy,library_layout,library_source,library_selection,"
              "instrument_model,read_count,base_count,fastq_ftp,fastq_md5,fastq_bytes,"
              "scientific_name,tax_id,experiment_title,sample_alias,study_accession")

# Supplementary files that are probably guide-count tables. Kept narrow: a
# false entry here costs the main session one wasted download and parse.
_COUNT_TABLE = re.compile(
    r"(count|counts|readcount|read_count|sgrna|guide|grna|mageck|\.count\.)[^/]*"
    r"\.(txt|tsv|csv|xlsx?|tab)(\.gz|\.zip)?$", re.I)


# ---------------------------------------------------------------------------
# ENA filereport
# ---------------------------------------------------------------------------

def _https(url: str) -> str:
    url = url.strip()
    if url.startswith("ftp://"):
        url = url[len("ftp://"):]
    return url if url.startswith("http") else f"https://{url}"


def _ints(s: str) -> list[int]:
    return [int(x) for x in s.split(";") if x.strip().isdigit()]


def run_from_filereport(row: dict[str, Any]) -> RunRecord:
    """One ENA filereport row -> RunRecord (read-1 files only for paired runs)."""
    urls = [u for u in (row.get("fastq_ftp") or "").split(";") if u.strip()]
    md5 = [m for m in (row.get("fastq_md5") or "").split(";")]
    sizes = _ints(row.get("fastq_bytes") or "")
    layout = (row.get("library_layout") or "").upper() or None
    files = list(zip(urls, md5 + [""] * (len(urls) - len(md5)), sizes + [0] * (len(urls) - len(sizes))))
    if layout == "PAIRED":
        # ENA names mates <run>_1 / <run>_2 and an unpaired remainder <run>.fastq.gz.
        r1 = [f for f in files if re.search(r"_1\.f(ast)?q(\.gz)?$", f[0])]
        files = r1 or files
    return RunRecord(
        run=row["run_accession"],
        experiment=row.get("experiment_accession") or None,
        sample=row.get("sample_accession") or row.get("secondary_sample_accession") or None,
        geo_sample=_gsm_of(row),
        sample_title=row.get("sample_title") or "",
        characteristics={},
        library_strategy=row.get("library_strategy") or None,
        library_layout=layout,
        instrument=row.get("instrument_model") or None,
        read_count=int(row["read_count"]) if str(row.get("read_count") or "").isdigit() else None,
        base_count=int(row["base_count"]) if str(row.get("base_count") or "").isdigit() else None,
        fastq_urls=[_https(u) for u, _, _ in files],
        fastq_md5=[m for _, m, _ in files],
        fastq_bytes=[b for _, _, b in files],
    )


def _gsm_of(row: dict[str, Any]) -> str | None:
    alias = (row.get("sample_alias") or "").strip()
    if re.fullmatch(r"GSM\d+", alias):
        return alias
    m = re.search(r"\b(GSM\d+)\b", row.get("experiment_title") or "")
    return m[1] if m else None


def parse_tsv(text: str) -> list[dict[str, str]]:
    import csv
    import io

    if not text.strip():
        return []
    return [dict(row) for row in csv.DictReader(io.StringIO(text), delimiter="\t")]


def filereport(accession: str, attempts: int = 3) -> list[dict[str, Any]]:
    """
    ENA filereport rows. TSV rather than JSON: ENA has been seen to return a
    truncated JSON body under load, and a TSV row either parses whole or has
    the wrong number of fields, which is checked.
    """
    last = None
    for _ in range(attempts):
        r = http_get(f"{ENA_PORTAL}/filereport", {"accession": accession, "result": "read_run",
                                                  "fields": RUN_FIELDS, "format": "tsv", "limit": 0})
        # ENA can answer a request it could not finish with HTTP 200 and the
        # body "ERROR occurred. Not all results may have been written...",
        # which parses as a one-column TSV whose "run" is the error text.
        # Every run accession must look like one, or the page is retried.
        if "ERROR occurred" in r.text[:2000]:
            last = f"ENA reported an incomplete filereport for {accession}"
            time.sleep(5)
            continue
        rows = parse_tsv(r.text)
        if all(None not in row and re.fullmatch(r"[SED]RR\d+", row.get("run_accession") or "") for row in rows):
            return rows
        last = f"malformed filereport for {accession}"
        time.sleep(5)
    raise RuntimeError(last)


def _study_accession(c: StudyCandidate) -> str | None:
    """The id ENA's filereport accepts for this study: BioProject, else SRA/ENA study."""
    for key in ("bioproject", "sra_study", "ena_study"):
        if c.xrefs.get(key):
            return c.xrefs[key]
    if re.fullmatch(r"PRJ[EDN][A-Z]\d+|[SED]RP\d+", c.accession):
        return c.accession
    if c.accession.startswith("GSE"):
        docs = gds_summaries([c.accession])
        if docs:
            d = docs[0]
            if d.get("bioproject"):
                c.xrefs["bioproject"] = d["bioproject"]
                return d["bioproject"]
            for rel in d.get("extrelations") or []:
                if rel.get("relationtype") == "SRA":
                    c.xrefs["sra_study"] = rel.get("targetobject")
                    return c.xrefs["sra_study"]
    return None


# ---------------------------------------------------------------------------
# GEO
# ---------------------------------------------------------------------------

def parse_soft(text: str) -> dict[str, dict[str, Any]]:
    """
    GEO SOFT (brief) text -> {accession: record} for ^SERIES and ^SAMPLE blocks.

    Sample record: title, characteristics {key: value}, source_name,
    description, srx (from the SRA relation), supplementary [urls].
    Series record: title, summary, overall_design, supplementary [urls].
    """
    out: dict[str, dict[str, Any]] = {}
    cur: dict[str, Any] | None = None
    for line in text.splitlines():
        if line.startswith("^SAMPLE") or line.startswith("^SERIES"):
            acc = line.split("=", 1)[1].strip()
            cur = out.setdefault(acc, {"kind": "sample" if line.startswith("^SAMPLE") else "series",
                                       "characteristics": {}, "supplementary": [], "description": [],
                                       "overall_design": [], "summary": []})
            continue
        if cur is None or not line.startswith("!"):
            continue
        key, _, value = line[1:].partition(" = ")
        value = value.strip()
        k = key.lower()
        if k.endswith("_title"):
            cur["title"] = value
        elif "characteristics" in k:
            ck, sep, cv = value.partition(":")
            if sep:
                cur["characteristics"].setdefault(ck.strip().lower(), cv.strip())
            elif value:
                cur["characteristics"].setdefault(f"characteristic_{len(cur['characteristics'])}", value)
        elif k.startswith("sample_source_name"):
            cur["source_name"] = value
        elif k == "sample_description":
            cur["description"].append(value)
        elif "supplementary_file" in k and value and value.upper() != "NONE":
            cur["supplementary"].append(_https(value))
        elif k == "sample_relation" and value.startswith("SRA:"):
            m = re.search(r"([SED]RX\d+)", value)
            if m:
                cur["srx"] = m[1]
        elif k == "sample_molecule_ch1":
            cur["molecule"] = value
        elif k == "sample_library_strategy":
            cur["library_strategy"] = value
        elif k == "series_summary":
            cur["summary"].append(value)
        elif k == "series_overall_design":
            cur["overall_design"].append(value)
        elif k == "series_relation":
            cur.setdefault("relations", []).append(value)
    return out


def geo_soft(gse: str, targ: str) -> str:
    return http_get(GEO_ACC, {"acc": gse, "targ": targ, "form": "text", "view": "brief"}, timeout=120).text


@functools.lru_cache(maxsize=256)
def series_info(gse: str) -> dict[str, Any]:
    """Series-level GEO text: summary, overall design, supplementary files, relations."""
    recs = parse_soft(geo_soft(gse, "self"))
    s = recs.get(gse, {})
    return {"title": s.get("title", ""), "summary": " ".join(s.get("summary", [])),
            "overall_design": " ".join(s.get("overall_design", [])),
            "supplementary": s.get("supplementary", []), "relations": s.get("relations", [])}


def supplementary_count_tables(gse: str, samples: dict[str, dict] | None = None) -> list[str]:
    """
    GEO supplementary files that look like guide-count tables, series- and sample-level.

    Only names are inspected; nothing is downloaded. The main session can use
    these to cross-check its own counts against the depositors'.
    """
    urls = list(series_info(gse)["supplementary"])
    for rec in (samples or {}).values():
        urls += rec.get("supplementary", [])
    seen, out = set(), []
    for u in urls:
        if u not in seen and _COUNT_TABLE.search(u.rsplit("/", 1)[-1]):
            seen.add(u)
            out.append(u)
    return out


def join_geo(runs: list[RunRecord], samples: dict[str, dict[str, Any]]) -> None:
    """Attach GEO sample title and characteristics to runs, in place."""
    by_srx = {rec["srx"]: gsm for gsm, rec in samples.items() if rec.get("srx")}
    for r in runs:
        gsm = r.geo_sample or by_srx.get(r.experiment or "")
        rec = samples.get(gsm or "")
        if not rec:
            continue
        r.geo_sample = gsm
        r.sample_title = rec.get("title") or r.sample_title
        ch = dict(rec.get("characteristics", {}))
        if rec.get("source_name"):
            ch.setdefault("source_name", rec["source_name"])
        if rec.get("description"):
            ch.setdefault("description", "; ".join(d for d in rec["description"]
                                                     if not d.lower().startswith("processed data")))
        if rec.get("molecule"):
            ch.setdefault("molecule", rec["molecule"])
        r.characteristics = {k: v for k, v in ch.items() if v}


# ---------------------------------------------------------------------------
# BioSample (non-GEO studies)
# ---------------------------------------------------------------------------

def biosample_attributes(accession: str) -> dict[str, str]:
    """BioSample characteristics as {key: value}, via the EBI BioSamples API."""
    r = http_get(f"https://www.ebi.ac.uk/biosamples/samples/{accession}", {"format": "json"})
    out = {}
    for k, vals in (r.json().get("characteristics") or {}).items():
        if vals and isinstance(vals, list) and vals[0].get("text"):
            out[k.lower()] = str(vals[0]["text"])
    return out


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def fetch_runs(c: StudyCandidate, *, max_biosamples: int = 200) -> list[RunRecord]:
    """
    Every public run of the study, with FASTQ URLs/MD5s and sample descriptions.

    Returns [] when the study has no runs in ENA (a GEO SuperSeries, a deposit
    with processed data only, or one not yet mirrored); the planner turns that
    into status "unsupported: no raw reads".
    """
    acc = _study_accession(c)
    if not acc:
        return []
    rows = filereport(acc)
    runs = [run_from_filereport(r) for r in rows if r.get("run_accession")]
    # The study's organism as ENA sees it, per run; the planner refuses
    # organisms without libraries even when GEO only said "synthetic construct".
    for run, row in zip(runs, [r for r in rows if r.get("run_accession")]):
        if row.get("scientific_name"):
            run.characteristics["ena_scientific_name"] = row["scientific_name"]
        if row.get("tax_id"):
            run.characteristics["ena_tax_id"] = str(row["tax_id"])
        if row.get("experiment_title"):
            run.characteristics["ena_experiment_title"] = row["experiment_title"]

    gse = c.xrefs.get("geo") or (c.accession if c.accession.startswith("GSE") else None)
    if gse:
        samples = {a: rec for a, rec in parse_soft(geo_soft(gse, "gsm")).items() if rec["kind"] == "sample"}
        join_geo(runs, samples)
        # join_geo replaces characteristics with GEO's; put the ENA facts back.
        _restore_ena(runs, rows)
    else:
        for r in runs[:max_biosamples]:
            if r.sample and r.sample.startswith(("SAMN", "SAME", "SAMD")):
                try:
                    attrs = biosample_attributes(r.sample)
                except Exception:  # noqa: BLE001 - attributes are an aid, not a requirement
                    continue
                r.characteristics.update({k: v for k, v in attrs.items()
                                          if k not in ("organism", "sra accession")})
    return sorted(runs, key=lambda r: r.run)


def _restore_ena(runs: list[RunRecord], rows: list[dict[str, Any]]) -> None:
    by = {r["run_accession"]: r for r in rows if r.get("run_accession")}
    for run in runs:
        row = by.get(run.run, {})
        for src, dst in (("scientific_name", "ena_scientific_name"), ("tax_id", "ena_tax_id"),
                         ("experiment_title", "ena_experiment_title")):
            if row.get(src):
                run.characteristics[dst] = str(row[src])
