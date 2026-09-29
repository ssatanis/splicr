"""
Entity harmonization: every gene, cell line and compound SplicR ingests is
hard-mapped to one standard identifier before it reaches a table.

    genes      HGNC ID, with the Ensembl gene ID and NCBI Gene ID carried along
    cell lines Cellosaurus accession (the RRID, CVCL_xxxx)
    compounds  ChEMBL ID

WHY THIS IS STRICT

The failure it prevents is silent: ERBB2, HER2 and CD340 counted as three genes,
or "MCF7", "MCF-7" and "ACH-000019" as three cell lines, splits one signal three
ways and nothing downstream notices. So a resolver never guesses. An input that
matches more than one entity comes back `ambiguous` with every candidate, and an
input that matches nothing comes back `unresolved`; callers decide what to do,
and the ingest scripts count both so the gap is visible.

Match precedence is fixed and reported on every result (`matched_by`):

    genes      hgnc_id > ensembl > entrez > approved symbol > previous symbol > alias
    cells      accession > DepMap ModelID > Sanger model id > name > synonym
    compounds  chembl id > InChIKey > preferred name > synonym / trade name

A higher-precedence unique match wins even when a lower one is ambiguous:
"CD340" is only ever an alias, but a symbol that is both one gene's approved
symbol and another's alias resolves to the approved one, as HGNC intends.

SOURCES (all local, versioned under data/references)

    annotation/hgnc_complete_set.txt              HGNC complete set
    cells/cellosaurus.txt                         Cellosaurus flat file
    opentargets/drug_molecule/*.parquet           ChEMBL molecules via Open Targets
"""

from __future__ import annotations

import functools
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .config import REFERENCE_DIR

HGNC_PATH = REFERENCE_DIR / "annotation" / "hgnc_complete_set.txt"
CELLOSAURUS_PATH = REFERENCE_DIR / "cells" / "cellosaurus.txt"
CHEMBL_PATH = REFERENCE_DIR / "opentargets" / "drug_molecule"


@dataclass(frozen=True)
class Resolution:
    """The outcome of resolving one input string."""

    query: str
    status: str                      # "resolved" | "ambiguous" | "unresolved"
    id: str | None = None            # HGNC:xxxx, CVCL_xxxx or CHEMBLxxxx
    label: str | None = None         # approved symbol, cell line name, drug name
    matched_by: str | None = None
    xrefs: dict = field(default_factory=dict)
    candidates: tuple[str, ...] = ()

    @property
    def ok(self) -> bool:
        return self.status == "resolved"


class _Index:
    """Ordered key spaces; the first space with any hit decides the outcome."""

    def __init__(self, spaces: list[str]):
        self.spaces = spaces
        self.maps: dict[str, dict[str, set[str]]] = {s: defaultdict(set) for s in spaces}

    def add(self, space: str, key: str | None, entity: str) -> None:
        if key:
            self.maps[space][key].add(entity)

    def lookup(self, keys: dict[str, str]) -> tuple[str | None, set[str]]:
        for space in self.spaces:
            key = keys.get(space)
            if key and key in self.maps[space]:
                return space, self.maps[space][key]
        return None, set()


def _norm_symbol(s: str) -> str:
    return s.strip().upper()


def _norm_name(s: str) -> str:
    """Cell line and compound names: case, punctuation and spacing are noise."""
    return re.sub(r"[^A-Z0-9]", "", s.upper())


# ---------------------------------------------------------------------------
# Genes
# ---------------------------------------------------------------------------

