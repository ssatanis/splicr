"""
Entity harmonization: every gene, cell line and compound SplicR ingests is
hard-mapped to one standard identifier before it reaches a table.

    genes      Ensembl gene ID (ENSG... human, ENSMUSG... mouse, unversioned),
               validated against the Ensembl 116 GTF; the approved symbol
               (HGNC / MGI), HGNC or MGI ID and NCBI Gene ID ride along in xrefs
    cell lines Cellosaurus accession (the RRID, CVCL_xxxx)
    compounds  ChEMBL ID (salts and hydrates collapse to the parent)

THE GATE: `enforce`

    clean, quarantine = harmonize.enforce(frame, taxid=9606, gene_col="gene",
                                          cell_col=None, compound_col=None,
                                          min_rate=0.9)

Every ingest path must pass its frame through `enforce` before writing to a
database (Postgres, or a lake table a database or the app reads). It adds the
canonical columns (ensembl_gene_id + gene_symbol_approved, cell_line_rrid,
compound_chembl) for each column it is asked to map, and splits the frame:
`clean` holds rows where every requested mapping resolved; `quarantine` holds
every other row, unchanged, with a `quarantine_reason`. With `min_rate`, a
frame whose resolved fraction falls below it raises HarmonizationError instead
of being silently thinned: a dataset that mostly fails to map means the wrong
organism, the wrong column or a corrupted file, not a few retired symbols.
The Postgres side re-checks the result (atlas.screen_hits.ensembl_gene_id must
match '^ENS(MUS)?G[0-9]{11}$', and a trigger rejects reanalyzed-screen gene
rows without it).

WHY THIS IS STRICT

The failure it prevents is silent: ERBB2, HER2 and CD340 counted as three genes,
or "MCF7", "MCF-7" and "ACH-000019" as three cell lines, splits one signal three
ways and nothing downstream notices. So a resolver never guesses. An input that
matches more than one entity comes back `ambiguous` with every candidate, and an
input that matches nothing comes back `unresolved` with a `reason`; callers
decide what to do, and the ingest scripts count both so the gap is visible.

A gene resolves only to an Ensembl gene that exists in the Ensembl 116 GTF for
that species. An HGNC or MGI record whose Ensembl ID was retired, or that never
had one (many lncRNA, pseudogene and readthrough loci), is `unresolved` with
reason "no current Ensembl gene": no ID is ever fabricated or carried over from
an older release. A record whose NCBI entry lists more than one current Ensembl
gene is `ambiguous`.

Match precedence is fixed and reported on every result (`matched_by`):

    genes      ensembl > hgnc_id / mgi_id > entrez > approved symbol > previous symbol > alias
    cells      accession > DepMap ModelID > Sanger model id > name > synonym
    compounds  chembl id > InChIKey > preferred name > synonym / trade name

A higher-precedence unique match wins even when a lower one is ambiguous:
"CD340" is only ever an alias, but a symbol that is both one gene's approved
symbol and another's alias resolves to the approved one, as HGNC intends.
Gene inputs accepted: versioned or unversioned Ensembl IDs, HGNC:n / MGI:n,
NCBI Gene IDs, DepMap's "SYMBOL (entrez)" labels (the Entrez ID decides), and
symbols in any case.

SOURCES (all local, versioned under data/references)

    annotation/Homo_sapiens.GRCh38.116.chr.gtf.gz  Ensembl 116: which human gene IDs are current
    annotation/Mus_musculus.GRCm39.116.chr.gtf.gz  Ensembl 116: which mouse gene IDs are current
    annotation/hgnc_complete_set.txt              HGNC complete set (human symbols, Ensembl, Entrez)
    annotation/Mus_musculus.gene_info.gz          NCBI gene_info (mouse symbols, MGI, Ensembl, Entrez)
    cells/cellosaurus.txt                         Cellosaurus flat file
    opentargets/drug_molecule/*.parquet           ChEMBL molecules via Open Targets

The GTF gene table is parsed once (about a minute) and cached as
derived/ensembl116_genes_<taxid>.tsv, rebuilt whenever the GTF changes size.
"""

from __future__ import annotations

import functools
import gzip
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from .config import REFERENCE_DIR

