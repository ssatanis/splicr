#!/usr/bin/env python
"""
Connectors for the perturbation, screening and single-cell sources SplicR draws
on beyond DepMap and BioGRID ORCS. Each one fetches what fits on a workstation,
harmonizes identifiers (engine/splicr/harmonize.py) and writes Parquet to the
lake; what does not fit is registered as a remote source (engine/splicr/sources.py)
and queried in place.

    engine/.tools/env/bin/python scripts/data/ingest-sources.py jump
    engine/.tools/env/bin/python scripts/data/ingest-sources.py perturbseq
    engine/.tools/env/bin/python scripts/data/ingest-sources.py tahoe scbasecount lincs
    engine/.tools/env/bin/python scripts/data/ingest-sources.py geo encode
    engine/.tools/env/bin/python scripts/data/ingest-sources.py all --upload

Every download is size-checked against the server's Content-Length and its
SHA-256 recorded in data/references/<source>/MANIFEST.json, because two of the
hosts SplicR already uses answer failures with HTTP 200 and an HTML or error
body (see docs/04-data-sources.md).
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import harmonize, lake  # noqa: E402
from splicr.config import REFERENCE_DIR  # noqa: E402

UA = "SplicR-ingest/0.2 (+https://github.com/ssatanis; mailto:ss4497@cornell.edu)"
TODAY = dt.date.today().isoformat()


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def fetch(url: str, dest: Path, *, min_bytes: int = 64) -> Path:
    """Download once, verify size, record sha-256. Re-runs skip a verified file."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = dest.parent / "MANIFEST.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    entry = manifest.get(dest.name)
    if entry and dest.exists() and dest.stat().st_size == entry["bytes"]:
        return dest

    req = urllib.request.Request(url, headers={"User-Agent": UA})
    tmp = dest.with_suffix(dest.suffix + ".part")
    h = hashlib.sha256()
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp, open(tmp, "wb") as out:
                expected = int(resp.headers.get("Content-Length") or 0)
                while chunk := resp.read(1 << 20):
                    out.write(chunk)
                    h.update(chunk)
            break
        except Exception as exc:  # noqa: BLE001 - network: retry with backoff
            if attempt == 3:
                raise
            print(f"    retry {attempt + 1} for {dest.name}: {exc}")
            h = hashlib.sha256()
            time.sleep(2 ** attempt)
    size = tmp.stat().st_size
    if expected and size != expected:
        raise IOError(f"{dest.name}: got {size} bytes, server said {expected}")
    if size < min_bytes:
        raise IOError(f"{dest.name}: only {size} bytes; refusing an error body as data")
    tmp.rename(dest)
    manifest[dest.name] = {"url": url, "bytes": size, "sha256": h.hexdigest(), "retrieved": TODAY}
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    print(f"    {dest.name}: {size / 1e6:.1f} MB")
    return dest


def get_json(url: str, params: dict | None = None) -> dict:
    if params:
        url += ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return json.load(resp)
        except Exception:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def write(name: str, frame) -> None:
    """Register a lake dataset on the fly and write it."""
    if name not in lake.DATASETS:
        lake.DATASETS[name] = lake.Dataset(name, (), (), name)
    out = lake.LOCAL_LAKE / name
    out.mkdir(parents=True, exist_ok=True)
    target = out / "data_0.parquet"
    import pyarrow as pa
    import pyarrow.parquet as pq
    table = frame if isinstance(frame, pa.Table) else pa.Table.from_pandas(frame, preserve_index=False)
    pq.write_table(table, target, compression="zstd", row_group_size=65_536)
    print(f"  -> lake/{name}: {table.num_rows:,} rows, {target.stat().st_size / 1e6:.1f} MB")


def harmonize_genes(symbols, entrez=None, taxid: int = 9606) -> dict[str, list]:
    """
    Human gene labels -> {"ensembl_gene_id", "hgnc_id", "gene_symbol", "how"}.
    Ensembl (validated against the Ensembl 116 GTF) is the canonical id; the
    HGNC id rides along for tables keyed on it. `entrez` is a parallel list of
    stronger ids (NCBI Gene or Ensembl) that, when given and resolvable, beat the label. Unresolved or ambiguous inputs get None ids
    and their status in "how"; `report` prints the rate.
    """
    g = harmonize.genes(taxid)
    out: dict[str, list] = {"ensembl_gene_id": [], "hgnc_id": [], "gene_symbol": [], "how": []}
    for i, s in enumerate(symbols):
        r = g.resolve(str(entrez[i])) if entrez is not None and entrez[i] not in (None, "", "nan") else None
        if not (r and r.ok):
            r = g.resolve(str(s)) if s is not None else harmonize.Resolution("", "unresolved")
        out["ensembl_gene_id"].append(r.id if r.ok else None)
        out["hgnc_id"].append(r.xrefs.get("hgnc_id") if r.ok else None)
        out["gene_symbol"].append(r.label if r.ok else None)
        out["how"].append(r.matched_by if r.ok else r.status)
    return out