class GeneResolver:
    SPACES = ["hgnc_id", "ensembl", "entrez", "symbol", "prev_symbol", "alias"]

    def __init__(self, path: Path = HGNC_PATH):
        import csv

        self.records: dict[str, dict] = {}
        self.index = _Index(self.SPACES)
        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if row.get("status") != "Approved":
                    continue
                hid = row["hgnc_id"]
                rec = {
                    "hgnc_id": hid,
                    "symbol": row["symbol"],
                    "ensembl_gene_id": row.get("ensembl_gene_id") or None,
                    "entrez_id": row.get("entrez_id") or None,
                    "locus_group": row.get("locus_group") or None,
                }
                self.records[hid] = rec
                self.index.add("hgnc_id", hid.upper(), hid)
                self.index.add("ensembl", (rec["ensembl_gene_id"] or "").upper() or None, hid)
                self.index.add("entrez", rec["entrez_id"], hid)
                self.index.add("symbol", _norm_symbol(rec["symbol"]), hid)
                for prev in filter(None, (row.get("prev_symbol") or "").strip('"').split("|")):
                    self.index.add("prev_symbol", _norm_symbol(prev), hid)
                for alias in filter(None, (row.get("alias_symbol") or "").strip('"').split("|")):
                    self.index.add("alias", _norm_symbol(alias), hid)

    def resolve(self, query: str | int) -> Resolution:
        q = str(query).strip()
        if not q:
            return Resolution(str(query), "unresolved")
        upper = q.upper()
        # "SYMBOL (1234)" is DepMap's column label; the Entrez id is decisive.
        m = re.fullmatch(r"(.+?)\s*\((\d+)\)", q)
        keys = {
            "hgnc_id": upper if upper.startswith("HGNC:") else None,
            "ensembl": upper.split(".")[0] if upper.startswith("ENSG") else None,
            "entrez": m.group(2) if m else (q if q.isdigit() else None),
            "symbol": _norm_symbol(m.group(1) if m else q),
            "prev_symbol": _norm_symbol(m.group(1) if m else q),
            "alias": _norm_symbol(m.group(1) if m else q),
        }
        space, hits = self.index.lookup(keys)
        if not hits:
            return Resolution(q, "unresolved")
        if len(hits) > 1:
            return Resolution(q, "ambiguous", matched_by=space,
                              candidates=tuple(sorted(self.records[h]["symbol"] for h in hits)))
        rec = self.records[next(iter(hits))]
        return Resolution(
            q, "resolved", rec["hgnc_id"], rec["symbol"], space,
            {"ensembl_gene_id": rec["ensembl_gene_id"], "entrez_id": rec["entrez_id"]},
        )


# ---------------------------------------------------------------------------
# Cell lines
# ---------------------------------------------------------------------------

class CellLineResolver:
    SPACES = ["accession", "depmap", "sanger", "name", "synonym"]

    def __init__(self, path: Path = CELLOSAURUS_PATH, human_only: bool = True):
        self.records: dict[str, dict] = {}
        self.index = _Index(self.SPACES)
        entry: dict = {}
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("//"):
                    self._commit(entry, human_only)
                    entry = {}
                    continue
                tag, _, value = line.rstrip("\n").partition("   ")
                if tag == "ID":
                    entry["name"] = value
                elif tag == "AC":
                    entry["accession"] = value
                elif tag == "SY":
                    entry["synonyms"] = [s.strip() for s in value.split(";") if s.strip()]
                elif tag == "OX":
                    entry.setdefault("taxids", []).append(value.split(";")[0].replace("NCBI_TaxID=", ""))
                elif tag == "CA":
                    entry["category"] = value
                elif tag == "DR":
                    db, _, ref = value.partition("; ")
                    if db == "DepMap":
                        entry.setdefault("depmap", []).append(ref.strip())
                    elif db == "Cell_Model_Passport":
                        entry.setdefault("sanger", []).append(ref.strip())
        self._commit(entry, human_only)

    def _commit(self, e: dict, human_only: bool) -> None:
        acc = e.get("accession")
        if not acc or (human_only and "9606" not in e.get("taxids", [])):
            return
        self.records[acc] = {
            "rrid": acc, "name": e.get("name"), "category": e.get("category"),
            "depmap_ids": e.get("depmap", []), "sanger_ids": e.get("sanger", []),
        }
        self.index.add("accession", acc.upper(), acc)
        for d in e.get("depmap", []):
            self.index.add("depmap", d.upper(), acc)
        for s in e.get("sanger", []):
            self.index.add("sanger", s.upper(), acc)
        self.index.add("name", _norm_name(e.get("name") or ""), acc)
        for syn in e.get("synonyms", []):
            self.index.add("synonym", _norm_name(syn), acc)

    def resolve(self, query: str) -> Resolution:
        q = query.strip()
        if not q:
            return Resolution(query, "unresolved")
        upper = q.upper().replace("RRID:", "")
        keys = {
            "accession": upper if upper.startswith("CVCL_") else None,
            "depmap": upper if upper.startswith("ACH-") else None,
            "sanger": upper if upper.startswith("SIDM") else None,
            "name": _norm_name(q),
            "synonym": _norm_name(q),
        }
        space, hits = self.index.lookup(keys)
        if not hits:
            return Resolution(q, "unresolved")
        if len(hits) > 1:
            return Resolution(q, "ambiguous", matched_by=space, candidates=tuple(sorted(hits)))
        rec = self.records[next(iter(hits))]
        return Resolution(
            q, "resolved", rec["rrid"], rec["name"], space,
            {"depmap_ids": rec["depmap_ids"], "sanger_ids": rec["sanger_ids"]},
        )