ANNOTATION_DIR = REFERENCE_DIR / "annotation"
HGNC_PATH = ANNOTATION_DIR / "hgnc_complete_set.txt"
CELLOSAURUS_PATH = REFERENCE_DIR / "cells" / "cellosaurus.txt"
CHEMBL_PATH = REFERENCE_DIR / "opentargets" / "drug_molecule"

HUMAN, MOUSE = 9606, 10090
ENSEMBL_RELEASE = 116
ENSEMBL_SOURCE = f"Ensembl {ENSEMBL_RELEASE} GTF"
GTF_PATHS = {
    HUMAN: ANNOTATION_DIR / f"Homo_sapiens.GRCh38.{ENSEMBL_RELEASE}.chr.gtf.gz",
    MOUSE: ANNOTATION_DIR / f"Mus_musculus.GRCm39.{ENSEMBL_RELEASE}.chr.gtf.gz",
}
GENE_INFO_PATHS = {
    HUMAN: ANNOTATION_DIR / "Homo_sapiens.gene_info.gz",
    MOUSE: ANNOTATION_DIR / "Mus_musculus.gene_info.gz",
}
ENSEMBL_GENE_RE = {HUMAN: re.compile(r"ENSG\d{11}"), MOUSE: re.compile(r"ENSMUSG\d{11}")}
_ANY_ENSEMBL_GENE = re.compile(r"ENS[A-Z]*G\d{11}(\.\d+)?")

NO_CURRENT_ENSEMBL = "no current Ensembl gene"


class HarmonizationError(ValueError):
    """A frame failed the harmonization gate as a whole (resolved fraction below min_rate)."""


@dataclass(frozen=True)
class Resolution:
    """The outcome of resolving one input string."""

    query: str
    status: str                      # "resolved" | "ambiguous" | "unresolved"
    id: str | None = None            # ENSG/ENSMUSG, CVCL_xxxx or CHEMBLxxxx
    label: str | None = None         # approved symbol, cell line name, drug name
    matched_by: str | None = None
    xrefs: dict = field(default_factory=dict)
    candidates: tuple[str, ...] = ()
    reason: str | None = None        # why it is not resolved

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

_GTF_ATTR = re.compile(r'(gene_id|gene_version|gene_name|gene_biotype) "([^"]*)"')


def ensembl_genes(taxid: int = HUMAN) -> dict[str, dict]:
    """
    Every gene in the Ensembl 116 GTF for `taxid`: {gene_id: {version, name,
    biotype, chrom}}. This set is the authority for which Ensembl IDs are current.
    """
    gtf = GTF_PATHS[taxid]
    cache = REFERENCE_DIR / "derived" / f"ensembl{ENSEMBL_RELEASE}_genes_{taxid}.tsv"
    stamp = f"# source={gtf.name} bytes={gtf.stat().st_size}"
    if cache.exists():
        with open(cache, encoding="utf-8") as fh:
            if fh.readline().rstrip("\n") == stamp:
                out = {}
                fh.readline()
                for line in fh:
                    gid, ver, name, biotype, chrom = line.rstrip("\n").split("\t")
                    out[gid] = {"version": ver, "name": name, "biotype": biotype, "chrom": chrom}
                return out
    out = {}
    with gzip.open(gtf, "rt", encoding="utf-8") as fh:
        for line in fh:
            if line.startswith("#"):
                continue
            parts = line.split("\t", 8)
            if len(parts) < 9 or parts[2] != "gene":
                continue
            a = dict(_GTF_ATTR.findall(parts[8]))
            out[a["gene_id"]] = {"version": a.get("gene_version", ""), "name": a.get("gene_name", ""),
                                 "biotype": a.get("gene_biotype", ""), "chrom": parts[0]}
    cache.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache.with_suffix(".tmp")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(stamp + "\n" + "gene_id\tversion\tname\tbiotype\tchrom\n")
        for gid, r in sorted(out.items()):
            fh.write(f"{gid}\t{r['version']}\t{r['name']}\t{r['biotype']}\t{r['chrom']}\n")
    tmp.replace(cache)
    return out