def report(label: str, values) -> None:
    vals = [v for v in values]
    ok = sum(v is not None for v in vals)
    print(f"  harmonized {label}: {ok:,}/{len(vals):,} ({ok / max(len(vals), 1):.1%})")


# ---------------------------------------------------------------------------
# JUMP Cell Painting: gene-level morphology signatures
# ---------------------------------------------------------------------------

JUMP_META = "https://raw.githubusercontent.com/jump-cellpainting/datasets/main/metadata/"
JUMP_INDEX = "https://raw.githubusercontent.com/jump-cellpainting/datasets/main/manifests/profile_index.json"


def ingest_jump() -> None:
    """
    Metadata for every JUMP perturbation, plus the consortium's processed,
    batch-corrected CRISPR and ORF well profiles collapsed to one consensus
    vector per gene (median across wells). The 116 TB of raw TIFFs and the
    2.8 GB compound profile table stay on AWS and are registered as remote.
    """
    import pandas as pd

    d = REFERENCE_DIR / "jump"
    for f in ("crispr.csv.gz", "orf.csv.gz", "compound.csv.gz", "plate.csv.gz", "well.csv.gz",
              "perturbation_control.csv", "microscope_config.csv"):
        fetch(JUMP_META + f, d / f)
    index = get_json(JUMP_INDEX)
    (d / "profile_index.json").write_text(json.dumps(index, indent=2))
    urls = {e["subset"]: e["url"] for e in index}
    fetch(urls["crispr"], d / "profiles_crispr.parquet")
    fetch(urls["orf"], d / "profiles_orf.parquet")

    # Perturbation catalogue, harmonized.
    crispr = pd.read_csv(d / "crispr.csv.gz")
    orf = pd.read_csv(d / "orf.csv.gz")
    comp = pd.read_csv(d / "compound.csv.gz")
    rows = []
    for kind, df, sym_col, id_col in (("crispr", crispr, "Metadata_Symbol", "Metadata_JCP2022"),
                                      ("orf", orf, "Metadata_Symbol", "Metadata_JCP2022")):
        entrez = df.get("Metadata_NCBI_Gene_ID")
        # Mostly NCBI Gene ids, but ORF rows include transcript placeholders such
        # as "XLOC_013713"; only a numeric id is used as an Entrez key.
        ents = None if entrez is None else [
            str(int(float(x))) if str(x).replace(".0", "").isdigit() else None for x in entrez]
        h = harmonize_genes(df[sym_col].tolist(), ents)
        report(f"JUMP {kind} genes -> Ensembl", h["ensembl_gene_id"])
        rows.append(pd.DataFrame({
            "jcp2022": df[id_col], "kind": kind, "source_label": df[sym_col].astype(str),
            "ensembl_gene_id": h["ensembl_gene_id"], "hgnc_id": h["hgnc_id"], "gene_symbol": h["gene_symbol"],
            "chembl_id": None, "inchikey": None,
        }))
    cmp_res = harmonize.compounds()
    chembl = [(cmp_res.resolve(k).id if isinstance(k, str) else None) for k in comp["Metadata_InChIKey"]]
    report("JUMP compounds -> ChEMBL (local Open Targets set)", chembl)
    # Then the full ChEMBL, by InChIKey, from scripts/data/resolve-chembl-inchikeys.py.
    online = REFERENCE_DIR / "chembl" / "inchikey_map.parquet"
    if online.exists():
        m = pd.read_parquet(online).dropna().set_index("inchikey")["chembl_id"].to_dict()
        chembl = [c or (m.get(k.upper()) if isinstance(k, str) else None)
                  for c, k in zip(chembl, comp["Metadata_InChIKey"])]
        report("JUMP compounds -> ChEMBL (with ChEMBL web service)", chembl)
    rows.append(pd.DataFrame({
        "jcp2022": comp["Metadata_JCP2022"], "kind": "compound", "source_label": comp["Metadata_InChIKey"],
        "ensembl_gene_id": None, "hgnc_id": None, "gene_symbol": None, "chembl_id": chembl,
        "inchikey": comp["Metadata_InChIKey"],
    }))
    write("jump_perturbations", pd.concat(rows, ignore_index=True))

    # Gene-level consensus morphology: median of well profiles per gene.
    import duckdb
    con = duckdb.connect()
    for subset in ("crispr", "orf"):
        path = d / f"profiles_{subset}.parquet"
        cols = [r[0] for r in con.execute(f"describe select * from read_parquet('{path}')").fetchall()]
        feats = [c for c in cols if not c.startswith("Metadata_")]
        meta = pd.read_csv(d / f"{subset}.csv.gz")[["Metadata_JCP2022", "Metadata_Symbol"]]
        con.register("meta", meta)
        agg = ", ".join(f'median("{c}")::float as "{c}"' for c in feats)
        df = con.execute(
            f"select m.Metadata_Symbol as symbol, count(*) as n_wells, {agg} "
            f"from read_parquet('{path}') p join meta m using (Metadata_JCP2022) "
            "where m.Metadata_Symbol is not null group by 1"
        ).df()
        h = harmonize_genes(df["symbol"].tolist())
        report(f"JUMP {subset} consensus genes -> Ensembl", h["ensembl_gene_id"])
        vec = df[feats].to_numpy(np.float32)
        import pyarrow as pa
        table = pa.table({
            "subset": [subset] * len(df), "source_symbol": df["symbol"],
            "ensembl_gene_id": h["ensembl_gene_id"], "hgnc_id": h["hgnc_id"],
            "gene_symbol": h["gene_symbol"], "n_wells": df["n_wells"].astype("int32"),
            "embedding": pa.FixedSizeListArray.from_arrays(pa.array(vec.ravel()), vec.shape[1]),
        })
        write(f"jump_{subset}_gene_morphology", table)
        (d / f"features_{subset}.json").write_text(json.dumps(feats))