# ---------------------------------------------------------------------------
# Compounds
# ---------------------------------------------------------------------------

class CompoundResolver:
    """
    ChEMBL molecules that Open Targets carries (drugs and clinical candidates).
    Screening-library compounds that never reached a trial are mostly absent;
    `resolve_inchikeys_online` fills those from the ChEMBL web service.
    """

    SPACES = ["chembl", "inchikey", "name", "synonym"]

    def __init__(self, path: Path = CHEMBL_PATH):
        import duckdb

        self.records: dict[str, dict] = {}
        self.index = _Index(self.SPACES)
        rows = duckdb.sql(
            f"select id, name, inchiKey, parentId, "
            f"list_transform(coalesce(synonyms, []) || coalesce(tradeNames, []), x -> x.label) "
            f"from read_parquet('{path}/**/*.parquet')"
        ).fetchall()
        for cid, name, inchikey, parent, syns in rows:
            self.records[cid] = {"chembl_id": cid, "name": name, "inchikey": inchikey,
                                 "parent": parent or cid}
            self.index.add("chembl", cid.upper(), cid)
            self.index.add("inchikey", (inchikey or "").upper() or None, cid)
            self.index.add("name", _norm_name(name or ""), cid)
            for s in syns or []:
                self.index.add("synonym", _norm_name(s), cid)

    def resolve(self, query: str) -> Resolution:
        q = query.strip()
        if not q:
            return Resolution(query, "unresolved")
        upper = q.upper()
        keys = {
            "chembl": upper if upper.startswith("CHEMBL") else None,
            "inchikey": upper if re.fullmatch(r"[A-Z]{14}-[A-Z]{10}-[A-Z]", upper) else None,
            "name": _norm_name(q),
            "synonym": _norm_name(q),
        }
        space, hits = self.index.lookup(keys)
        if not hits:
            return Resolution(q, "unresolved")
        # Salts and hydrates are separate ChEMBL records under one parent
        # ("Gleevec" names both imatinib and imatinib mesylate). Perturbation
        # data are about the active moiety, so every form resolves to the parent;
        # the salt's own id is kept in xrefs.
        parents = {self.records[h]["parent"] for h in hits}
        if len(parents) > 1:
            return Resolution(q, "ambiguous", matched_by=space, candidates=tuple(sorted(hits)))
        parent = next(iter(parents))
        rec = self.records.get(parent) or self.records[next(iter(hits))]
        forms = sorted(h for h in hits if h != rec["chembl_id"])
        return Resolution(q, "resolved", rec["chembl_id"], rec["name"],
                          space if not forms else f"{space}->parent",
                          {"inchikey": rec["inchikey"], "salt_forms": forms})


def resolve_inchikeys_online(inchikeys: list[str], batch: int = 50) -> dict[str, str]:
    """InChIKey -> ChEMBL ID from the ChEMBL web service, for keys not held locally."""
    import json
    import time
    import urllib.parse
    import urllib.request

    out: dict[str, str] = {}
    keys = sorted({k.upper() for k in inchikeys if k})
    for i in range(0, len(keys), batch):
        chunk = keys[i:i + batch]
        url = (
            "https://www.ebi.ac.uk/chembl/api/data/molecule.json?limit=1000&"
            + urllib.parse.urlencode({"molecule_structures__standard_inchi_key__in": ",".join(chunk)})
            + "&only=molecule_chembl_id,molecule_structures"
        )
        for attempt in range(3):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:
                    data = json.load(resp)
                break
            except Exception:  # noqa: BLE001 - transient network errors retry
                time.sleep(2 ** attempt)
        else:
            continue
        for mol in data.get("molecules", []):
            key = ((mol.get("molecule_structures") or {}).get("standard_inchi_key") or "").upper()
            if key and key not in out:
                out[key] = mol["molecule_chembl_id"]
    return out


@functools.lru_cache(maxsize=1)
def genes() -> GeneResolver:
    return GeneResolver()


@functools.lru_cache(maxsize=1)
def cell_lines() -> CellLineResolver:
    return CellLineResolver()


@functools.lru_cache(maxsize=1)
def compounds() -> CompoundResolver:
    return CompoundResolver()