class GeneResolver:
    """
    Resolve gene identifiers for one species to a current Ensembl gene ID.

    Human records come from HGNC (the nomenclature authority); mouse records
    from NCBI gene_info, whose Symbol is the MGI symbol and whose dbXrefs carry
    the MGI and Ensembl IDs. `records` is keyed by the authority ID (HGNC:n,
    MGI:n, or NCBIGene:n for the few mouse genes without an MGI ID) and each
    record's `ensembl_gene_id` is set only when that ID is in the Ensembl 116 GTF.
    """

    def __init__(self, taxid: int = HUMAN):
        if taxid not in GTF_PATHS:
            raise ValueError(f"no gene reference for taxid {taxid}; supported: {sorted(GTF_PATHS)}")
        self.taxid = taxid
        self.authority = "hgnc_id" if taxid == HUMAN else "mgi_id"
        self.SPACES = ["ensembl", self.authority, "entrez", "symbol", "prev_symbol", "alias"]
        self.current = ensembl_genes(taxid)
        self.records: dict[str, dict] = {}
        self.index = _Index(self.SPACES)
        self.by_ensembl: dict[str, list[str]] = defaultdict(list)
        if taxid == HUMAN:
            self._load_hgnc(HGNC_PATH)
        else:
            self._load_gene_info(GENE_INFO_PATHS[taxid])
        for aid, rec in self.records.items():
            listed = rec.pop("_ensembl_listed")
            live = sorted({e for e in listed if e in self.current})
            rec["ensembl_listed"] = tuple(sorted(set(listed)))
            rec["ensembl_candidates"] = tuple(live)
            rec["ensembl_gene_id"] = live[0] if len(live) == 1 else None
            for e in listed:
                self.index.add("ensembl", e, aid)
            for e in live:
                self.by_ensembl[e].append(aid)

    # -- loaders ------------------------------------------------------------

    def _add(self, aid: str, rec: dict, prev: list[str], aliases: list[str]) -> None:
        self.records[aid] = rec
        self.index.add(self.authority, aid.upper(), aid)
        if rec["entrez_id"]:
            self.index.add("entrez", rec["entrez_id"], aid)
        self.index.add("symbol", _norm_symbol(rec["symbol"]), aid)
        for p in prev:
            self.index.add("prev_symbol", _norm_symbol(p), aid)
        for a in aliases:
            self.index.add("alias", _norm_symbol(a), aid)

    def _load_hgnc(self, path: Path) -> None:
        import csv

        with open(path, newline="", encoding="utf-8") as fh:
            for row in csv.DictReader(fh, delimiter="\t"):
                if row.get("status") != "Approved":
                    continue
                hid = row["hgnc_id"]
                ens = (row.get("ensembl_gene_id") or "").strip().upper().split(".")[0]
                rec = {"hgnc_id": hid, "mgi_id": None, "symbol": row["symbol"],
                       "entrez_id": row.get("entrez_id") or None,
                       "locus_group": row.get("locus_group") or None,
                       "_ensembl_listed": [ens] if ens else []}
                split = lambda v: [x for x in (v or "").strip('"').split("|") if x]  # noqa: E731
                self._add(hid, rec, split(row.get("prev_symbol")), split(row.get("alias_symbol")))

    def _load_gene_info(self, path: Path) -> None:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            header = fh.readline().lstrip("#").rstrip("\n").split("\t")
            col = {c: i for i, c in enumerate(header)}
            for line in fh:
                f = line.rstrip("\n").split("\t")
                gtype = f[col["type_of_gene"]]
                if gtype == "biological-region":
                    continue
                xrefs = [x for x in f[col["dbXrefs"]].split("|") if x != "-"]
                mgi = next((x.split(":", 1)[1] for x in xrefs if x.startswith("MGI:")), None)
                ens = [x.split(":", 1)[1].upper().split(".")[0] for x in xrefs if x.startswith("Ensembl:")]
                official = f[col["Symbol_from_nomenclature_authority"]]
                symbol = official if official and official != "-" else f[col["Symbol"]]
                entrez = f[col["GeneID"]]
                aid = mgi or f"NCBIGene:{entrez}"
                rec = {"hgnc_id": None, "mgi_id": mgi, "symbol": symbol, "entrez_id": entrez,
                       "locus_group": gtype, "_ensembl_listed": ens}
                syn = [s for s in f[col["Synonyms"]].split("|") if s and s != "-"]
                if symbol != f[col["Symbol"]]:
                    syn.append(f[col["Symbol"]])
                self._add(aid, rec, [], syn)

    # -- resolution ---------------------------------------------------------

    def _xrefs(self, rec: dict | None, ensembl: str | None) -> dict:
        g = self.current.get(ensembl or "", {})
        return {
            "ensembl_gene_id": ensembl,
            "ensembl_gene_version": g.get("version"),
            "ensembl_biotype": g.get("biotype"),
            "ensembl_version_source": ENSEMBL_SOURCE,
            self.authority: rec[self.authority] if rec else None,
            "entrez_id": rec["entrez_id"] if rec else None,
        }

    def _resolved(self, q: str, ensembl: str, space: str, aids: list[str]) -> Resolution:
        # One Ensembl gene can carry two authority records (rare readthrough and
        # split-locus cases); the one whose symbol Ensembl itself uses is primary.
        recs = sorted((self.records[a] for a in aids), key=lambda r: r["symbol"])
        gname = self.current[ensembl]["name"]
        rec = next((r for r in recs if r["symbol"] == gname), recs[0] if recs else None)
        label = rec["symbol"] if rec else (gname or None)
        return Resolution(q, "resolved", ensembl, label, space, self._xrefs(rec, ensembl))

    def resolve(self, query: str | int) -> Resolution:
        q = str(query).strip()
        if not q or q.lower() in ("nan", "none", "-"):
            return Resolution(str(query), "unresolved", reason="empty")
        upper = q.upper()

        # Ensembl IDs are the canonical key: decided here, against the GTF.
        if _ANY_ENSEMBL_GENE.fullmatch(upper):
            ens = upper.split(".")[0]
            if not ENSEMBL_GENE_RE[self.taxid].fullmatch(ens):
                return Resolution(q, "unresolved", matched_by="ensembl",
                                  reason=f"Ensembl ID is not a taxid {self.taxid} gene")
            if ens in self.current:
                return self._resolved(q, ens, "ensembl", self.by_ensembl.get(ens, []))
            listed = self.index.maps["ensembl"].get(ens, set())
            rec = self.records[sorted(listed)[0]] if listed else None
            return Resolution(q, "unresolved", None, rec["symbol"] if rec else None, "ensembl",
                              self._xrefs(rec, None) if rec else {},
                              reason=f"{NO_CURRENT_ENSEMBL} ({ens} not in {ENSEMBL_SOURCE})")

        # "SYMBOL (1234)" is DepMap's column label; the Entrez id is decisive.
        m = re.fullmatch(r"(.+?)\s*\((\d+)\)", q)
        sym = _norm_symbol(m.group(1) if m else q)
        auth_prefix = "HGNC:" if self.taxid == HUMAN else "MGI:"
        keys = {
            self.authority: upper if upper.startswith(auth_prefix) else None,
            "entrez": m.group(2) if m else (q if q.isdigit() else None),
            "symbol": sym, "prev_symbol": sym, "alias": sym,
        }
        space, hits = self.index.lookup(keys)
        if not hits:
            return Resolution(q, "unresolved", reason="no match")
        recs = [self.records[h] for h in sorted(hits)]
        genes = {e for r in recs for e in (r["ensembl_candidates"] or (None,))}
        if genes == {None} and len(recs) == 1:
            rec = recs[0]
            listed = ", ".join(rec["ensembl_listed"]) or "none listed"
            return Resolution(q, "unresolved", None, rec["symbol"], space, self._xrefs(rec, None),
                              reason=f"{NO_CURRENT_ENSEMBL} ({self.authority.split('_')[0].upper()} "
                                     f"record {rec[self.authority] or rec['entrez_id']}: {listed})")
        if len(genes) == 1 and None not in genes:
            # Several records, one Ensembl gene: the same locus, not a choice.
            return self._resolved(q, next(iter(genes)), space, sorted(hits))
        cands = tuple(sorted({e or r[self.authority] or f"NCBIGene:{r['entrez_id']}"
                              for r in recs for e in (r["ensembl_candidates"] or (None,))}))
        return Resolution(q, "ambiguous", matched_by=space, candidates=cands,
                          reason=f"{len(cands)} genes match by {space}: "
                                 + ", ".join(sorted({r['symbol'] for r in recs})))

    # -- reporting ----------------------------------------------------------

    def coverage(self) -> dict:
        """How many authority records carry a current Ensembl gene, overall and protein-coding."""
        pc = "protein-coding gene" if self.taxid == HUMAN else "protein-coding"
        out = {}
        for label, recs in (("all", list(self.records.values())),
                            ("protein_coding", [r for r in self.records.values() if r["locus_group"] == pc])):
            n = len(recs)
            ok = sum(r["ensembl_gene_id"] is not None for r in recs)
            multi = sum(len(r["ensembl_candidates"]) > 1 for r in recs)
            retired = sum(bool(r["ensembl_listed"]) and not r["ensembl_candidates"] for r in recs)
            none = sum(not r["ensembl_listed"] for r in recs)
            out[label] = {"records": n, "resolved": ok, "rate": ok / max(n, 1),
                          "no_ensembl_listed": none, "ensembl_not_in_gtf": retired,
                          "multiple_current_ensembl": multi}
        # The other direction: of Ensembl's own protein-coding genes, how many
        # an authority record reaches (so a symbol or Entrez ID can find them).
        gtf_pc = [e for e, g in self.current.items() if g["biotype"] == "protein_coding"]
        reached = sum(e in self.by_ensembl for e in gtf_pc)
        out["ensembl_protein_coding"] = {"genes": len(gtf_pc), "reached_by_authority_record": reached,
                                         "rate": reached / max(len(gtf_pc), 1)}
        out["ensembl_genes_in_gtf"] = len(self.current)
        out["source"] = ENSEMBL_SOURCE
        return out


