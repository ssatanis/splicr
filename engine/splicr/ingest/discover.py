"""
Discovery: find newly public studies that might be pooled CRISPR screens.

    python -m splicr.ingest discover --since 2026-09-01

Three archives, searched separately because none of them sees everything:

    GEO   E-utilities db=gds, entry type GSE, PDAT window. Most screens with a
          paper land here, and GEO's series summary is the best text to
          classify on.
    SRA   E-utilities db=sra, PDAT window. Catches NCBI submissions that never
          went through GEO (a bare BioProject with amplicon runs).
    ENA   Portal API, result=study, first_public window. The only way to see
          ENA- and DDBJ-brokered deposits (PRJEB / PRJDB), which NCBI mirrors
          late or with less text.

The same study usually turns up in two or three of them under different ids
(GSE145743 = PRJNA608032 = SRP250346), so `discover` collapses every candidate
that shares any of those ids into one, keeps the GSE when there is one (GEO is
where the design text and the sample characteristics live), otherwise the
BioProject, and merges the cross-references. Then every candidate is classified.

Queries are deliberately broad. A screen that never reaches the classifier is
lost silently; one that reaches it and is not a screen costs a line in a table.

HTTP etiquette: NCBI asks for tool/email on every request and allows 3 req/s
(10 with an API key, NCBI_API_KEY). ENA has no published limit; we stay well
under 10 req/s. 429 and 5xx are retried with exponential backoff, anything
else raises, because a silently empty page would look like "no new screens".
"""

from __future__ import annotations

import os
import re
import threading
import time
from datetime import date
from typing import Any, Iterable
from xml.etree import ElementTree as ET

import requests

from .models import StudyCandidate

NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ENA_PORTAL = "https://www.ebi.ac.uk/ena/portal/api"
TOOL = "splicr"
EMAIL = "ss4497@cornell.edu"

HUMAN, MOUSE = 9606, 10090
_TAXA_BY_NAME = {"homo sapiens": HUMAN, "mus musculus": MOUSE}

# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

_session = requests.Session()
_session.headers["User-Agent"] = f"{TOOL}/ingest (mailto:{EMAIL})"
_last_call: dict[str, float] = {}
_lock = threading.Lock()


def _min_interval(url: str) -> float:
    if "ncbi.nlm.nih.gov" in url:
        # NCBI's limit is per API key (or per IP without one), not per process:
        # 3 req/s bare, 10 with a key. Every planner container shares that one
        # budget, so the per-process interval is multiplied by however many may
        # run at once (SPLICR_NCBI_WORKERS, set to max_containers in modal_app).
        # Without this, N containers each pacing themselves at 10 req/s send
        # 10N req/s, and NCBI answers with 429s that cost more than they save.
        base = 0.11 if os.environ.get("NCBI_API_KEY") else 0.36
        return base * max(1, int(os.environ.get("SPLICR_NCBI_WORKERS", "1")))
    return 0.12


def _throttle(url: str) -> None:
    host = url.split("/")[2]
    with _lock:
        wait = _last_call.get(host, 0.0) + _min_interval(url) - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        _last_call[host] = time.monotonic()


def http_get(url: str, params: dict[str, Any] | None = None, *, method: str = "GET",
             timeout: float = 60, retries: int = 5) -> requests.Response:
    """
    GET (or POST) with polite throttling and retry on 429 / 5xx / connection errors.

    Raises on anything else. A 400 from E-utilities or ENA means the query is
    wrong, and treating it as "nothing found" would hide that forever.
    """
    params = dict(params or {})
    if "ncbi.nlm.nih.gov" in url and "eutils" in url:
        params.setdefault("tool", TOOL)
        params.setdefault("email", EMAIL)
        key = os.environ.get("NCBI_API_KEY")
        if key:
            params.setdefault("api_key", key)
    delay = 1.0
    last: Exception | None = None
    for attempt in range(retries):
        _throttle(url)
        try:
            if method == "POST":
                r = _session.post(url, data=params, timeout=timeout)
            else:
                r = _session.get(url, params=params, timeout=timeout)
        except (requests.ConnectionError, requests.Timeout) as e:
            last = e
        else:
            if r.status_code == 429 or r.status_code >= 500:
                last = requests.HTTPError(f"{r.status_code} from {url}", response=r)
                retry_after = r.headers.get("Retry-After")
                if retry_after and retry_after.isdigit():
                    delay = max(delay, float(retry_after))
            else:
                r.raise_for_status()
                return r
        if attempt < retries - 1:
            time.sleep(delay)
            delay *= 2
    raise RuntimeError(f"giving up on {url} after {retries} attempts: {last}")


