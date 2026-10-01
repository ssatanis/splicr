"""
Reading the evidence channels out of the reference lake.

Every function here answers one question about real data and reports whether it
could answer it. None of them substitutes a value for a missing one. The pattern
is the same throughout: a channel returns `None` when its source is absent and a
real value - including an empty one - when the source is present, so the evidence
model can tell "not looked up" from "looked up and nothing there".

The datasets are the ones the repository already builds:

    depmap_matrix   expression_tpm_log1p, gene_effect, copy_number_wgs,
                    mutation_damaging  (DepMap 26Q1, scripts/data/build-depmap-lake.py)
    kg_edges        IN_PATHWAY from Reactome and INTERACTS_WITH from STRING v12
                    (engine/splicr/graph.py)

WHAT "THE TARGET IS LOST" MEANS, AND WHY IT IS THREE THINGS

The conditional-dependency channel needs to split models into those where the
target is broken and those where it is intact. There is no single column for that,
and picking one would quietly change the question:

    damaging mutation   the gene is mutated in a way DepMap calls damaging
    deep deletion       relative copy number below the deletion cut
    not expressed       log1p(TPM) below the expressed cut

A model counts as lost when any of the three holds, and as intact only when none
does and all three were measured. A model that was not profiled for a channel is
in neither arm, because putting it in "intact" by default would dilute the
comparison with models whose state is unknown. The counts on both arms are
reported, and the report says which rules were applied.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass, field
from pathlib import Path

from .. import harmonize, lake
from ..config import REFERENCE_DIR

DEPMAP_RELEASE = "26Q1"

#: log1p(TPM) at or above which a gene counts as expressed. DepMap's convention.
EXPRESSED_LOG1P_TPM = 0.693
#: Relative copy number below which a gene counts as deeply deleted. DepMap's own
#: guidance treats values near zero as deletions; 0.3 is conservative.
DEEP_DELETION_CN = 0.3
#: STRING combined score, on the graph's 0-1 scale, above which an interaction is
#: reported. 0.7 is the score the knowledge graph was built at.
STRING_MIN_WEIGHT = 0.7


@dataclass(frozen=True)
class Sources:
    """Which lake datasets were found, so a report can say what it read."""

    expression: str = ""
    gene_effect: str = ""
    copy_number: str = ""
    mutation: str = ""
    graph: str = ""
    missing: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return bool(self.expression or self.gene_effect)


def _matrix(measure: str) -> Path:
    return (lake.LOCAL_LAKE / "depmap_matrix" / f"release={DEPMAP_RELEASE}"
            / f"measure={measure}" / "data_0.parquet")


def _graph() -> Path:
    return lake.LOCAL_LAKE / "kg_edges"


@functools.lru_cache(maxsize=1)
def sources() -> Sources:
    """What is on disk right now."""
    paths = {
        "expression": _matrix("expression_tpm_log1p"),
        "gene_effect": _matrix("gene_effect"),
        "copy_number": _matrix("copy_number_wgs"),
        "mutation": _matrix("mutation_damaging"),
    }
    found = {name: str(path) if path.exists() else "" for name, path in paths.items()}
    graph = _graph()
    found["graph"] = str(graph) if graph.exists() else ""
    return Sources(**found, missing=tuple(sorted(n for n, v in found.items() if not v)))


@functools.lru_cache(maxsize=20000)
def depmap_keys(gene: str) -> tuple[str, ...]:
    """
    The keys DepMap would file a canonical Ensembl gene under.

    The paralog build and the knowledge graph are keyed by Ensembl gene id, which
    is what the harmonization gate guarantees. The DepMap matrices are keyed by
    HGNC symbol and Entrez id, which is what DepMap ships. Handing an Ensembl id
    straight to a DepMap query matches nothing and, without this translation, every
    DepMap channel reported itself unavailable for every gene - which reads as "no
    data" and is really "wrong key".

    Returns the symbol and Entrez id when the gate can resolve them, and the input
    unchanged when it cannot, so a caller that already holds a symbol still works.
    """
    value = str(gene).strip()
    if not value:
        return ()
    if not value.upper().startswith("ENSG"):
        return (value,)
    try:
        resolution = harmonize.genes(harmonize.HUMAN).resolve(value)
    except (KeyError, ValueError):
        return (value,)
    if not resolution.ok:
        return (value,)
    keys = [resolution.label] if resolution.label else []
    entrez = resolution.xrefs.get("entrez_id")
    if entrez:
        keys.append(str(entrez))
    return tuple(dict.fromkeys(keys)) or (value,)


def _connect():
    import duckdb

    connection = duckdb.connect()
    connection.execute("set enable_progress_bar = false")
    connection.execute("set preserve_insertion_order = false")
    return connection


@dataclass(frozen=True)
class TargetState:
    """Which models have the target broken, and which demonstrably do not."""

    lost: frozenset[str] = frozenset()
    intact: frozenset[str] = frozenset()
    #: The rules that placed a model in `lost`, for the report.
    rules: tuple[str, ...] = ()
    #: Models excluded from both arms because a channel was not measured for them.
    unknown: int = 0
    available: bool = False
    note: str = ""


def target_state(gene: str) -> TargetState:
    """
    Split DepMap models on whether the target is broken.

    A model is `lost` when it carries a damaging mutation, a deep deletion, or no
    expression. It is `intact` only when all three were measured and none holds.
    Anything else is counted in `unknown` and used in neither arm.
    """
    found = sources()
    needed = ("expression", "copy_number", "mutation")
    if any(not getattr(found, name) for name in needed):
        return TargetState(
            available=False,
            note="the DepMap expression, copy-number and damaging-mutation matrices are "
                 "needed to say whether a model has the target broken; "
                 + ", ".join(n for n in needed if not getattr(found, n)) + " is absent")
    keys = list(depmap_keys(gene))
    if not keys:
        return TargetState(available=False, note=f"{gene} is not a resolvable gene identifier")
    connection = _connect()
    rows = connection.execute(
        """
        with e as (select model_id, value from read_parquet(?)
                    where gene_symbol = any(?) or entrez_id::varchar = any(?)),
             c as (select model_id, value from read_parquet(?)
                    where gene_symbol = any(?) or entrez_id::varchar = any(?)),
             m as (select model_id, value from read_parquet(?)
                    where gene_symbol = any(?) or entrez_id::varchar = any(?))
        select coalesce(e.model_id, c.model_id, m.model_id) as model_id,
               e.value as expression, c.value as copy_number, m.value as damaging
          from e full outer join c using (model_id) full outer join m using (model_id)
        """,
        [found.expression, keys, keys, found.copy_number, keys, keys,
         found.mutation, keys, keys],
    ).fetchall()
    if not rows:
        return TargetState(
            available=False,
            note=f"DepMap does not profile {gene} ({', '.join(keys)}) in any model")

    lost, intact, unknown = set(), set(), 0
    rules: set[str] = set()
    for model_id, expression, copy_number, damaging in rows:
        if model_id is None:
            continue
        if expression is None or copy_number is None or damaging is None:
            unknown += 1
            continue
        broken = []
        if damaging and float(damaging) > 0:
            broken.append("damaging mutation")
        if float(copy_number) < DEEP_DELETION_CN:
            broken.append(f"relative copy number below {DEEP_DELETION_CN}")
        if float(expression) < EXPRESSED_LOG1P_TPM:
            broken.append(f"log1p(TPM) below {EXPRESSED_LOG1P_TPM:.3f}")
        if broken:
            lost.add(str(model_id))
            rules.update(broken)
        else:
            intact.add(str(model_id))
    return TargetState(
        lost=frozenset(lost), intact=frozenset(intact),
        rules=tuple(sorted(rules)), unknown=unknown, available=True,
        note=(f"{len(lost)} models have the target broken, {len(intact)} demonstrably do "
              f"not, and {unknown} were not profiled on all three channels and are in "
              f"neither arm"))


def expression_in_model(genes: list[str], model_id: str) -> dict[str, float] | None:
    """log1p(TPM) for each gene in one model, or None when the matrix is absent."""
    found = sources()
    if not found.expression or not genes:
        return None
    # One query for every candidate, under every key DepMap might file it under,
    # and the answer comes back under the caller's own identifiers.
    by_key: dict[str, str] = {}
    for gene in genes:
        for key in depmap_keys(gene):
            by_key[key] = gene
    if not by_key:
        return {}
    keys = sorted(by_key)
    connection = _connect()
    rows = connection.execute(
        "select gene_symbol, entrez_id::varchar, value from read_parquet(?) "
        "where model_id = ? and (gene_symbol = any(?) or entrez_id::varchar = any(?))",
        [found.expression, model_id, keys, keys],
    ).fetchall()
    out: dict[str, float] = {}
    for symbol, entrez, value in rows:
        if value is None:
            continue
        for key in (symbol, entrez):
            gene = by_key.get(key)
            if gene is not None:
                out[gene] = float(value)
    return out


def gene_effect_by_model(gene: str) -> dict[str, float] | None:
    """Chronos gene effect for one gene across models, or None when absent."""
    found = sources()
    if not found.gene_effect:
        return None
    keys = list(depmap_keys(gene))
    if not keys:
        return {}
    connection = _connect()
    rows = connection.execute(
        "select model_id, value from read_parquet(?) "
        "where (gene_symbol = any(?) or entrez_id::varchar = any(?)) and value is not null",
        [found.gene_effect, keys, keys],
    ).fetchall()
    return {str(model): float(value) for model, value in rows} or {}


def shared_pathways(gene: str, other: str) -> tuple[str, ...] | None:
    """Reactome pathways both genes are annotated to, or None when absent."""
    found = sources()
    if not found.graph:
        return None
    connection = _connect()
    rows = connection.execute(
        """
        select distinct a.dst
          from read_parquet(? || '/**/*.parquet') a
          join read_parquet(? || '/**/*.parquet') b on b.dst = a.dst
         where a.type = 'IN_PATHWAY' and b.type = 'IN_PATHWAY'
           and a.src = ? and b.src = ?
         order by 1
        """,
        [found.graph, found.graph, gene, other],
    ).fetchall()
    return tuple(str(row[0]) for row in rows)


def interaction(gene: str, other: str) -> tuple[bool, float | None] | None:
    """
    Whether STRING records an interaction between the two, and its score.

    The graph stores one direction per pair (src < dst), so both orders are asked.
    """
    found = sources()
    if not found.graph:
        return None
    connection = _connect()
    row = connection.execute(
        """
        select max(weight) from read_parquet(? || '/**/*.parquet')
         where type = 'INTERACTS_WITH'
           and ((src = ? and dst = ?) or (src = ? and dst = ?))
        """,
        [found.graph, gene, other, other, gene],
    ).fetchone()
    weight = row[0] if row else None
    if weight is None:
        return False, None
    # Reported on STRING's own 0-1000 scale, which is what its users read.
    return float(weight) >= STRING_MIN_WEIGHT, round(float(weight) * 1000.0, 1)


@dataclass
class Evidence:
    """Everything read for one target, reused across its candidate paralogs."""

    target: str
    model_id: str = ""
    state: TargetState = field(default_factory=TargetState)
    #: Chronos effect by model, keyed by candidate gene.
    effects: dict[str, dict[str, float] | None] = field(default_factory=dict)
    expression: dict[str, float] | None = None
    sources: Sources = field(default_factory=Sources)

    def effect_for(self, candidate: str) -> dict[str, float] | None:
        if candidate not in self.effects:
            self.effects[candidate] = gene_effect_by_model(candidate)
        return self.effects[candidate]


def gather(target: str, candidates: list[str], model_id: str = "") -> Evidence:
    """Read every channel once for one target and its candidate paralogs."""
    return Evidence(
        target=target, model_id=model_id,
        state=target_state(target),
        expression=expression_in_model(candidates, model_id) if model_id else None,
        sources=sources(),
    )


def essential_effects(frame, gene_col: str, lfc_col: str, essential_symbols: set[str]
                      ) -> tuple[float, ...]:
    """
    This screen's own recorded effects for the reference essential genes.

    The scale the trigger judges "weak" against. Taken from the screen's own rows,
    never from another experiment, because depletion magnitude is a property of the
    library, timepoint and coverage as much as of the biology.
    """
    upper = {symbol.upper() for symbol in essential_symbols}
    out = []
    for gene, lfc in zip(frame[gene_col], frame[lfc_col]):
        if lfc is None or lfc != lfc:
            continue
        if str(gene).upper() in upper:
            out.append(float(lfc))
    return tuple(out)


#: The lake path is read once per process; tests that point it elsewhere clear this.
def reset_cache() -> None:
    sources.cache_clear()
    depmap_keys.cache_clear()


REFERENCE_NOTE = (
    f"DepMap {DEPMAP_RELEASE} (expression, Chronos gene effect, WGS copy number, "
    f"damaging mutations); STRING v12.0 and Reactome through the knowledge graph in "
    f"{REFERENCE_DIR.name}/lake"
)