# ---------------------------------------------------------------------------
# Cell lines
# ---------------------------------------------------------------------------

class CellLineResolver:
    SPACES = ["accession", "depmap", "sanger", "name", "synonym"]

    def __init__(self, path: Path = CELLOSAURUS_PATH, human_only: bool = True, taxid: int | None = None):
        # taxid restricts the index to one species (9606 by default, as before);
        # human_only=False with no taxid indexes every species.
        self.taxid = str(taxid) if taxid is not None else ("9606" if human_only else None)
        self.records: dict[str, dict] = {}
        self.index = _Index(self.SPACES)
        entry: dict = {}
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if line.startswith("//"):
                    self._commit(entry)
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
        self._commit(entry)

    def _commit(self, e: dict) -> None:
        acc = e.get("accession")
        if not acc or (self.taxid and self.taxid not in e.get("taxids", [])):
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
        q = str(query).strip()
        if not q or q.lower() in ("nan", "none"):
            return Resolution(str(query), "unresolved", reason="empty")
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
            return Resolution(q, "unresolved", reason="no match")
        if len(hits) > 1:
            return Resolution(q, "ambiguous", matched_by=space, candidates=tuple(sorted(hits)),
                              reason=f"{len(hits)} cell lines match by {space}")
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
        q = str(query).strip()
        if not q or q.lower() in ("nan", "none"):
            return Resolution(str(query), "unresolved", reason="empty")
        upper = q.upper()
        keys = {
            "chembl": upper if upper.startswith("CHEMBL") else None,
            "inchikey": upper if re.fullmatch(r"[A-Z]{14}-[A-Z]{10}-[A-Z]", upper) else None,
            "name": _norm_name(q),
            "synonym": _norm_name(q),
        }
        space, hits = self.index.lookup(keys)
        if not hits:
            return Resolution(q, "unresolved", reason="no match")
        # Salts and hydrates are separate ChEMBL records under one parent
        # ("Gleevec" names both imatinib and imatinib mesylate). Perturbation
        # data are about the active moiety, so every form resolves to the parent;
        # the salt's own id is kept in xrefs.
        parents = {self.records[h]["parent"] for h in hits}
        if len(parents) > 1:
            return Resolution(q, "ambiguous", matched_by=space, candidates=tuple(sorted(hits)),
                              reason=f"{len(parents)} parent compounds match by {space}")
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