def _eutils(endpoint: str, params: dict[str, Any], post: bool = False) -> requests.Response:
    return http_get(f"{NCBI_EUTILS}/{endpoint}.fcgi", params, method="POST" if post else "GET")


def _pdat(since: date, until: date | None) -> str:
    end = until or date.today()
    return f'("{since:%Y/%m/%d}"[PDAT] : "{end:%Y/%m/%d}"[PDAT])'


def _esearch_all(db: str, term: str, page: int = 500) -> list[str]:
    """Every UID matching `term`, paged, so a busy month is not truncated at retmax."""
    ids: list[str] = []
    start = 0
    while True:
        r = _eutils("esearch", {"db": db, "term": term, "retmode": "json",
                                "retmax": page, "retstart": start}).json()
        res = r["esearchresult"]
        if "ERROR" in res:
            raise RuntimeError(f"esearch {db}: {res['ERROR']}")
        batch = res.get("idlist", [])
        ids.extend(batch)
        start += len(batch)
        if not batch or start >= int(res.get("count", 0)):
            return ids


def _esummary(db: str, ids: list[str], batch: int = 200) -> list[dict]:
    docs: list[dict] = []
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        r = _eutils("esummary", {"db": db, "id": ",".join(chunk), "retmode": "json"},
                    post=True).json()
        result = r.get("result", {})
        for uid in result.get("uids", []):
            doc = result.get(uid)
            #  A uid that does not exist still comes back, as
            #  {"uid": ..., "error": "cannot get document summary"}. Returning
            #  that as a document made the caller read doc["accession"] off a
            #  dict that has no accession, so asking for a GSE that is not in
            #  GEO raised KeyError instead of saying it is not in GEO.
            if isinstance(doc, dict) and not doc.get("error"):
                docs.append(doc)
    return docs


# ---------------------------------------------------------------------------
# GEO
# ---------------------------------------------------------------------------

# Terms any pooled screen's series text is very likely to contain. Broad on
# purpose: this is the recall stage, the classifier is the precision stage.
GEO_TERMS = (
    '(CRISPR OR sgRNA OR sgRNAs OR "guide RNA" OR "guide RNAs" OR CRISPRi OR CRISPRa '
    'OR Cas9 OR Cas12a OR Cpf1 OR dCas9 OR "base editor" OR "knockout screen" OR '
    'Brunello OR GeCKO OR TKOv3 OR Avana OR Brie OR Dolcetto OR Calabrese OR MAGeCK)'
    ' AND (screen OR screens OR screening OR library OR libraries OR pooled OR '
    '"genome-wide" OR genomewide OR MAGeCK OR "guide counts" OR "sgRNA counts")'
)


def _geo_date(s: str | None) -> str | None:
    if not s:
        return None
    m = re.match(r"(\d{4})/(\d{2})/(\d{2})", s)
    return f"{m[1]}-{m[2]}-{m[3]}" if m else None


def _organism(names: Iterable[str]) -> tuple[str | None, int | None]:
    """
    Pick the study organism from GEO/SRA organism names.

    Screens are routinely filed as "synthetic construct" (the plasmid pool)
    next to the real organism, so that name is ignored when another is present.
    Human or mouse wins over anything else because those are the organisms the
    pipeline has libraries for; the classifier decides what to do with the rest.
    """
    clean = [n.strip() for n in names if n and n.strip()]
    real = [n for n in clean if n.lower() != "synthetic construct"] or clean
    for n in real:
        if n.lower() in _TAXA_BY_NAME:
            return n, _TAXA_BY_NAME[n.lower()]
    return (real[0], None) if real else (None, None)


def candidate_from_gds(doc: dict) -> StudyCandidate:
    """One GDS esummary document (entry type GSE) -> StudyCandidate."""
    acc = doc["accession"]
    xrefs: dict[str, str] = {"geo": acc}
    if doc.get("bioproject"):
        xrefs["bioproject"] = doc["bioproject"]
    for rel in doc.get("extrelations") or []:
        target = rel.get("targetobject") or ""
        if rel.get("relationtype") == "SRA" and re.fullmatch(r"[SED]RP\d+", target):
            xrefs["sra_study"] = target
    organism, taxid = _organism((doc.get("taxon") or "").split(";"))
    samples = doc.get("samples") or []
    return StudyCandidate(
        accession=acc,
        source="geo",
        title=doc.get("title") or "",
        summary=doc.get("summary") or "",
        organism=organism,
        taxid=taxid,
        xrefs=xrefs,
        pubmed_ids=[str(p) for p in doc.get("pubmedids") or []],
        first_public=_geo_date(doc.get("pdat")),
        n_runs=None,  # GEO counts samples, not runs; the run count comes from SRA/ENA
        sample_titles=[s.get("title", "") for s in samples][:400],
    )


