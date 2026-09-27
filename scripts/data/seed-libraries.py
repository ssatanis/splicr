#!/usr/bin/env python
"""
Seed atlas.libraries and atlas.guides from the engine's own parsers.

    engine/.tools/env/bin/python scripts/data/seed-libraries.py          # dry run
    engine/.tools/env/bin/python scripts/data/seed-libraries.py --go
    engine/.tools/env/bin/python scripts/data/seed-libraries.py --go --library geckov2-a

This replaces the library half of scripts/data/seed-atlas.mjs, which parsed the
files a second time in JavaScript. That copy split every header on a tab, so the
comma-delimited files (both GeCKOv2 sets, both mouse GeCKOv2 sets) were rejected
as "unexpected header" and never reached the Atlas: five of thirteen libraries
were present, and the one a real test screen had used was missing. It also had
no idea that Brie's controls live in a separate file.

One parser now feeds both the analysis and the Atlas, so the guide a screen is
counted against and the guide recorded in the Atlas cannot drift apart.

Off-target columns are filled from Fortin's alignment tables where they cover a
library, and left null where they do not. Null means unmeasured, never zero.
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "engine"))

from splicr import db                                          # noqa: E402
from splicr.config import SCAFFOLD_ANCHOR, VECTOR_ANCHORS      # noqa: E402
from splicr.references import (annotate_offtarget,             # noqa: E402
                               available_libraries, load_library)

# Facts that are not in the guide files themselves. Addgene ids and modality
# come from each library's own Addgene page.
META = {
    "brunello":        ("knockout", "SpCas9",          "73179"),
    "brie":            ("knockout", "SpCas9",          "73633"),
    "gattinara":       ("knockout", "SpCas9",          "136986"),
    "calabrese-a":     ("crispra",  "dCas9-p65-HSF",   "92379"),
    "calabrese-b":     ("crispra",  "dCas9-p65-HSF",   "92380"),
    "dolcetto-a":      ("crispri",  "dCas9-KRAB",      "92385"),
    "dolcetto-b":      ("crispri",  "dCas9-KRAB",      "92386"),
    "geckov2-a":       ("knockout", "SpCas9",          "1000000048"),
    "geckov2-b":       ("knockout", "SpCas9",          "1000000048"),
    "gouda":           ("knockout", "SpCas9",          "175827"),
    "mouse-geckov2-a": ("knockout", "SpCas9",          "1000000053"),
    "mouse-geckov2-b": ("knockout", "SpCas9",          "1000000053"),
    "tkov3":           ("knockout", "SpCas9",          "90294"),
}

SOURCE_URL = {
    "geckov2-a": "https://www.addgene.org/pooled-library/zhang-human-gecko-v2/",
    "geckov2-b": "https://www.addgene.org/pooled-library/zhang-human-gecko-v2/",
    "mouse-geckov2-a": "https://www.addgene.org/pooled-library/zhang-mouse-gecko-v2/",
    "mouse-geckov2-b": "https://www.addgene.org/pooled-library/zhang-mouse-gecko-v2/",
    "tkov3": "https://www.addgene.org/pooled-library/moffat-crispr-knockout-tkov3/",
}


def anchor_for(slug: str) -> str:
    """The vector anchor a screen of this library is expected to carry."""
    if slug == "tkov3":
        return VECTOR_ANCHORS["plcko2"]
    return VECTOR_ANCHORS["lentiguide"]


def seed_one(conn, slug: str, go: bool) -> dict:
    library = load_library(slug)
    measured = annotate_offtarget(library)

    modality, cas, addgene = META.get(slug, ("knockout", "SpCas9", None))
    targeting = [g for g in library.guides if g.targets_gene]
    n_genes = len(library.genes)
    stats = {
        "slug": slug,
        "guides": len(library.guides),
        "targeting": len(targeting),
        "controls": library.n_controls,
        "genes": n_genes,
        "with_coords": sum(1 for g in library.guides if g.chrom and g.cut_pos),
        "offtarget_measured": measured,
    }
    if not go:
        return stats

    library_id = conn.execute(
        """
        insert into atlas.libraries
            (org_id, slug, name, taxid, modality, cas, n_guides, n_targeting,
             n_controls, n_genes, guides_per_gene, guide_length, addgene_id,
             source_url, source_version, vector_anchor, scaffold_anchor,
             has_coordinates, updated_at)
        values (null, %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
        on conflict (slug) where org_id is null do update set
            name = excluded.name, taxid = excluded.taxid,
            modality = excluded.modality, cas = excluded.cas,
            n_guides = excluded.n_guides, n_targeting = excluded.n_targeting,
            n_controls = excluded.n_controls, n_genes = excluded.n_genes,
            guides_per_gene = excluded.guides_per_gene,
            guide_length = excluded.guide_length,
            addgene_id = excluded.addgene_id, source_url = excluded.source_url,
            source_version = excluded.source_version,
            vector_anchor = excluded.vector_anchor,
            scaffold_anchor = excluded.scaffold_anchor,
            has_coordinates = excluded.has_coordinates, updated_at = now()
        returning id
        """,
        (slug, library.name, library.taxid, modality, cas,
         len(library.guides), len(targeting), library.n_controls, n_genes,
         round(len(targeting) / n_genes, 2) if n_genes else None,
         library.dominant_length, addgene,
         SOURCE_URL.get(slug), library.source_file.name if library.source_file else None,
         anchor_for(slug), SCAFFOLD_ANCHOR, stats["with_coords"] > 0),
    ).fetchone()[0]

    # Replace rather than merge: a library file is a single published artifact,
    # so a partial overwrite could leave guides from an older revision behind.
    conn.execute("delete from atlas.guides where library_id = %s", (library_id,))

    buf = io.StringIO()
    for g in library.guides:
        perfect = g.perfect_alignments
        mism = g.mismatch1_alignments
        row = [
            str(library_id), g.guide_id, g.sequence,
            g.gene or r"\N",
            "t" if g.is_control else "f",
            "non_targeting" if g.is_control else r"\N",
            g.chrom or r"\N",
            str(g.cut_pos) if g.cut_pos is not None else r"\N",
            g.strand or r"\N",
            str(perfect) if perfect is not None else r"\N",
            str(mism) if mism is not None else r"\N",
            "t" if (perfect or 0) > 1 else "f",
        ]
        buf.write("\t".join(f.replace("\t", " ") for f in row) + "\n")
    buf.seek(0)

    with conn.cursor().copy(
        "copy atlas.guides (library_id, guide_key, sequence, gene_symbol, "
        "is_control, control_type, chrom, cut_pos, strand, perfect_sites, "
        "mismatch1_sites, multi_gene) from stdin"
    ) as cp:
        cp.write(buf.read())

    # Link to atlas.genes by symbol within the library's own species.
    linked = conn.execute(
        """
        update atlas.guides g
           set gene_id = t.id
          from atlas.genes t
         where g.library_id = %s
           and g.gene_symbol is not null
           and t.taxid = %s
           and t.symbol = g.gene_symbol
        """,
        (library_id, library.taxid),
    ).rowcount
    stats["gene_links"] = linked
    return stats


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--go", action="store_true", help="write to the database")
    ap.add_argument("--library", action="append", help="only these slugs")
    args = ap.parse_args()

    slugs = args.library or available_libraries()
    print(f"{len(slugs)} librar{'y' if len(slugs) == 1 else 'ies'} to seed\n")

    with db.open_connection() as conn:
        rows = []
        for slug in slugs:
            try:
                rows.append(seed_one(conn, slug, args.go))
                if args.go:
                    conn.commit()
            except Exception as exc:
                print(f"  {slug:18} FAILED {type(exc).__name__}: {exc}")
                conn.rollback()

        print(f"{'slug':18} {'guides':>8} {'target':>8} {'ctrl':>6} {'genes':>7} "
              f"{'coords':>8} {'offtgt':>8} {'linked':>8}")
        for r in rows:
            print(f"{r['slug']:18} {r['guides']:>8,} {r['targeting']:>8,} "
                  f"{r['controls']:>6,} {r['genes']:>7,} {r['with_coords']:>8,} "
                  f"{r['offtarget_measured']:>8,} {r.get('gene_links', 0):>8,}")

        if not args.go:
            print("\nDry run. Pass --go to write.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