@functools.lru_cache(maxsize=None)
def _genes(taxid: int) -> GeneResolver:
    return GeneResolver(taxid)


@functools.lru_cache(maxsize=None)
def _cell_lines(taxid: int) -> CellLineResolver:
    return CellLineResolver(taxid=taxid)


def genes(taxid: int = HUMAN) -> GeneResolver:
    """The gene resolver for a species (9606 human, 10090 mouse); built once per process."""
    return _genes(int(taxid))


def cell_lines(taxid: int = HUMAN) -> CellLineResolver:
    """The Cellosaurus resolver restricted to one species; built once per process."""
    return _cell_lines(int(taxid))


@functools.lru_cache(maxsize=1)
def compounds() -> CompoundResolver:
    return CompoundResolver()


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

def _describe(r: Resolution) -> str:
    if r.status == "ambiguous":
        return f"ambiguous ({r.reason or ', '.join(r.candidates)})"
    return f"unresolved ({r.reason or 'no match'})"


def enforce(frame, *, taxid: int, gene_col: str | None = None, cell_col: str | None = None,
            compound_col: str | None = None, min_rate: float | None = None):
    """
    THE harmonization gate: call it on every frame before it is written to a database.

    For each requested column, resolves every distinct value once and adds the
    canonical column(s):

        gene_col      -> ensembl_gene_id, gene_symbol_approved   (genes(taxid))
        cell_col      -> cell_line_rrid                          (cell_lines(taxid))
        compound_col  -> compound_chembl                         (compounds())

    Returns (clean, quarantine). `clean` holds the rows where every requested
    mapping resolved; `quarantine` holds every other row with a
    `quarantine_reason` naming each failed column, its value and why ("gene
    'FOO': unresolved (no match)"). Nothing is dropped silently: len(clean) +
    len(quarantine) == len(frame).

    With `min_rate`, raises HarmonizationError when len(clean) / len(frame) is
    below it, with a per-column summary of failures and examples, so a
    malformed dataset is refused whole. An empty frame passes (rate 1.0).
    """
    import pandas as pd

    if not any((gene_col, cell_col, compound_col)):
        raise ValueError("enforce() needs at least one of gene_col, cell_col, compound_col")
    out = frame.copy()
    reasons = pd.Series([[] for _ in range(len(out))], index=out.index, dtype=object)
    summary: dict[str, Counter] = {}
    examples: dict[str, list[str]] = {}

    def run(col: str, kind: str, resolver, targets: dict[str, callable]) -> None:
        if col not in out.columns:
            raise KeyError(f"enforce(): column '{col}' not in frame")
        raw = out[col]
        cache: dict = {}
        for v in raw.dropna().unique():
            cache[v] = resolver.resolve(str(v))
        res = raw.map(lambda v: None if pd.isna(v) else cache.get(v))
        for name, fn in targets.items():
            out[name] = res.map(lambda r: fn(r) if r is not None and r.ok else None)
        counts: Counter = Counter()
        ex: list[str] = []
        for i, (v, r) in enumerate(zip(raw.tolist(), res.tolist())):
            if r is not None and r.ok:
                counts["resolved"] += 1
                continue
            why = "missing value" if r is None else _describe(r)
            counts["missing" if r is None else r.status] += 1
            reasons.iat[i].append(f"{kind} {v!r}: {why}")
            if len(ex) < 5 and r is not None and str(v) not in ex:
                ex.append(str(v))
        summary[f"{kind} ({col})"] = counts
        examples[f"{kind} ({col})"] = ex

    if gene_col:
        run(gene_col, "gene", genes(taxid),
            {"ensembl_gene_id": lambda r: r.id, "gene_symbol_approved": lambda r: r.label})
    if cell_col:
        run(cell_col, "cell line", cell_lines(taxid), {"cell_line_rrid": lambda r: r.id})
    if compound_col:
        run(compound_col, "compound", compounds(), {"compound_chembl": lambda r: r.id})

    bad = reasons.map(bool)
    clean = out[~bad].copy()
    quarantine = out[bad].copy()
    quarantine["quarantine_reason"] = reasons[bad].map("; ".join)
    rate = len(clean) / len(out) if len(out) else 1.0
    if min_rate is not None and rate < min_rate:
        lines = [f"harmonization gate refused the frame: {len(clean):,}/{len(out):,} rows resolved "
                 f"({rate:.1%}) < min_rate {min_rate:.1%} (taxid {taxid})"]
        for k, c in summary.items():
            lines.append(f"  {k}: " + ", ".join(f"{s} {n:,}" for s, n in c.most_common())
                         + (f"; e.g. {', '.join(examples[k])}" if examples[k] else ""))
        raise HarmonizationError("\n".join(lines))
    return clean, quarantine
