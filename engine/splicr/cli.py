"""
Command line entry point.

    python -m splicr run      --name "A375 RSL3" --fastq T0_r1=a.fastq.gz ... --persist
    python -m splicr detect   reads.fastq.gz
    python -m splicr count    reads.fastq.gz --library brunello
    python -m splicr libraries
    python -m splicr doctor

`doctor` is the one to reach for first when something is wrong: it checks the
tools, the reference data, the database and R2, and says which of them is not
ready rather than failing later with a confusing error.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

from .config import (
    BAGEL_DIR, DEPMAP_DIR, GENESETS_DIR, LIBRARIES_DIR, OFFTARGET_DIR,
    REFERENCE_DIR, SETTINGS, WORK_DIR, tool_env,
)


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}PB"


# ---------------------------------------------------------------------------
# doctor
# ---------------------------------------------------------------------------

def cmd_doctor(args: argparse.Namespace) -> int:
    ok = True

    def check(label: str, good: bool, detail: str = "") -> None:
        nonlocal ok
        print(f"  {'ok  ' if good else 'MISS'}  {label:<30} {detail}")
        if not good:
            ok = False

    print("Tools")
    for tool in ("mageck", "RRA", "bowtie", "cutadapt", "fastp", "seqkit", "samtools"):
        path = shutil.which(tool, path=str(SETTINGS.tool_bin))
        version = ""
        if path:
            try:
                out = subprocess.run([path, "--version"], capture_output=True,
                                     text=True, timeout=20, env=tool_env())
                version = (out.stdout or out.stderr).strip().splitlines()[0][:48]
            except Exception:
                version = "present"
        check(tool, path is not None, version)
    check("BAGEL2", (BAGEL_DIR / "BAGEL.py").exists(), str(BAGEL_DIR))

    print("\nReference data")
    from .references import available_libraries
    libs = available_libraries()
    check("libraries", bool(libs), f"{len(libs)} parseable: {', '.join(libs[:4])}...")
    check("gene sets", (GENESETS_DIR / "CEGv2.txt").exists(),
          str(GENESETS_DIR.relative_to(REFERENCE_DIR.parent.parent)))
    check("off-target tables", any(OFFTARGET_DIR.glob("*gene_summary*")),
          f"{len(list(OFFTARGET_DIR.glob('*.csv')))} files")
    check("DepMap", (DEPMAP_DIR / "CRISPRGeneEffect.csv").exists(),
          "common essentials and copy number")

    print("\nDatabase")
    try:
        from . import db
        with db.connect() as conn:
            n = conn.execute("select count(*) from atlas.libraries").fetchone()[0]
            g = conn.execute("select count(*) from atlas.genes").fetchone()[0]
        check("Supabase", True, f"{g:,} genes, {n} libraries in the Atlas")
    except Exception as exc:
        check("Supabase", False, f"{type(exc).__name__}: {str(exc)[:60]}")

    print("\nObject storage")
    try:
        from .r2 import R2Config, client
        cfg = R2Config.from_env()
        client(cfg).head_bucket(Bucket=cfg.bucket)
        check("Cloudflare R2", True, f"bucket {cfg.bucket}")
    except Exception as exc:
        check("Cloudflare R2", False, f"{type(exc).__name__}: {str(exc)[:60]}")

    print("\n" + ("Everything is ready." if ok else
                  "Some pieces are missing. See engine/setup.sh and scripts/data/download.sh."))
    return 0 if ok else 1


# ---------------------------------------------------------------------------
# libraries
# ---------------------------------------------------------------------------

def cmd_libraries(args: argparse.Namespace) -> int:
    from .references import available_libraries, load_library

    print(f"{'slug':<18} {'guides':>8} {'genes':>8} {'ctrl':>6} {'nt':>4}  name")
    for slug in available_libraries():
        try:
            lib = load_library(slug)
            print(f"{slug:<18} {len(lib.guides):>8,} {len(lib.genes):>8,} "
                  f"{lib.n_controls:>6,} {lib.dominant_length:>4}  {lib.name}")
        except Exception as exc:
            print(f"{slug:<18} could not parse: {exc}")
    return 0


# ---------------------------------------------------------------------------
# detect
# ---------------------------------------------------------------------------

def cmd_detect(args: argparse.Namespace) -> int:
    from .detect import detect_from_fastq

    path = Path(args.fastq)
    if not path.exists():
        print(f"not found: {path}")
        return 1
    det = detect_from_fastq(path)
    print(det.describe())
    print(f"confident: {det.confident}")
    print(f"reason: {det.reason}\n")
    for m in det.ranked[:6]:
        loc = m.location.describe() if m.location else "-"
        print(f"  {m.name:<20} {m.match_rate:>7.1%} of reads   {loc}")
    return 0 if det.best else 1


# ---------------------------------------------------------------------------
# count
# ---------------------------------------------------------------------------

def cmd_count(args: argparse.Namespace) -> int:
    from .count import count_fastq
    from .detect import detect_from_fastq
    from .references import load_library

    path = Path(args.fastq)
    if not path.exists():
        print(f"not found: {path}")
        return 1

    if args.library:
        library = load_library(args.library)
    else:
        det = detect_from_fastq(path)
        if not det.best:
            print(f"could not identify the library: {det.reason}")
            return 1
        library = load_library(det.best.slug)
        print(f"detected {library.name}")

    result = count_fastq(path, library, label=path.name)
    print(result.summary())
    print(f"spacer: {result.location.describe() if result.location else '-'}")

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w") as fh:
            fh.write("sgRNA\tGene\tcount\n")
            for g in library.guides:
                fh.write(f"{g.guide_id}\t{g.gene or 'CONTROL'}\t{result.counts.get(g.guide_id, 0)}\n")
        print(f"wrote {out}")
    return 0


# ---------------------------------------------------------------------------
# run
# ---------------------------------------------------------------------------

def cmd_run(args: argparse.Namespace) -> int:
    from .pipeline import ScreenInput, run_pipeline

    fastqs: dict[str, Path] = {}
    for item in args.fastq or []:
        if "=" not in item:
            print(f"--fastq expects label=path, got {item!r}")
            return 1
        label, _, p = item.partition("=")
        fastqs[label] = Path(p)

    roles: dict[str, str] = {}
    for item in args.role or []:
        label, _, role = item.partition("=")
        roles[label] = role

    # Anything not given an explicit role is treated by how it is used.
    for label in fastqs:
        roles.setdefault(label, "treatment" if label in (args.treatment or []) else "control")

    org_id = args.org
    if args.persist and not org_id:
        from . import db
        with db.connect() as conn:
            row = conn.execute(
                "select id from public.organizations where slug = %s", (args.org_slug,)
            ).fetchone()
        if not row:
            print(f"no organization with slug {args.org_slug!r}. Pass --org <uuid>.")
            return 1
        org_id = str(row[0])

    spec = ScreenInput(
        name=args.name,
        fastqs=fastqs,
        count_table=Path(args.counts) if args.counts else None,
        roles=roles,
        treatment=args.treatment or [],
        control=args.control or [],
        library_slug=args.library,
        cell_line=args.cell_line,
        model_id=args.model_id,
        phenotype=args.phenotype,
    )
    result = run_pipeline(spec, Path(args.workdir or WORK_DIR) / "run",
                          org_id=org_id, persist=args.persist)
    print()
    print(result.summary())
    if result.screen_id:
        print(f"\nscreen {result.screen_id}")
    return 0 if result.ok else 1


# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="splicr", description="SplicR analysis engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check tools, data, database and storage").set_defaults(
        func=cmd_doctor)
    sub.add_parser("libraries", help="list parseable libraries").set_defaults(
        func=cmd_libraries)

    d = sub.add_parser("detect", help="identify the library in a FASTQ")
    d.add_argument("fastq")
    d.set_defaults(func=cmd_detect)

    c = sub.add_parser("count", help="count one FASTQ against a library")
    c.add_argument("fastq")
    c.add_argument("--library", help="library slug; detected when omitted")
    c.add_argument("--out", help="write a count table here")
    c.set_defaults(func=cmd_count)

    r = sub.add_parser("run", help="run the full pipeline")
    r.add_argument("--name", required=True)
    r.add_argument("--fastq", action="append", metavar="LABEL=PATH")
    r.add_argument("--counts", help="count table instead of FASTQ")
    r.add_argument("--role", action="append", metavar="LABEL=ROLE",
                   help="plasmid, reference, control or treatment")
    r.add_argument("--treatment", action="append", metavar="LABEL")
    r.add_argument("--control", action="append", metavar="LABEL")
    r.add_argument("--library", help="library slug; detected when omitted")
    r.add_argument("--cell-line")
    r.add_argument("--model-id", help="DepMap ModelID, enables measured copy-number flagging")
    r.add_argument("--phenotype")
    r.add_argument("--workdir")
    r.add_argument("--persist", action="store_true", help="write results to Postgres")
    r.add_argument("--org", help="organization uuid")
    r.add_argument("--org-slug", default="splicr-engine")
    r.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