def search_geo(since: date, until: date | None = None, terms: str = GEO_TERMS) -> list[StudyCandidate]:
    """GEO series (GSE) made public in [since, until] whose text matches `terms`."""
    ids = _esearch_all("gds", f"{terms} AND gse[ETYP] AND {_pdat(since, until)}")
    return [candidate_from_gds(d) for d in _esummary("gds", ids)
            if str(d.get("entrytype", "")).upper() == "GSE" and d.get("accession")]


def gds_summaries(accessions: list[str]) -> list[dict]:
    """GDS esummary documents for explicit GSE accessions (evaluation and `plan`)."""
    ids = []
    for acc in accessions:
        n = re.fullmatch(r"GSE(\d+)", acc)
        if n:
            ids.append(str(200000000 + int(n[1])))
    return _esummary("gds", ids)


# ---------------------------------------------------------------------------
# SRA
# ---------------------------------------------------------------------------

SRA_TERMS = (
    '("CRISPR screen"[All Fields] OR "CRISPR screening"[All Fields] OR '
    '"CRISPR screens"[All Fields] OR "sgRNA library"[All Fields] OR '
    '"guide RNA library"[All Fields] OR "knockout screen"[All Fields] OR '
    '"CRISPRi screen"[All Fields] OR "CRISPRa screen"[All Fields] OR '
    '"pooled screen"[All Fields] OR "genome-wide CRISPR"[All Fields] OR '
    'Brunello[All Fields] OR GeCKO[All Fields] OR TKOv3[All Fields] OR MAGeCK[All Fields])'
)


def _xml(fragment: str) -> ET.Element:
    """SRA esummary returns XML fragments without a root; wrap them."""
    return ET.fromstring(f"<r>{fragment}</r>")


def candidates_from_sra(docs: list[dict]) -> list[StudyCandidate]:
    """
    SRA experiment summaries -> one candidate per study.

    SRA is indexed per experiment, so a 40-run screen is 40 documents. They are
    grouped by SRA study and keyed by BioProject when there is one (the id the
    other archives share), else by the SRP.
    """
    by_study: dict[str, dict[str, Any]] = {}
    for d in docs:
        try:
            x = _xml(d.get("expxml", ""))
            runs = _xml(d.get("runs", ""))
        except ET.ParseError:
            continue
        study = x.find("Study")
        if study is None or not study.get("acc"):
            continue
        srp = study.get("acc")
        g = by_study.setdefault(srp, {"title": study.get("name") or "", "bioproject": None,
                                      "orgs": set(), "titles": [], "strategies": set(),
                                      "runs": 0, "created": None, "geo": False})
        bp = (x.findtext("Bioproject") or "").strip()
        if bp:
            g["bioproject"] = bp
        org = x.find("Organism")
        if org is not None:
            g["orgs"].add(org.get("ScientificName") or "")
        title = x.findtext("Summary/Title") or ""
        g["titles"].append(title)
        # GEO-brokered experiments are titled "GSMnnn: <sample title>; <organism>; <strategy>".
        if re.match(r"GSM\d+:", title):
            g["geo"] = True
        strat = x.findtext("Library_descriptor/LIBRARY_STRATEGY")
        if strat:
            g["strategies"].add(strat)
        g["runs"] += len(runs.findall("Run"))
        created = d.get("createdate")
        if created and (g["created"] is None or created < g["created"]):
            g["created"] = created

    out = []
    for srp, g in by_study.items():
        organism, taxid = _organism(g["orgs"])
        xrefs = {"sra_study": srp}
        if g["bioproject"]:
            xrefs["bioproject"] = g["bioproject"]
        acc = g["bioproject"] if g["bioproject"] and re.fullmatch(r"PRJ[EDN][A-Z]\d+", g["bioproject"]) else srp
        out.append(StudyCandidate(
            accession=acc, source="sra", title=g["title"], organism=organism, taxid=taxid,
            xrefs=xrefs, first_public=_geo_date(g["created"]), n_runs=g["runs"] or None,
            sample_titles=[re.sub(r"^GSM\d+:\s*", "", t).split(";")[0] for t in g["titles"]][:400],
            library_strategies=sorted(g["strategies"]),
        ))
    return out


