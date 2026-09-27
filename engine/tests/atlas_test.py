#!/usr/bin/env python
"""
Tests for the ORCS parser and the Atlas.

Everything here runs against the REAL BioGRID ORCS 2.0.18 archive and the real
ingested store. Nothing is synthesised, with one deliberate exception: the
malformed inputs, which are constructed on purpose because BioGRID does not
ship broken files and the parser still has to refuse them rather than produce
a wrong number.

    export SPLICR_REFERENCE_DIR=.../data/references
    python engine/tests/atlas_test.py

Every expected count below is the measured value from a full pass over
data/references/orcs/orcs-human.tar.gz, cross-checked against the archive's
own screen index (SCORES_SIZE sums to 26,333,098 rows, NUMBER_OF_HITS to
1,777,315). If one of these fails, either the release changed or the parser
started dropping rows.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from splicr import orcs                                                  # noqa: E402
from splicr.atlas import (                                               # noqa: E402
    MIN_SCREENS_FOR_FREQUENT_HITTER, AtlasStore, GeneAccumulator, atlas_context,
    comparability, invert_aliases, mask_from_positions, mask_to_int, popcount,
    wilson_lower_95,
)

# Measured from release 2.0.18. See the module docstring.
N_SCREENS = 1952
N_RAW_ROWS = 26_333_098
N_RAW_HITS = 1_777_315
N_HIT_LIST_ONLY = 141
N_BACKGROUND = 1413
N_SYMBOLS = 87_540
N_DUPLICATE_GROUPS = 60_162
N_DUPLICATE_ROWS = 150_271
N_DISAGREEING_GROUPS = 6_522

failures: list[str] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {label}{(' :: ' + detail) if detail else ''}")
    if not ok:
        failures.append(f"{label}{(' :: ' + detail) if detail else ''}")


# ---------------------------------------------------------------------------

def check_null_and_number_parsing() -> None:
    print("\nnull and number parsing")
    check(orcs._text("-") is None, "'-' is the null, not a value")
    check(orcs._text("  HeLa  ") == "HeLa", "whitespace is stripped")
    check(orcs._number("-") is None, "'-' in a SCORE column is None, not 0.0")
    check(orcs._number("NA") is None, "'NA' is None, not 0.0")
    check(orcs._number("0.0") == 0.0, "a real zero survives as a measurement")
    check(orcs._number("2.25e-13") == 2.25e-13, "scientific notation parses")
    check(orcs._boolean("Yes") is True and orcs._boolean("No") is False, "Yes/No")
    check(orcs._boolean("maybe") is None, "an unrecognised Yes/No value is unknown, not False")
    check(orcs._year("Wang T (2014)") == 2014, "year comes out of AUTHOR")
    check(orcs.normalise_cell_line("K-562") == orcs.normalise_cell_line("K562") == "K562",
          "cell-line punctuation is collapsed so BioGRID and a lab agree")


def check_index() -> dict[int, orcs.OrcsScreen]:
    print("\nscreen index")
    index = orcs.read_index()
    check(len(index) == N_SCREENS, f"{N_SCREENS} human screens", str(len(index)))
    check(sum(s.scores_size or 0 for s in index.values()) == N_RAW_ROWS,
          f"SCORES_SIZE sums to {N_RAW_ROWS:,}")
    check(sum(s.number_of_hits or 0 for s in index.values()) == N_RAW_HITS,
          f"NUMBER_OF_HITS sums to {N_RAW_HITS:,}")
    check(sum(1 for s in index.values() if s.is_hit_list_only) == N_HIT_LIST_ONLY,
          f"{N_HIT_LIST_ONLY} hit-list-only deposits")
    check(sum(1 for s in index.values() if s.usable_background) == N_BACKGROUND,
          f"{N_BACKGROUND} usable as a genome-wide background")
    check(all(s.organism_id == 9606 for s in index.values()),
          "every screen is human, no contamination")
    check(all(s.modality is not None for s in index.values()),
          "every LIBRARY_TYPE maps to a public.modality value")
    check(index[1].modality == "knockout" and index[1].pmid == "24336569",
          "screen 1 is CRISPRn knockout from PMID 24336569")
    # A hit-list-only deposit must not also be counted as a background.
    hlo = [s for s in index.values() if s.is_hit_list_only]
    check(not any(s.usable_background for s in hlo),
          "no hit-list-only deposit is ever a background screen")
    return index


def check_screen_parsing(index: dict[int, orcs.OrcsScreen]) -> None:
    print("\nper-screen files from the real archive")
    # 1246 is a knockout screen with UNKNOWN and AMBIGUOUS identifier rows;
    # 5 is CRISPRi, where TSS-level duplicates disagree on HIT; 25 is a
    # hit-list-only deposit.
    tables = {t.screen_id: t for t in
              orcs.iter_archive_tables(orcs.archive_path(), screen_ids=[1, 5, 25, 1246])}
    check(set(tables) == {1, 5, 25, 1246}, "all four requested screens came back")

    for sid, t in sorted(tables.items()):
        expected = index[sid].scores_size
        check(t.n_raw_rows == expected,
              f"screen {sid} row count matches the index", f"{t.n_raw_rows} vs {expected}")

    t = tables[1246]
    check(t.identifier_types.get("UNKNOWN", 0) == 795,
          "screen 1246 has 795 UNKNOWN identifier rows")
    unknown = next(g for g in t.genes if g.identifier_type == "UNKNOWN")
    check(unknown.entrez_id is None,
          "an UNKNOWN row's synthetic '<n>U' id is not returned as an Entrez id",
          f"identifier_id={unknown.identifier_id}")
    entrez = next(g for g in t.genes if g.identifier_type == "ENTREZ_GENE")
    check(isinstance(entrez.entrez_id, int), "an ENTREZ_GENE row does return an Entrez id")

    t5 = tables[5]
    dup = next(g for g in t5.genes if g.n_rows > 1 and g.disagreed)
    check(dup.is_hit is True,
          "a TSS group where one TSS hit collapses to a hit",
          f"{dup.symbol} n_rows={dup.n_rows}")
    check(t5.n_disagreeing_groups == 2, "screen 5 has 2 self-disagreeing groups",
          str(t5.n_disagreeing_groups))

    t25 = tables[25]
    check(t25.n_genes == t25.n_hits == 100,
          "a hit-list-only deposit is 100% hits, which is why it is not a background")

    # Collapse must never invent a hit that no row carried.
    t1 = tables[1]
    check(t1.n_hits == 5 - 0, "screen 1 keeps its 5 hits through collapse", str(t1.n_hits))
    check(all(g.score1 is not None or g.n_rows > 0 for g in t1.genes),
          "no gene lost its score to the collapse")


def check_malformed_input() -> None:
    print("\nmalformed input is refused, not guessed at")
    good_header = "\t".join("#" + c if i == 0 else c
                            for i, c in enumerate(orcs.SCREEN_COLUMNS))

    try:
        orcs.parse_screen_text("", 1)
        check(False, "an empty file raises OrcsFormatError")
    except orcs.OrcsFormatError:
        check(True, "an empty file raises OrcsFormatError")

    try:
        orcs.parse_screen_text("a\tb\tc\n1\t2\t3\n", 1)
        check(False, "a file with the wrong columns raises")
    except orcs.OrcsFormatError as exc:
        check("missing" in str(exc), "a file with the wrong columns raises and names them",
              str(exc)[:70])

    # A row short of columns must be counted, not read one column over. With
    # HIT missing, a naive parser reads SCORE.5 as the hit call.
    short = good_header + "\n" + "\t".join(["1", "10", "ENTREZ_GENE", "AAA", "-",
                                            "9606", "Homo sapiens", "1.0"]) + "\n"
    t = orcs.parse_screen_text(short, 1)
    check(t.n_dropped_short_row == 1 and t.n_genes == 0,
          "a row short of columns is dropped and counted, never read off by one")

    # A row with no symbol cannot be keyed, so it is dropped and counted.
    nosym = good_header + "\n" + "\t".join(["1", "10", "ENTREZ_GENE", "-", "-", "9606",
                                            "Homo sapiens", "1.0", "-", "-", "-", "-",
                                            "YES", "BioGRID ORCS"]) + "\n"
    t = orcs.parse_screen_text(nosym, 1)
    check(t.n_dropped_no_symbol == 1 and t.n_genes == 0,
          "a row with no OFFICIAL_SYMBOL is dropped and counted")

    # Blank lines and a trailing newline must not create phantom rows.
    body = "\t".join(["1", "10", "ENTREZ_GENE", "AAA", "B|C", "9606", "Homo sapiens",
                      "-1.5", "-", "-", "-", "-", "YES", "BioGRID ORCS"])
    t = orcs.parse_screen_text(good_header + "\n\n" + body + "\n\n", 1)
    check(t.n_raw_rows == 1 and t.n_genes == 1 and t.genes[0].is_hit,
          "blank lines do not become rows")
    check(t.genes[0].aliases == ("B", "C"), "pipe-separated aliases are split")


def check_collapse_rule() -> None:
    print("\nduplicate collapse rule")
    def row(hit: bool, s1: float | None, ident: str) -> orcs.OrcsGene:
        return orcs.OrcsGene(screen_id=1, symbol="G", identifier_id=ident,
                             identifier_type="ENTREZ_GENE", is_hit=hit, scores=(s1,))

    merged = orcs.collapse_rows([row(False, -1.0, "a"), row(True, -0.2, "b")])
    check(merged.is_hit and merged.score1 == -0.2 and merged.disagreed,
          "the hit row wins even when a non-hit row has a bigger score, and disagreement "
          "is recorded")

    merged = orcs.collapse_rows([row(True, -0.2, "a"), row(True, -9.0, "b")])
    check(merged.score1 == -9.0 and not merged.disagreed,
          "among hit rows the largest magnitude wins; agreement is not flagged")

    merged = orcs.collapse_rows([row(False, None, "a"), row(False, -3.0, "b")])
    check(merged.score1 == -3.0,
          "a row with a measurement is preferred over a row with none")

    merged = orcs.collapse_rows([row(False, -1.0, "b"), row(False, -1.0, "a")])
    check(merged.identifier_id == "a", "ties break on the identifier, not on file order")

    single = row(True, 1.0, "a")
    check(orcs.collapse_rows([single]) is single and single.n_rows == 1,
          "a single row is returned untouched")


def check_bitmaps() -> None:
    print("\nbitmap arithmetic")
    m = mask_to_int(mask_from_positions([0, 3, 1412], 1413))
    check(popcount(m) == 3, "three bits set")
    check(m & (1 << 1412) and not m & (1 << 1411), "the last bit lands in the right place")
    check(popcount(m & ~(1 << 3)) == 2, "clearing a bit removes exactly one")
    check(mask_to_int(b"") == 0 and mask_to_int(None) == 0, "an empty mask is zero")
    check(round(wilson_lower_95(1, 1), 3) == 0.207,
          "Wilson lower bound for 1 of 1 is 0.207, not 1.0",
          str(round(wilson_lower_95(1, 1), 3)))
    check(wilson_lower_95(0, 0) is None, "no screens means no interval, not zero")
    check(wilson_lower_95(840, 1340) > wilson_lower_95(3, 10),
          "the same rate with more screens has a tighter lower bound")


def check_accumulator() -> None:
    print("\ngene accumulator")
    bg = orcs.OrcsScreen(screen_id=7, cell_line="HeLa", phenotype="cell proliferation",
                         condition_name="Olaparib", scores_size=20000, number_of_hits=300)
    hlo = orcs.OrcsScreen(screen_id=8, cell_line="K-562", phenotype="viability",
                          scores_size=100, number_of_hits=100)
    acc = GeneAccumulator(symbol="G")
    acc.observe(bg, True, 123, 0, aliases=["OLD"])
    acc.observe(hlo, True, 123, None)                  # hit-list-only: no bit
    r = acc.row(8)
    check(r["n_screens_tested"] == 1 and r["n_hits"] == 1 and r["hit_rate"] == 1.0,
          "only background screens enter the rate")
    check(r["n_screens_all"] == 2 and r["n_hits_all"] == 2,
          "the non-background screen is still recorded in the *_all totals")
    check(r["n_phenotypes"] == 1 and r["n_cell_lines"] == 1,
          "breadth counts come only from background hits, so the hit-list deposit's "
          "cell line is not counted")
    check(r["entrez_id"] == 123, "the Entrez id is carried through")

    never = GeneAccumulator(symbol="H").row(8)
    check(never["hit_rate"] is None,
          "a gene no background screen measured has an unknown rate, not 0.0")

    inv = invert_aliases({"MARCHF2": {"2-Mar", "MARCH2"}, "OTHER": {"2-Mar"},
                          "A": {"B"}, "B": {"C"}})
    check("2-Mar" not in inv, "an alias claimed by two symbols is dropped, not guessed")
    check(inv.get("MARCH2") == "MARCHF2", "an unambiguous alias resolves")
    check("B" not in inv, "an alias that is itself an official symbol is dropped")


def check_comparability(index: dict[int, orcs.OrcsScreen]) -> None:
    print("\ncomparability scoring")
    hela_olaparib = next(s for s in index.values()
                         if s.cell_line == "HeLa" and s.condition_name == "Olaparib")
    score, matched = comparability(hela_olaparib, cell_line="HeLa", condition="olaparib")
    check(score == 1.0 and set(matched) == {"cell_line", "condition"},
          "a screen matching everything asked for scores 1.0", f"{score} {matched}")

    score, _ = comparability(hela_olaparib, cell_line="K562", condition="olaparib")
    check(0 < score < 1, "a partial match scores in between", str(round(score, 3)))

    score, matched = comparability(hela_olaparib)
    check(score == 0.0 and matched == (),
          "a query that supplies nothing matches nothing, rather than everything")

    score, _ = comparability(hela_olaparib, cell_line="HeLa")
    check(score == 1.0,
          "the denominator is only the features the caller supplied, so a cell-line-only "
          "query is not capped")

    # Containment, and its guard against short strings matching everything.
    olap = next(s for s in index.values()
                if (s.condition_name or "").lower().startswith("olaparib")
                and s.condition_name != "Olaparib")
    score, matched = comparability(olap, condition="olaparib")
    check("condition" in matched, f"'olaparib' matches {olap.condition_name!r}")
    score, matched = comparability(hela_olaparib, condition="ola")
    check("condition" not in matched,
          "a query under four characters must match exactly, so 'ola' does not match")


def check_store() -> None:
    print("\nthe ingested store")
    store = AtlasStore(leakage_policy=None)
    reason = store.unavailable_reason()
    if reason:
        check(False, "the Atlas store is readable", reason)
        return
    check(True, "the Atlas store is readable")

    m = store.manifest()
    check(m["n_screens"] == N_SCREENS, f"{N_SCREENS} screens ingested", str(m["n_screens"]))
    check(m["n_background_screens"] == N_BACKGROUND,
          f"{N_BACKGROUND} background screens", str(m["n_background_screens"]))
    check(m["n_symbols"] == N_SYMBOLS, f"{N_SYMBOLS:,} distinct symbols",
          f"{m['n_symbols']:,}")
    audit = m["parse_audit"]
    check(audit["duplicate_groups"] == N_DUPLICATE_GROUPS,
          f"{N_DUPLICATE_GROUPS:,} duplicate symbol groups collapsed",
          f"{audit['duplicate_groups']:,}")
    check(audit["duplicate_rows"] == N_DUPLICATE_ROWS,
          f"those groups hold {N_DUPLICATE_ROWS:,} rows",
          f"{audit['duplicate_rows']:,}")
    check(audit["disagreeing_groups"] == N_DISAGREEING_GROUPS,
          f"{N_DISAGREEING_GROUPS:,} of those disagreed with themselves on HIT")
    # The audit is derived from the parquet files, not from whichever run wrote
    # them, so these hold after a resume as well as after a full pass. That is
    # the whole reason it moved out of the rows phase.
    check(audit["raw_rows_recovered"] == N_RAW_ROWS,
          f"every one of the {N_RAW_ROWS:,} source rows is accounted for",
          f"{audit['raw_rows_recovered']:,}")
    check(audit["n_row_count_mismatches"] == 0,
          "every screen's recovered row count equals the index SCORES_SIZE")
    # Collapse removes exactly (duplicate rows - duplicate groups) rows.
    check(m["n_gene_rows"] == N_RAW_ROWS - (N_DUPLICATE_ROWS - N_DUPLICATE_GROUPS),
          "rows after collapse account for every raw row",
          f"{m['n_gene_rows']:,}")
    check(m["leakage_filtered_at_ingest"] is False,
          "the store holds every screen; leakage filtering is a read-time decision")

    # Bit order must be exactly the manifest's, or every rate is wrong.
    bg = store.background_screen_ids()
    check(len(bg) == N_BACKGROUND and store.bit_position()[bg[0]] == 0,
          "bit i of a mask is background_screen_ids[i]")
    screens = store.screens()
    check(all(screens[sid].usable_background for sid in bg),
          "every screen with a bit is a usable background screen")

    stats = store.gene_stats()
    check(len(stats) == N_SYMBOLS, "gene_stats covers every symbol")
    check(popcount(stats["TP53"].tested_mask) == stats["TP53"].n_screens_tested,
          "the stored count and the mask popcount agree for TP53")


def check_gene_context() -> None:
    print("\nper-gene context on a real comparison")
    store = AtlasStore(leakage_policy=None)
    if not store.available:
        check(False, "store available for context tests", store.unavailable_reason() or "")
        return

    # The validated test screen: GSE145743, HeLa, olaparib vs DMSO.
    comparable = store.comparable_screens(
        cell_line="HeLa", condition="Olaparib", phenotype="response to chemicals",
        modality="knockout", limit=25,
    )
    related = [c for c in comparable if c.related]
    check(len(related) >= 4, "at least four published HeLa olaparib screens are found",
          f"{len(related)} of {len(comparable)}")
    check(all(c.score <= 1.0 for c in comparable), "no score exceeds 1.0")
    check(comparable == sorted(comparable, key=lambda c: (-c.score, -(c.n_genes or 0),
                                                          c.screen_id)),
          "the ranking is deterministic")
    authors = {c.author for c in related}
    check(any("Zimmermann" in (a or "") for a in authors),
          "Zimmermann 2018, a HeLa olaparib screen, is among them", str(sorted(authors)[:3]))

    res = store.gene_context(["CHD1L", "PARG", "PSMB2", "RPL5", "NOT_A_GENE"], comparable)
    check(res.available, "context is available")
    check(res.n_genes_not_in_atlas == 1, "the invented symbol is reported as absent")

    chd1l = res.contexts["CHD1L"]
    check(chd1l.hit_rate_unrelated is not None and chd1l.hit_rate_unrelated < 0.05,
          "CHD1L, the paper's headline gene, is rare across unrelated screens",
          f"{chd1l.hit_rate_unrelated:.4f}")
    check(chd1l.n_hits_comparable >= 2,
          "and it does hit in the comparable HeLa olaparib screens",
          f"{chd1l.n_hits_comparable}/{chd1l.n_screens_comparable}")
    check(chd1l.is_frequent_hitter() is False, "so it is not a frequent hitter")

    psmb2 = res.contexts["PSMB2"]
    check(psmb2.is_frequent_hitter() is True,
          "PSMB2, a proteasome subunit, is", f"{psmb2.hit_rate_unrelated:.3f}")
    check(psmb2.n_hits_comparable == 0 or psmb2.hit_rate_unrelated > 0.5,
          "its unrelated rate is what makes the call, not the comparable one")

    # Denominators are per gene, never the size of the Atlas.
    parg = res.contexts["PARG"]
    check(parg.n_screens_tested < psmb2.n_screens_tested,
          "PARG is measured in fewer screens than PSMB2, so its denominator is smaller",
          f"{parg.n_screens_tested} vs {psmb2.n_screens_tested}")
    check(abs(parg.hit_rate - parg.n_hits / parg.n_screens_tested) < 1e-12,
          "the reported rate is hits over screens that measured the gene")

    # Related screens must be out of the unrelated denominator, exactly.
    for sym, ctx in res.contexts.items():
        check(ctx.n_screens_unrelated + ctx.n_screens_comparable == ctx.n_screens_tested,
              f"{sym}: related and unrelated partition the tested set")
        check(ctx.n_hits_unrelated + ctx.n_hits_comparable == ctx.n_hits,
              f"{sym}: related and unrelated partition the hits")


def check_frequent_hitter_guard() -> None:
    print("\nfrequent-hitter guard")
    store = AtlasStore(leakage_policy=None)
    if not store.available:
        check(False, "store available", store.unavailable_reason() or "")
        return
    syms = sorted(store.gene_stats())
    contexts: dict = {}
    for i in range(0, len(syms), 50_000):
        contexts.update(store.gene_context(syms[i:i + 50_000], None).contexts)

    flagged = [c for c in contexts.values() if c.is_frequent_hitter()]
    check(all(c.n_screens_unrelated >= MIN_SCREENS_FOR_FREQUENT_HITTER for c in flagged),
          f"no gene is called a frequent hitter on under "
          f"{MIN_SCREENS_FOR_FREQUENT_HITTER} screens")
    check(1000 < len(flagged) < 4000,
          "the flagged set is the size of the pan-essential core, not the genome",
          f"{len(flagged):,} of {len(contexts):,}")

    # The canonical pan-essentials have to be in, and condition-specific genes out.
    for gene in ("RPL5", "PSMA1", "EIF3A", "RAN", "POLR2A", "SNRPD1"):
        ctx = contexts.get(gene)
        check(ctx is not None and ctx.is_frequent_hitter() is True,
              f"{gene} is a frequent hitter",
              f"{ctx.hit_rate_unrelated:.3f}" if ctx else "absent")
    for gene in ("CHD1L", "IFNAR1", "PARG"):
        ctx = contexts.get(gene)
        check(ctx is not None and ctx.is_frequent_hitter() is False,
              f"{gene} is not",
              f"{ctx.hit_rate_unrelated:.3f}" if ctx else "absent")

    # A one-screen gene must be unjudgeable rather than a 100% hitter.
    thin = [c for c in contexts.values()
            if c.n_screens_unrelated == 1 and c.n_hits_unrelated == 1]
    check(bool(thin), f"{len(thin):,} genes hit in the single screen that measured them")
    check(all(c.is_frequent_hitter() is None for c in thin),
          "and every one of them is None, not True")
    check(all(c.hit_rate_unrelated == 1.0 for c in thin),
          "while the rate itself is still reported honestly as 1.0")


def check_leakage_guard() -> None:
    print("\nleakage guard")
    from splicr import orcs_safe

    guarded = AtlasStore()          # default policy
    check(guarded.leakage_policy == "publication",
          "the guard is on by default", str(guarded.leakage_policy))
    if not guarded.available:
        check(False, "store available", guarded.unavailable_reason() or "")
        return

    excluded = guarded._leakage_excluded()
    check(len(excluded) == 378,
          "378 screens are held out under the publication policy", str(len(excluded)))
    safe = orcs_safe.safe_ids("publication")
    check(not (excluded & safe), "nothing held out is in the safe set")

    res = guarded.gene_context(["TP53"], None)
    open_ = AtlasStore(leakage_policy=None).gene_context(["TP53"], None)
    check(res.n_background_screens < open_.n_background_screens,
          "the guarded store has a smaller denominator than the open one",
          f"{res.n_background_screens} vs {open_.n_background_screens}")
    check(res.contexts["TP53"].n_screens_tested
          < open_.contexts["TP53"].n_screens_tested,
          "and so does the per-gene denominator")

    off = AtlasStore(leakage_policy="off")
    check(off.leakage_policy is None, "'off' disables the guard")
    try:
        AtlasStore(leakage_policy="nonsense").gene_context(["TP53"], None)
        check(False, "an unknown policy raises rather than passing everything")
    except ValueError:
        check(True, "an unknown policy raises rather than passing everything")


def check_honest_degradation() -> None:
    print("\nhonest degradation")
    missing = atlas_context(["TP53"], store=AtlasStore("/nonexistent/atlas"))
    check(missing.available is False, "a missing store is unavailable, not empty")
    check("has not been built" in missing.reason and "ingest-orcs" in missing.reason,
          "and the reason says what to do", missing.reason)
    check(missing.hit_rates == {} and missing.contexts == {},
          "no rates are invented")
    check(missing.metrics()["available"] is False, "the stage metrics say so too")

    # An incomplete store: rows present, manifest absent. This is what a
    # killed ingestion leaves behind, and it must not read as usable.
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        half = Path(tmp) / "atlas"
        (half / "gene_hits" / "screen_id=1").mkdir(parents=True)
        result = atlas_context(["TP53"], store=AtlasStore(half))
        check(result.available is False and "incomplete" in result.reason,
              "a half-written store is reported as incomplete", result.reason)

    # Over the batch guard.
    store = AtlasStore(leakage_policy=None)
    if store.available:
        try:
            store.gene_context(["A"] * 60_001, None)
            check(False, "asking for too many genes at once raises")
        except ValueError as exc:
            check("guard" in str(exc), "asking for too many genes at once raises",
                  str(exc)[:60])


def check_ingestion_resumes() -> None:
    """
    Build a small store, break it the way a killed run does, and resume.

    The three things a killed run leaves behind are all planted here: screen
    files missing, a half-written .tmp, and no manifest. The resumed store has
    to come out byte-for-byte identical, and the parse audit has to report the
    whole store rather than only the screens the second run touched. This is a
    regression test for a real bug: the audit used to accumulate inside the
    rows phase, so a resumed run reported 38 collapsed duplicate groups where
    the store held 60,162.
    """
    print("\ningestion resumes after a kill")
    import hashlib
    import json
    import subprocess
    import tempfile

    root = Path(__file__).resolve().parents[2]
    script = root / "scripts" / "data" / "ingest-orcs.py"

    def run(out: Path, extra: list[str]) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(script), "--out", str(out), "--limit", "30"] + extra,
            capture_output=True, text=True,
        )

    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "atlas"
        first = run(out, [])
        check(first.returncode == 0, "a 30-screen store builds",
              (first.stdout + first.stderr)[-200:] if first.returncode else "")
        if first.returncode != 0:
            return

        before = digest(out / "gene_stats.parquet")
        audit_before = json.loads((out / "manifest.json").read_text())["parse_audit"]
        screens = sorted((out / "gene_hits").iterdir())
        check(len(screens) == 30, "30 screen directories", str(len(screens)))

        # Plant exactly what a killed run leaves behind.
        import shutil

        for d in screens[:3]:
            shutil.rmtree(d)
        (screens[5] / "rows.parquet.tmp").write_text("truncated, not parquet")
        (out / "manifest.json").unlink()

        from splicr.atlas import atlas_context as ctx
        mid = ctx(["TP53"], store=AtlasStore(out, leakage_policy=None))
        check(mid.available is False, "the broken store reads as unavailable", mid.reason)

        second = run(out, [])
        check(second.returncode == 0, "the resumed run succeeds",
              (second.stdout + second.stderr)[-200:] if second.returncode else "")
        togo = next((l.strip() for l in second.stdout.splitlines() if "to go" in l), "")
        check("3 to go" in togo, "it rewrites only the three missing screens", togo)
        check(not list((out / "gene_hits").rglob("*.tmp")),
              "the stale .tmp file is gone")
        check(digest(out / "gene_stats.parquet") == before,
              "the resumed store is byte-for-byte identical")
        audit_after = json.loads((out / "manifest.json").read_text())["parse_audit"]
        check(audit_after == audit_before,
              "and the parse audit describes the whole store, not just the resumed part",
              f"{audit_after.get('duplicate_groups')} vs "
              f"{audit_before.get('duplicate_groups')}")
        check(audit_after["dropped_no_symbol"] == 0
              and audit_after["screens_missing_parse_stats"] == 0,
              "with no rows dropped and parse stats on every file")


def check_postgres_sql_matches_the_migrations() -> None:
    """
    Check the ingestion's INSERT column lists against the real migrations.

    The database is down, so the Postgres phase cannot be run against it. This
    is the next best thing and it is not a formality: it reads the column list
    out of every `insert into atlas.*` in scripts/data/ingest-orcs.py and
    checks each name against the create-table statement in
    supabase/migrations/, which catches the typo that would otherwise surface
    as a failed load an hour into a run.
    """
    print("\nPostgres SQL against the migrations")
    import re

    root = Path(__file__).resolve().parents[2]
    script = (root / "scripts" / "data" / "ingest-orcs.py").read_text()
    migration = (root / "supabase" / "migrations"
                 / "20260926000400_atlas_reference.sql").read_text()

    def columns_of(table: str) -> set[str]:
        m = re.search(rf"create table {re.escape(table)} \((.*?)\n\);", migration, re.S)
        if not m:
            return set()
        out = set()
        for line in m.group(1).split("\n"):
            line = line.strip()
            if not line or line.startswith(("constraint", "primary key", "unique", "--")):
                continue
            out.add(line.split()[0])
        return out

    # The bulk path uses COPY rather than INSERT, so both forms are collected.
    inserts = re.findall(r"insert into (atlas\.\w+)\s*\n?\s*\(([^)]*)\)", script)
    inserts += re.findall(r"copy (atlas\.\w+) \(([^)]*)\)", script)
    check(len(inserts) >= 3, "found the INSERT and COPY statements in the ingestion "
                             "script", f"{len(inserts)}")
    for table, raw in inserts:
        declared = columns_of(table)
        check(bool(declared), f"{table} exists in the migrations")
        used = {c.strip() for c in raw.replace("\n", " ").split(",") if c.strip()}
        unknown = sorted(used - declared)
        check(not unknown, f"{table}: every column written exists", str(unknown))

    # atlas.screens.title is NOT NULL, so the script must never pass a bare None.
    check('s.screen_name or f"ORCS screen' in script,
          "atlas.screens.title, which is NOT NULL, always gets a value")
    # Enum and jsonb parameters need explicit casts; see the comment there.
    check("%s::public.modality" in script and "%s::jsonb" in script,
          "the enum and jsonb parameters are cast explicitly")
    # atlas.screen_hits is keyed on (screen_id, gene_symbol), which only works
    # because the parser collapses duplicate symbols.
    check("primary key (screen_id, gene_symbol)" in migration,
          "atlas.screen_hits is keyed on (screen_id, gene_symbol), which is why "
          "collapse_rows exists")


def main() -> int:
    print("ORCS parser and Atlas")
    check_null_and_number_parsing()
    index = check_index()
    check_screen_parsing(index)
    check_malformed_input()
    check_collapse_rule()
    check_bitmaps()
    check_accumulator()
    check_comparability(index)
    check_store()
    check_gene_context()
    check_frequent_hitter_guard()
    check_leakage_guard()
    check_honest_degradation()
    check_ingestion_resumes()
    check_postgres_sql_matches_the_migrations()

    print()
    if failures:
        print(f"{len(failures)} FAILURES")
        for f in failures:
            print(f"  {f}")
        return 1
    print("All checks passed.")
    return 0


# --- pytest entry point ------------------------------------------------------
# The checks above are script helpers: main() calls them in order and passes the
# parsed index between them, so they take arguments and pytest cannot collect
# them. They are named check_* so pytest does not try. This is the one
# collectable test, and it runs the whole script.
def test_atlas_and_orcs():
    import pytest

    from splicr.atlas import ATLAS_DIR

    if not ATLAS_DIR.exists():
        pytest.skip(f"no Atlas store at {ATLAS_DIR}; run scripts/data/ingest-orcs.py")
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