# ---------------------------------------------------------------------------
# Genome-scale Perturb-seq (Replogle et al. 2022): pseudobulk signatures
# ---------------------------------------------------------------------------

REPLOGLE = "https://plus.figshare.com/ndownloader/files/"
REPLOGLE_ARTICLE = "https://api.figshare.com/v2/articles/20029387/files"


def ingest_perturbseq() -> None:
    """
    The authors' own pseudobulk, gemgroup z-normalized expression profiles, one
    per perturbation (K562 genome-wide and RPE1), not the 66 GB single-cell
    matrices. Each row is a knockdown's transcriptional signature over the
    measured genes: the form a similarity search or a model consumes.
    """
    import anndata as ad
    import pandas as pd
    import pyarrow as pa

    d = REFERENCE_DIR / "perturbseq"
    files = {f["name"]: f for f in get_json(REPLOGLE_ARTICLE)}
    for name, cell in (("K562_gwps_normalized_bulk_01.h5ad", "K562"), ("rpe1_normalized_bulk_01.h5ad", "RPE1")):
        path = fetch(files[name]["download_url"], d / name)
        a = ad.read_h5ad(path)
        obs = a.obs.copy()
        # obs index is "<id>_<gene>_<transcript>_<ensg>"; gene_id / gene columns carry it.
        target_ensg = obs.get("gene_id", pd.Series([i.split("_")[-1] for i in obs.index], index=obs.index))
        target_sym = obs.get("gene", pd.Series([i.split("_")[1] for i in obs.index], index=obs.index))
        # The authors' Ensembl id first (checked against Ensembl 116); if it has
        # since been retired, their symbol through HGNC; counts printed below.
        h = harmonize_genes(target_sym.astype(str).tolist(),
                            [e if str(e).startswith("ENSG") else None for e in target_ensg])
        via = Counter(h["how"])
        print(f"  Perturb-seq {cell} target matches: {dict(via)}")
        report(f"Perturb-seq {cell} targets -> Ensembl", h["ensembl_gene_id"])
        x = np.asarray(a.X, dtype=np.float32)
        table = pa.table({
            "cell_line": [cell] * a.n_obs,
            "perturbation": obs.index.astype(str),
            "target_symbol_source": target_sym.astype(str).tolist(),
            "ensembl_gene_id": h["ensembl_gene_id"], "hgnc_id": h["hgnc_id"], "gene_symbol": h["gene_symbol"],
            "n_cells": obs.get("num_cells_unfiltered", obs.get("num_cells", pd.Series([None] * a.n_obs))).tolist(),
            "signature": pa.FixedSizeListArray.from_arrays(pa.array(x.ravel()), x.shape[1]),
        })
        write(f"perturbseq_{cell.lower()}_signatures", table)
        genes = a.var.copy()
        write(f"perturbseq_{cell.lower()}_readout_genes", pa.table({
            "position": np.arange(a.n_vars, dtype=np.int32),
            "ensembl_gene_id": genes.index.astype(str).tolist(),
            "gene_symbol": genes.get("gene_name", pd.Series(genes.index)).astype(str).tolist(),
        }))