def search_sra(since: date, until: date | None = None, terms: str = SRA_TERMS) -> list[StudyCandidate]:
    """SRA studies with CRISPR-screen experiments published in [since, until]."""
    ids = _esearch_all("sra", f"{terms} AND {_pdat(since, until)}")
    cands = candidates_from_sra(_esummary("sra", ids))
    # SRA summaries carry no abstract and no GSE id; ENA's study record has both.
    enrich_from_ena(cands)
    return cands


# ---------------------------------------------------------------------------
# ENA
# ---------------------------------------------------------------------------

ENA_STUDY_FIELDS = ("study_accession,secondary_study_accession,study_title,study_description,"
                    "first_public,last_updated,tax_id,scientific_name,geo_accession,center_name")

ENA_QUERY = ('(study_title="*CRISPR*" OR study_title="*sgRNA*" OR study_title="*guide RNA*" '
             'OR study_description="*CRISPR*screen*" OR study_description="*sgRNA*librar*" '
             'OR study_description="*CRISPR*librar*" OR study_description="*knockout screen*" '
             'OR study_description="*CRISPRi*" OR study_description="*CRISPRa*")')


def _ena_search(query: str, result: str = "study", fields: str = ENA_STUDY_FIELDS,
                limit: int = 0) -> list[dict]:
    r = http_get(f"{ENA_PORTAL}/search", {"result": result, "query": query, "fields": fields,
                                           "format": "json", "limit": limit}, method="POST")
    if not r.text.strip():
        return []   # ENA answers an empty result with an empty body, not []
    return r.json()


def candidate_from_ena(row: dict) -> StudyCandidate:
    prj = row["study_accession"]
    xrefs = {"bioproject": prj} if prj.startswith("PRJ") else {}
    sec = (row.get("secondary_study_accession") or "").split(";")[0].strip()
    if re.fullmatch(r"[SED]RP\d+", sec):
        xrefs["sra_study"] = sec
    geo = (row.get("geo_accession") or "").split(";")[0].strip()
    if re.fullmatch(r"GSE\d+", geo):
        xrefs["geo"] = geo
    taxid = int(row["tax_id"]) if str(row.get("tax_id") or "").isdigit() else None
    return StudyCandidate(
        accession=geo if "geo" in xrefs else prj,
        source="ena",
        title=row.get("study_title") or "",
        summary=row.get("study_description") or "",
        organism=row.get("scientific_name") or None,
        taxid=taxid,
        xrefs=xrefs,
        first_public=row.get("first_public") or None,
        last_updated=row.get("last_updated") or None,
    )


def search_ena(since: date, until: date | None = None, query: str = ENA_QUERY) -> list[StudyCandidate]:
    """ENA studies (incl. DDBJ/NCBI mirrors) first public in [since, until]."""
    q = f"first_public>={since:%Y-%m-%d}"
    if until:
        q += f" AND first_public<={until:%Y-%m-%d}"
    rows = _ena_search(f"{q} AND {query}")
    return [candidate_from_ena(r) for r in rows if r.get("study_accession")]


def enrich_from_ena(cands: list[StudyCandidate], batch: int = 40) -> None:
    """Fill summary, taxid and the GSE id of SRA-found studies from ENA's study records."""
    need = [c for c in cands if c.xrefs.get("bioproject")]
    for i in range(0, len(need), batch):
        chunk = need[i:i + batch]
        q = " OR ".join(f'study_accession="{c.xrefs["bioproject"]}"' for c in chunk)
        try:
            rows = _ena_search(q)
        except Exception:  # noqa: BLE001 - enrichment is best-effort; the SRA record stands
            continue
        by = {r["study_accession"]: r for r in rows}
        for c in chunk:
            r = by.get(c.xrefs["bioproject"])
            if not r:
                continue
            e = candidate_from_ena(r)
            c.summary = c.summary or e.summary
            c.title = c.title or e.title
            if c.taxid is None and e.taxid:
                c.taxid, c.organism = e.taxid, e.organism or c.organism
            if "geo" in e.xrefs:
                c.xrefs["geo"] = e.xrefs["geo"]
                c.accession = e.xrefs["geo"]


