"""
The paralog layer: which genes are each other's duplicates, and how we know.

WHY A PINNED FILE AND NOT A LIVE LOOKUP

Paralogy is reference data. If the product asked Ensembl at request time, the same
gene would get different answers on different days, an old analysis could not be
reproduced, and - measured while this module was written - the Compara REST service
was answering 500 on its own metadata endpoints while still serving homology. So
the source of truth is a pinned Parquet built by scripts/data/build-paralogs.py.
A live query exists only inside that builder.

TWO CHANNELS, KEPT APART

    ensembl_compara   Ensembl's own paralogy call between two current Ensembl
                      genes, with the taxonomic level the duplication is placed at
                      and Ensembl's homology_type. Sequence-based.
    hgnc_gene_group   Two genes curated into the same HGNC gene group. Not a
                      sequence claim: a group can be a functional family whose
                      members are not each other's duplicates, and a real paralog
                      pair can be in no group at all.

They are stored as separate rows with separate provenance and never merged into one
score, because "Ensembl calls these paralogues" and "HGNC files these together" are
different statements and a reader deciding what to test next needs to see which one
they have. Agreement between them is itself evidence and is reported as such.

COVERAGE IS A FIRST-CLASS ANSWER

`paralogs_of` returns a Lookup, not a list. A gene the build never covered answers
`covered = False`, and every caller has to handle that separately from a gene that
was covered and has no paralog. Returning an empty list for both would let the
console print "no paralog" about a gene nobody looked up, which is the single most
misleading thing this module could do.
"""

from __future__ import annotations

import csv
import functools
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from ..config import ANNOTATION_DIR, REFERENCE_DIR

PARALOG_DIR = REFERENCE_DIR / "paralogs"
#: One Parquet per build, named for the channel and the release it came from, so
#: two releases can sit side by side and a report can say which it used.
ENSEMBL_PARALOGS = PARALOG_DIR / "ensembl_compara_human.parquet"
HGNC_GROUPS = PARALOG_DIR / "hgnc_gene_groups_human.parquet"
HGNC_SOURCE = ANNOTATION_DIR / "hgnc_complete_set.txt"

Channel = Literal["ensembl_compara", "hgnc_gene_group"]

#: Ensembl's own classification. `within_species_paralog` is a duplication inside
#: the human lineage; `other_paralog` is a duplication placed at an older node and
#: is therefore a weaker statement about functional interchangeability today.
ENSEMBL_TYPES = ("within_species_paralog", "other_paralog", "gene_split")

#: A gene group larger than this is not evidence of a specific relationship. HGNC
#: groups include "Zinc fingers" and "Immunoglobulin-like domain containing",
#: which hold hundreds of genes that share a motif and nothing else; a pair drawn
#: from one is not a candidate for compensating a knockout. The cut is stated on
#: every row rather than applied silently, so a reader can see what was excluded.
HGNC_GROUP_MAX = 25


@dataclass(frozen=True)
class Paralog:
    """One directed claim that `gene` has `paralog` as a duplicate."""

    gene: str
    paralog: str
    channel: Channel
    #: Ensembl's homology_type, or the HGNC group name.
    relation: str
    #: The taxonomic node Ensembl places the duplication at. Empty for HGNC.
    taxonomy_level: str = ""
    #: Percent identity, when the build recorded one. Empty is empty: the
    #: condensed Compara response does not carry it and it is not guessed.
    sequence_identity: float | None = None
    #: Members of the HGNC group this came from, when it came from one.
    group_size: int | None = None
    source: str = ""
    release: str = ""

    @property
    def strength(self) -> str:
        """
        How strong the relationship claim is, in words rather than a number.

        There is no calibrated scale here and inventing one would be worse than
        saying less: these are ordered labels for a reader, not a probability.
        """
        if self.channel == "ensembl_compara":
            if self.relation == "within_species_paralog":
                return "duplication within the human lineage"
            if self.relation == "gene_split":
                return "annotated gene split, not necessarily a functional duplicate"
            return f"duplication placed at {self.taxonomy_level or 'an older node'}"
        return f"curated into the same HGNC group ({self.relation})"


@dataclass(frozen=True)
class Lookup:
    """What the pinned build knows about one gene."""

    gene: str
    #: False when this gene is not in the build at all. Then `paralogs` is empty
    #: because nothing was looked up, which is not the same as nothing being found.
    covered: bool
    paralogs: tuple[Paralog, ...]
    #: The builds consulted, so a report can name its own references.
    releases: tuple[str, ...]
    note: str = ""

    def by_channel(self, channel: Channel) -> tuple[Paralog, ...]:
        return tuple(p for p in self.paralogs if p.channel == channel)

    @property
    def partners(self) -> tuple[str, ...]:
        return tuple(sorted({p.paralog for p in self.paralogs}))

    def agreeing(self) -> tuple[str, ...]:
        """Partners both channels name. Two independent sources, not one twice."""
        ensembl = {p.paralog for p in self.by_channel("ensembl_compara")}
        hgnc = {p.paralog for p in self.by_channel("hgnc_gene_group")}
        return tuple(sorted(ensembl & hgnc))