# ---------------------------------------------------------------------------
# Tahoe-100M (Arc Virtual Cell Atlas): metadata, harmonized
# ---------------------------------------------------------------------------

TAHOE = "https://huggingface.co/datasets/tahoebio/Tahoe-100M/resolve/main/metadata/"


def ingest_tahoe() -> None:
    """
    Drug, cell line, sample and gene metadata. The 100M-cell count matrices
    (3,388 parquet shards) and pseudobulk DE (1,026 shards, ~92 GB) are queried
    in place from Hugging Face by DuckDB; see splicr.sources.
    """
    import pandas as pd

    d = REFERENCE_DIR / "tahoe"
    for f in ("drug_metadata.parquet", "cell_line_metadata.parquet", "sample_metadata.parquet",
              "gene_metadata.parquet"):
        fetch(TAHOE + f, d / f)

    drugs = pd.read_parquet(d / "drug_metadata.parquet")
    cmp_res = harmonize.compounds()
    name_col = "drug" if "drug" in drugs else drugs.columns[0]
    res = [cmp_res.resolve(str(n)) for n in drugs[name_col]]
    drugs["chembl_id"] = [r.id if r.ok else None for r in res]
    drugs["chembl_matched_by"] = [r.matched_by if r.ok else r.status for r in res]
    report("Tahoe drugs -> ChEMBL", drugs["chembl_id"].tolist())
    write("tahoe_drugs", drugs.astype({c: "string" for c in drugs.columns if drugs[c].dtype == object}))

    cells = pd.read_parquet(d / "cell_line_metadata.parquet")
    cres = harmonize.cell_lines()
    key = next((c for c in ("Cell_ID_Cellosaur", "cell_line_name", "cell_name") if c in cells), cells.columns[0])
    rr = [cres.resolve(str(v)) for v in cells[key]]
    cells["rrid"] = [r.id if r.ok else None for r in rr]
    report("Tahoe cell lines -> Cellosaurus", cells["rrid"].tolist())
    write("tahoe_cell_lines", cells.astype({c: "string" for c in cells.columns if cells[c].dtype == object}))

    samples = pd.read_parquet(d / "sample_metadata.parquet")
    write("tahoe_samples", samples.astype({c: "string" for c in samples.columns if samples[c].dtype == object}))


# ---------------------------------------------------------------------------
# scBaseCount (Arc Virtual Cell Atlas): human sample catalogue
# ---------------------------------------------------------------------------

SCBASE = "https://storage.googleapis.com/arc-institute-virtual-cell-atlas/scbasecount/2026-01-12/metadata/Gene/"


def ingest_scbasecount() -> None:
    """Per-SRX sample metadata for every species; per-cell metadata stays on GCS."""
    import pandas as pd

    d = REFERENCE_DIR / "scbasecount" / "2026-01-12"
    listing = get_json("https://storage.googleapis.com/storage/v1/b/arc-institute-virtual-cell-atlas/o",
                       {"prefix": "scbasecount/2026-01-12/metadata/Gene/", "maxResults": 1000})
    frames = []
    for obj in listing.get("items", []):
        if not obj["name"].endswith("sample_metadata.parquet"):
            continue
        organism = obj["name"].split("/")[-2]
        path = fetch(SCBASE + f"{organism}/sample_metadata.parquet", d / f"{organism}.sample_metadata.parquet")
        df = pd.read_parquet(path)
        if "organism" not in df:
            df.insert(0, "organism", organism)
        frames.append(df)
    allsamples = pd.concat(frames, ignore_index=True)
    allsamples = allsamples.astype({c: "string" for c in allsamples.columns if allsamples[c].dtype == object})
    write("scbasecount_samples", allsamples)