def fill_organism_from_runs(cands: list[StudyCandidate]) -> None:
    """
    Take the organism from a study's first run when the study record has none.

    ENA study records for umbrella and brokered projects often carry no tax_id,
    which let bacterial CRISPRi screens (E. coli, M. tuberculosis) through as
    "organism unknown". The runs always carry one.
    """
    for c in cands:
        if c.taxid is not None:
            continue
        acc = c.xrefs.get("bioproject") or c.xrefs.get("sra_study")
        if not acc:
            continue
        field = "study_accession" if acc.startswith("PRJ") else "secondary_study_accession"
        try:
            rows = _ena_search(f'{field}="{acc}"', result="read_run", fields="tax_id,scientific_name", limit=1)
        except Exception:  # noqa: BLE001 - best effort; the classifier notes the gap
            continue
        if rows and str(rows[0].get("tax_id") or "").isdigit():
            c.taxid = int(rows[0]["tax_id"])
            c.organism = rows[0].get("scientific_name") or c.organism


# ---------------------------------------------------------------------------
# De-duplication
# ---------------------------------------------------------------------------

def _ids(c: StudyCandidate) -> set[str]:
    return {c.accession, *[v for v in c.xrefs.values() if v]}


def _canonical(xrefs: dict[str, str], fallback: str) -> str:
    """GSE if the study is in GEO, else the BioProject, else the SRA/ENA study id."""
    if re.fullmatch(r"GSE\d+", xrefs.get("geo", "")):
        return xrefs["geo"]
    if re.fullmatch(r"PRJ[EDN][A-Z]\d+", xrefs.get("bioproject", "")):
        return xrefs["bioproject"]
    if re.fullmatch(r"[SED]RP\d+", xrefs.get("sra_study", "")):
        return xrefs["sra_study"]
    return fallback


_SOURCE_RANK = {"geo": 0, "sra": 1, "ena": 2}


def merge(cands: list[StudyCandidate]) -> list[StudyCandidate]:
    """
    Collapse candidates that share any accession into one.

    Union-find over every id a candidate carries, so GSE<->PRJNA (from GEO) and
    PRJNA<->SRP (from SRA) chain together even when no single record has all
    three. Text comes from the richest record: GEO's first, since its summary
    is written for humans; titles and strategies are unioned.
    """
    parent: dict[str, str] = {}

    def find(a: str) -> str:
        while parent.setdefault(a, a) != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for c in cands:
        ids = sorted(_ids(c))
        for other in ids[1:]:
            parent[find(other)] = find(ids[0])
    groups: dict[str, list[StudyCandidate]] = {}
    for c in cands:
        groups.setdefault(find(c.accession), []).append(c)

    out = []
    for members in groups.values():
        members.sort(key=lambda c: _SOURCE_RANK.get(c.source, 9))
        base = members[0]
        xrefs: dict[str, str] = {}
        for m in members:
            for k, v in m.xrefs.items():
                xrefs.setdefault(k, v)
        merged = StudyCandidate.from_dict(base.__dict__ | {"xrefs": xrefs})
        for m in members[1:]:
            merged.title = merged.title or m.title
            if len(m.summary or "") > len(merged.summary or "") and base.source != "geo":
                merged.summary = m.summary
            merged.organism = merged.organism or m.organism
            merged.taxid = merged.taxid or m.taxid
            merged.first_public = min(filter(None, [merged.first_public, m.first_public]), default=None)
            merged.last_updated = max(filter(None, [merged.last_updated, m.last_updated]), default=None)
            merged.n_runs = merged.n_runs or m.n_runs
            merged.pubmed_ids = sorted(set(merged.pubmed_ids) | set(m.pubmed_ids))
            if not merged.sample_titles:
                merged.sample_titles = m.sample_titles
            merged.library_strategies = sorted(set(merged.library_strategies) | set(m.library_strategies))
        merged.accession = _canonical(xrefs, merged.accession)
        out.append(merged)
    return out


def discover(since: date, until: date | None = None, *, classify_: bool = True,
             sources: tuple[str, ...] = ("geo", "sra", "ena")) -> list[StudyCandidate]:
    """Search every source, collapse duplicates, classify. Sorted best first."""
    from .classify import classify

    found: list[StudyCandidate] = []
    if "geo" in sources:
        found += search_geo(since, until)
    if "sra" in sources:
        found += search_sra(since, until)
    if "ena" in sources:
        found += search_ena(since, until)
    merged = merge(found)
    fill_organism_from_runs(merged)
    if classify_:
        merged = [classify(c) for c in merged]
    return sorted(merged, key=lambda c: (-c.score, c.accession))