class Store:
    """The pinned paralog build, loaded once per process."""

    def __init__(self, ensembl: Path = ENSEMBL_PARALOGS, hgnc: Path = HGNC_GROUPS):
        self._paths = {"ensembl_compara": ensembl, "hgnc_gene_group": hgnc}
        self._rows: dict[str, list[Paralog]] = {}
        self._covered: set[str] = set()
        self._releases: list[str] = []
        self._load()

    def _load(self) -> None:
        import pandas as pd

        for channel, path in self._paths.items():
            if not path.exists():
                continue
            frame = pd.read_parquet(path)
            release = ""
            for row in frame.itertuples(index=False):
                release = str(row.release)
                identity = getattr(row, "sequence_identity", None)
                size = getattr(row, "group_size", None)
                paralog = Paralog(
                    gene=str(row.gene), paralog=str(row.paralog),
                    channel=channel,  # type: ignore[arg-type]
                    relation=str(row.relation),
                    taxonomy_level=str(getattr(row, "taxonomy_level", "") or ""),
                    sequence_identity=None if identity is None or identity != identity
                                      else float(identity),
                    group_size=None if size is None or size != size else int(size),
                    source=str(row.source), release=release,
                )
                # A gene with no partner is still recorded, as a self row, so
                # "covered and empty" is distinguishable from "not covered".
                self._covered.add(paralog.gene)
                if paralog.paralog and paralog.paralog != paralog.gene:
                    self._rows.setdefault(paralog.gene, []).append(paralog)
            if release:
                self._releases.append(f"{channel} {release}")

    @property
    def available(self) -> bool:
        return bool(self._covered)

    @property
    def releases(self) -> tuple[str, ...]:
        return tuple(self._releases)

    @property
    def n_genes(self) -> int:
        return len(self._covered)

    def lookup(self, gene: str) -> Lookup:
        key = str(gene).strip()
        if not self.available:
            return Lookup(key, False, (), self.releases,
                          "no paralog build is present; run scripts/data/build-paralogs.py")
        if key not in self._covered:
            return Lookup(key, False, (), self.releases,
                          "this gene is not in the pinned paralog build, so nothing was "
                          "looked up for it")
        found = tuple(sorted(self._rows.get(key, ()),
                             key=lambda p: (p.channel, p.paralog)))
        return Lookup(key, True, found, self.releases,
                      "" if found else "covered by the build, and no paralog was recorded")


@functools.lru_cache(maxsize=1)
def store() -> Store:
    return Store()


def paralogs_of(gene: str) -> Lookup:
    """The pinned build's answer for one canonical Ensembl gene id."""
    return store().lookup(gene)


# ---------------------------------------------------------------------------
# Building the pinned files
# ---------------------------------------------------------------------------

def hgnc_group_rows(path: Path = HGNC_SOURCE, max_group: int = HGNC_GROUP_MAX) -> list[dict]:
    """
    Every HGNC gene-group pair between two genes that carry an Ensembl id.

    Needs no network, so this channel works in any checkout that has the HGNC
    file, which is the one the harmonization gate already reads.

    Groups larger than `max_group` are dropped and the reason is recorded on the
    build rather than left implicit: a pair drawn from "Zinc fingers" shares a
    motif, not a function, and offering it as a compensation candidate would put
    hundreds of unrelated genes in front of a reader.
    """
    if not path.exists():
        raise FileNotFoundError(f"HGNC file not found: {path}")
    members: dict[tuple[str, str], set[str]] = {}
    release = ""
    with path.open(newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        for record in reader:
            ensembl = (record.get("ensembl_gene_id") or "").strip()
            if not ensembl.startswith("ENSG"):
                continue
            date = (record.get("date_modified") or "").strip()
            release = max(release, date)
            names = [n.strip() for n in (record.get("gene_group") or "").split("|") if n.strip()]
            ids = [i.strip() for i in (record.get("gene_group_id") or "").split("|") if i.strip()]
            for name, group_id in zip(names, ids):
                members.setdefault((group_id, name), set()).add(ensembl)

    rows: list[dict] = []
    source = f"HGNC complete set, gene groups (max {max_group} members)"
    for (group_id, name), genes in sorted(members.items()):
        if len(genes) > max_group or len(genes) < 2:
            continue
        ordered = sorted(genes)
        for gene in ordered:
            for other in ordered:
                if other == gene:
                    continue
                rows.append({
                    "gene": gene, "paralog": other, "relation": name,
                    "taxonomy_level": "", "sequence_identity": None,
                    "group_size": len(genes), "source": source,
                    "release": release or "unrecorded",
                })
    # Genes with an Ensembl id but no small group are recorded as covered-and-empty,
    # so the store can tell "looked up, nothing found" from "never looked up".
    grouped = {row["gene"] for row in rows}
    with path.open(newline="") as handle:
        for record in csv.DictReader(handle, delimiter="\t"):
            ensembl = (record.get("ensembl_gene_id") or "").strip()
            if ensembl.startswith("ENSG") and ensembl not in grouped:
                rows.append({
                    "gene": ensembl, "paralog": "", "relation": "", "taxonomy_level": "",
                    "sequence_identity": None, "group_size": None, "source": source,
                    "release": release or "unrecorded",
                })
    return rows


def write_rows(rows: list[dict], path: Path) -> Path:
    """Write one channel's build, atomically, with a stable column order."""
    import pandas as pd

    columns = ["gene", "paralog", "relation", "taxonomy_level",
               "sequence_identity", "group_size", "source", "release"]
    path.parent.mkdir(parents=True, exist_ok=True)
    frame = pd.DataFrame(rows, columns=columns)
    temporary = path.with_suffix(".parquet.tmp")
    frame.to_parquet(temporary, compression="zstd", index=False)
    temporary.replace(path)
    store.cache_clear()
    return path