# ---------------------------------------------------------------------------
# LINCS L1000 (GSE70138): signature, perturbagen and cell metadata
# ---------------------------------------------------------------------------

LINCS = "https://ftp.ncbi.nlm.nih.gov/geo/series/GSE70nnn/GSE70138/suppl/GSE70138_Broad_LINCS_"


def ingest_lincs() -> None:
    """
    Metadata for all 118,050 Level 5 signatures. The 5.4 GB Level 5 matrix is
    registered as a remote source; its signatures are indexed here so a query
    can select exactly the columns it needs.
    """
    import pandas as pd

    d = REFERENCE_DIR / "lincs" / "GSE70138"
    for f in ("sig_info_2017-03-06", "pert_info_2017-03-06", "cell_info_2017-04-28",
              "gene_info_2017-03-06", "sig_metrics_2017-03-06"):
        fetch(f"{LINCS}{f}.txt.gz", d / f"{f}.txt.gz")
    fetch("https://ftp.ncbi.nlm.nih.gov/geo/series/GSE70nnn/GSE70138/suppl/GSE70138_SHA512SUMS.txt.gz",
          d / "SHA512SUMS.txt.gz")

    sig = pd.read_csv(d / "sig_info_2017-03-06.txt.gz", sep="\t", low_memory=False)
    pert = pd.read_csv(d / "pert_info_2017-03-06.txt.gz", sep="\t", low_memory=False)
    cell = pd.read_csv(d / "cell_info_2017-04-28.txt.gz", sep="\t", low_memory=False)

    # Engineered derivatives ("A375.311" is A375 carrying Cas9) map to their
    # parent line through base_cell_id, and say so. Primary and iPSC-derived
    # cells (NPC, CD34, PHH) have no RRID and stay unmapped.
    cres = harmonize.cell_lines()
    cell_rrid, cell_via = {}, {}
    for _, row in cell.iterrows():
        r, via = cres.resolve(str(row.cell_id)), "cell_id"
        if not r.ok and row.get("cell_type") == "cell line" and isinstance(row.get("base_cell_id"), str):
            r, via = cres.resolve(row["base_cell_id"]), "base_cell_id (engineered derivative)"
        cell_rrid[row.cell_id] = r.id if r.ok else None
        cell_via[row.cell_id] = via if r.ok else r.status
    report("L1000 cell lines -> Cellosaurus", list(cell_rrid.values()))

    cmp_res = harmonize.compounds()
    chem = {}
    for _, row in pert.iterrows():
        r = None
        if isinstance(row.get("inchi_key"), str) and row["inchi_key"] not in ("-666", ""):
            r = cmp_res.resolve(row["inchi_key"])
        if not (r and r.ok):
            r = cmp_res.resolve(str(row.get("pert_iname", "")))
        chem[row["pert_id"]] = r.id if r.ok else None
    report("L1000 perturbagens -> ChEMBL", list(chem.values()))

    sig["rrid"] = sig["cell_id"].map(cell_rrid)
    sig["rrid_via"] = sig["cell_id"].map(cell_via)
    sig["chembl_id"] = sig["pert_id"].map(chem)
    write("lincs_signatures", sig.astype({c: "string" for c in sig.columns if sig[c].dtype == object}))


# ---------------------------------------------------------------------------
# NCBI GEO: the CRISPR screen watch list (detection stage of autonomous ingest)
# ---------------------------------------------------------------------------

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/"
GEO_QUERY = ('("CRISPR screen"[All Fields] OR "sgRNA library"[All Fields] OR "CRISPR knockout screen"[All Fields] '
             'OR "genome-wide CRISPR"[All Fields] OR "CRISPRi screen"[All Fields] OR "CRISPRa screen"[All Fields]) '
             'AND gse[Entry Type]')


def ingest_geo() -> None:
    """
    Every GEO series that describes a pooled CRISPR screen, with its SRA link
    and supplementary files, compared against the screens the Atlas already
    holds (by PubMed id). New rows are the queue a scheduled run would hand to
    FASTQ retrieval, counting and hit calling.
    """
    import pandas as pd

    ids = []
    start = 0
    while True:
        res = get_json(EUTILS + "esearch.fcgi", {"db": "gds", "term": GEO_QUERY, "retmode": "json",
                                                  "retmax": 500, "retstart": start})["esearchresult"]
        ids += res["idlist"]
        start += 500
        if start >= int(res["count"]):
            break
        time.sleep(0.4)
    print(f"  GEO: {len(ids):,} series match")
    rows = []
    for i in range(0, len(ids), 200):
        summ = get_json(EUTILS + "esummary.fcgi", {"db": "gds", "id": ",".join(ids[i:i + 200]),
                                                   "retmode": "json"})["result"]
        for uid in summ.get("uids", []):
            s = summ[uid]
            rel = s.get("extrelations") or []
            rows.append({
                "accession": s.get("accession"), "title": s.get("title"), "summary": (s.get("summary") or "")[:2000],
                "taxon": s.get("taxon"), "gds_type": s.get("gdstype"), "n_samples": int(s.get("n_samples") or 0),
                "pubmed_ids": ",".join(str(p) for p in (s.get("pubmedids") or [])),
                "submitted": s.get("pdat"), "platform": s.get("gpl"),
                "sra": ",".join(r.get("targetobject", "") for r in rel if r.get("relationtype") == "SRA"),
                "suppl_files": s.get("suppfile"), "ftp": s.get("ftplink"),
            })
        time.sleep(0.4)
    df = pd.DataFrame(rows).drop_duplicates("accession")

    # Compare with the Atlas by PubMed id: already-held screens are not new work.
    held = set()
    idx = REFERENCE_DIR / "orcs" / "atlas"
    try:
        import duckdb
        held = {str(p) for (p,) in duckdb.sql(
            f"select distinct cast(pmid as varchar) from read_parquet('{idx}/**/screens*.parquet')").fetchall()}
    except Exception:  # noqa: BLE001 - store layout differs between releases; count what we can
        pass
    df["in_atlas"] = df["pubmed_ids"].apply(lambda p: any(x in held for x in p.split(",") if x))
    df["has_raw_reads"] = df["sra"].str.len() > 0
    df["retrieved"] = TODAY
    print(f"  {df.has_raw_reads.sum():,} with SRA raw reads; {df.in_atlas.sum():,} already in the Atlas by PMID")
    write("geo_crispr_series", df)


# ---------------------------------------------------------------------------
# ENCODE functional characterization (CRISPR screens of regulatory elements)
# ---------------------------------------------------------------------------

def ingest_encode() -> None:
    import pandas as pd

    rows = []
    for kind in ("FunctionalCharacterizationExperiment", "FunctionalCharacterizationSeries"):
        res = get_json("https://www.encodeproject.org/search/", {
            "type": kind, "status": "released", "format": "json", "limit": "all",
            "field": ["accession", "assay_title", "description", "biosample_summary",
                      "lab.title", "date_released", "examined_loci.gene.symbol", "elements_references"]})
        for g in res.get("@graph", []):
            loci = g.get("examined_loci") or []
            rows.append({
                "kind": kind, "accession": g.get("accession"), "assay": g.get("assay_title"),
                "description": g.get("description"), "biosample": g.get("biosample_summary"),
                "lab": (g.get("lab") or {}).get("title"), "released": g.get("date_released"),
                "examined_genes": ",".join(sorted({(l.get("gene") or {}).get("symbol", "") for l in loci} - {""})),
            })
    df = pd.DataFrame(rows)
    print(f"  ENCODE: {len(df):,} functional characterization records")
    write("encode_functional_screens", df)


CONNECTORS = {
    "jump": ingest_jump, "perturbseq": ingest_perturbseq, "tahoe": ingest_tahoe,
    "scbasecount": ingest_scbasecount, "lincs": ingest_lincs, "geo": ingest_geo, "encode": ingest_encode,
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("sources", nargs="+", choices=[*CONNECTORS, "all"])
    ap.add_argument("--upload", action="store_true", help="push written datasets to R2")
    args = ap.parse_args()
    names = list(CONNECTORS) if "all" in args.sources else args.sources
    failed = []
    for name in names:
        print(f"\n[{name}]")
        started = time.time()
        before = set(lake.DATASETS)
        try:
            CONNECTORS[name]()
        except Exception as exc:  # noqa: BLE001 - one source failing must not stop the rest
            print(f"  FAILED: {type(exc).__name__}: {exc}")
            failed.append(name)
            continue
        print(f"  done in {time.time() - started:.0f}s")
        if args.upload:
            for ds in sorted(set(lake.DATASETS) - before) or []:
                print(f"  uploaded {ds}: {lake.upload_dataset(ds)} file(s)")
    if failed:
        print(f"\nFailed: {', '.join(failed)}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
