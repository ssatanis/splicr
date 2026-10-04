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
import json
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
    from .count import count_table_samples
    from .design import DesignError, build_design
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
        if "=" not in item:
            print(f"--role expects label=role, got {item!r}")
            return 1
        label, _, role = item.partition("=")
        roles[label] = role

    # Roles for samples the caller did not name are inferred from the sample
    # labels, not from which side of the contrast they sit on. Defaulting them
    # to "control" is what this replaces, and it was quietly destructive: in the
    # standard dropout design it made the plasmid pool and the T0 sample both
    # control arms, which left the screen with no library reference, so NNMD,
    # AUROC and the essentiality check did not run at all and the reason printed
    # said no reference had been supplied when two had.
    #
    # Validated here as well as in the pipeline so a bad design costs nothing:
    # no database round trip, no counting, and an error that names the flag to
    # change.
    if not fastqs and not args.counts:
        print("nothing to analyse: pass --fastq LABEL=PATH or --counts FILE.")
        return 1
    try:
        labels = list(fastqs) if fastqs else count_table_samples(Path(args.counts))
        design = build_design(labels, roles, args.treatment or [], args.control or [])
    except DesignError as exc:
        print(f"This screen cannot be analysed as stated:\n  {exc}")
        return 1
    except FileNotFoundError:
        print(f"not found: {args.counts}")
        return 1
    for note in design.notes:
        print(f"note: {note}")
    roles = design.roles

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
        modality=args.modality,
        condition=args.condition,
        fitness_assay=args.fitness_assay,
        run_drugz=args.drugz,
        drugz_paired=args.drugz_paired,
    )
    result = run_pipeline(spec, Path(args.workdir or WORK_DIR) / "run",
                          org_id=org_id, persist=args.persist)
    print()
    print(result.summary())
    if result.screen_id:
        print(f"\nscreen {result.screen_id}")
    return 0 if result.ok else 1


def cmd_sources(args: argparse.Namespace) -> int:
    """Every external dataset, its licence and exactly what SplicR holds of it."""
    from . import sources

    if args.json:
        print(sources.as_json())
        return 0
    for s in sources.SOURCES:
        print(f"{s.status:11s} {s.id:16s} {s.name}")
        print(f"{'':28s} {s.holdings}")
    print("\n" + ", ".join(f"{k}: {v}" for k, v in sorted(sources.summary().items())))
    return 0


def cmd_similar(args: argparse.Namespace) -> int:
    """Knockouts whose signature looks like this gene's, in one modality."""
    from . import vectors

    hits = vectors.similar(args.gene, args.modality, args.k)
    if not hits:
        print(f"{args.gene} has no {args.modality} profile")
        return 1
    for gene, sim in hits:
        print(f"{gene:12s} {sim:+.3f}")
    return 0


def cmd_graph(args: argparse.Namespace) -> int:
    """Genes that lines amplified for GENE depend on and other lines do not."""
    from . import graph

    con = graph.connect()
    con.execute("set enable_progress_bar = false")
    df = graph.selective_dependencies(con, amplified_gene=args.amplified, lineage=args.lineage,
                                      limit=args.limit)
    print(df.to_string(index=False))
    return 0


def cmd_escape(args: argparse.Namespace) -> int:
    """
    Paralog-compensation hypotheses for one gene in one DepMap model.

    Reads the pinned paralog build and the reference lake and prints every
    evidence channel. Nothing here needs a screen: this is the reference-data half
    of the analysis, for checking what the engine would say about a pair before a
    screen is run. The screen-aware path is splicr.escape.analysis.analyse.
    """
    from . import harmonize
    from .escape import analysis, paralogs

    genes = harmonize.genes(harmonize.HUMAN)
    resolution = genes.resolve(args.gene)
    if not resolution.ok:
        print(f"{args.gene!r} did not resolve to a current Ensembl gene: "
              f"{resolution.reason or resolution.status}", file=sys.stderr)
        return 2
    lookup = paralogs.paralogs_of(resolution.id)
    if not lookup.covered:
        print(f"{resolution.label}: {lookup.note}")
        print("Build the paralog reference with scripts/data/build-paralogs.py --hgnc")
        return 1
    symbols = {p: (genes.resolve(p).label or p) for p in lookup.partners}
    found, unreached, note = analysis.hypotheses_for(
        resolution.id, model_id=args.model, symbol=resolution.label or args.gene,
        symbol_of=symbols)
    if not found:
        print(f"{resolution.label}: {note}")
        return 0
    from .escape import evidence

    # Every candidate is evaluated; --limit shortens the printout, so the strongest
    # is never dropped for being alphabetically late.
    print(evidence.summarise(found, limit=args.limit))
    if len(found) > args.limit:
        print(f"{len(found) - args.limit} weaker candidate paralog(s) were evaluated "
              f"and are not shown; raise --limit to see them.")
    if unreached:
        print(f"{unreached} further candidate paralog(s) were not evaluated at all.")
    print(f"Paralog build: {', '.join(lookup.releases)}")
    return 0


def cmd_schema(args: argparse.Namespace) -> int:
    """
    Print the JSON Schema of an API response model.

    The console renders these documents, so its TypeScript types have to match
    them. Rather than being copied by hand and drifting, the schema is generated
    from the pydantic model and committed; a Python test fails when the model
    changes without the file being regenerated, and a Node test fails when the
    TypeScript stops covering the schema's required fields.

        python -m splicr schema disagreement > \
          apps/web/src/lib/data/disagreement.schema.json
    """
    from .api.schemas import MODELS, schema_for

    if args.model not in MODELS:
        print(f"unknown model {args.model!r}; known: {', '.join(sorted(MODELS))}",
              file=sys.stderr)
        return 2
    print(json.dumps(schema_for(args.model), indent=2, sort_keys=True))
    return 0


def cmd_validation(args: argparse.Namespace) -> int:
    """
    What the Validation Network can and cannot currently state.

        python -m splicr validation status
        python -m splicr validation status --cohort data/validation/outcomes.json
        python -m splicr validation report --json

    `status` is the command to run before writing a number into a slide. It
    prints, per question, whether a calibrated probability is available at all
    and exactly what is outstanding when it is not. An unfitted network is a
    successful run of this command, not a failure: the absence is the answer.
    """
    from .validation.network import format_probability
    from .validation.report import network_report
    from .validation.store import load_network

    loaded = load_network(args.cohort)

    if args.action in ("publish", "retract"):
        from . import db as _db
        from .validation.publish import publish, retract

        with _db.connect() as conn:
            if args.action == "retract":
                changed = retract(conn, args.question)
                conn.commit()
                print(f"Retracted {changed} published head(s). Nothing was deleted: "
                      f"the fits and their metrics stay on record and only the "
                      f"current claim moved.")
                return 0
            if not loaded.network.fitted:
                print("Nothing to publish: no head could be fitted from this "
                      "cohort. Run `validation status` to see what is "
                      "outstanding.", file=sys.stderr)
                return 1
            published = publish(conn, loaded.network,
                                cohort_sha256=loaded.cohort_sha256,
                                promote=args.promote, notes=args.notes)
            conn.commit()
        for row in published:
            print(f"{row.question:16s} {row.version}  "
                  f"{row.n_open} of {row.n_strata} contexts open"
                  f"{'  PROMOTED' if row.promoted else ''}")
        if not args.promote:
            print("\nRecorded, not promoted. The console still states that no "
                  "probability is available. Re-run with --promote to change "
                  "what the product claims.")
        return 0

    report = network_report(loaded.network)
    if args.json:
        print(json.dumps({"loaded": loaded.as_dict(), "report": report},
                         indent=2, sort_keys=True, allow_nan=False))
        return 0

    print(f"Cohort      {loaded.source}")
    if loaded.problem:
        print(f"PROBLEM     {loaded.problem}")
    if loaded.cohort_sha256:
        print(f"sha256      {loaded.cohort_sha256}")
    counts = (report.get("cohort") or {}).get("counts") or {}
    if counts:
        print(f"Outcomes    {counts.get('total', 0)} recorded, "
              f"{counts.get('n_decided', 0)} decided "
              f"({counts.get('validated', 0)} validated, {counts.get('failed', 0)} "
              f"did not validate, {counts.get('inconclusive', 0)} inconclusive, "
              f"{counts.get('pending', 0)} pending)")
        print(f"            {counts.get('n_labs', 0)} laboratories, "
              f"{counts.get('n_studies', 0)} studies, "
              f"{counts.get('n_screens', 0)} screens, "
              f"{counts.get('n_genes', 0)} genes")
        if counts.get("labs_unattributed"):
            print(f"            {counts['labs_unattributed']} outcome(s) have no "
                  f"laboratory recorded and cannot enter a held-out evaluation")
    print()
    for question in report["questions"]:
        head = report["heads"].get(question["question"])
        print(f"{question['label']}")
        if head is None:
            print(f"  unavailable  {question['because']}")
        else:
            evaluation = head.get("evaluation") or {}
            print(f"  available    {head['model']}, "
                  f"{head['n_decided']} decided outcomes, {head['n_labs']} laboratories")
            print(f"  calibration  {evaluation.get('calibration', {}).get('chosen')} "
                  f"from {evaluation.get('calibration_source')}")
            print(f"  held out     {evaluation.get('headline', 'not evaluated')}")
            print(f"  evidenced    {format_probability(head['evidenced_low'])} to "
                  f"{format_probability(head['evidenced_high'])}; outside that the "
                  f"estimate is reported as a bound")
            print(f"  version      {head['version']}")
            open_strata = [s for s in head["coverage"]["strata"] if s["open"]]
            print(f"  open strata  {len(open_strata)} of "
                  f"{len(head['coverage']['strata'])}")
            for stratum in open_strata[:4]:
                print(f"               {stratum['describe']}: "
                      f"{stratum['n_decided']} outcomes, {stratum['n_labs']} labs, "
                      f"{stratum['n_screens']} screens")
        print()
    if not report["fitted"]:
        print("No calibrated validation probability is available anywhere. That is "
              "the honest state of this cohort, and the console says so on every "
              "surface that would otherwise show a number.")
    return 0


# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="splicr", description="SplicR analysis engine")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("doctor", help="check tools, data, database and storage").set_defaults(
        func=cmd_doctor)
    sub.add_parser("libraries", help="list parseable libraries").set_defaults(
        func=cmd_libraries)

    so = sub.add_parser("sources", help="external data sources and SplicR's holdings")
    so.add_argument("--json", action="store_true")
    so.set_defaults(func=cmd_sources)

    si = sub.add_parser("similar", help="nearest knockouts by perturbation signature")
    si.add_argument("gene")
    si.add_argument("--modality", default="jump_crispr",
                    choices=["perturbseq_k562", "jump_crispr", "jump_orf", "depmap_effect"])
    si.add_argument("-k", type=int, default=10)
    si.set_defaults(func=cmd_similar)

    gr = sub.add_parser("graph", help="selective dependencies of amplified lines (knowledge graph)")
    gr.add_argument("--amplified", required=True, help="gene whose amplification defines the group")
    gr.add_argument("--lineage", help="restrict to one DepMap lineage, e.g. Breast")
    gr.add_argument("--limit", type=int, default=20)
    gr.set_defaults(func=cmd_graph)

    es = sub.add_parser("escape", help="paralog-compensation hypotheses for one gene")
    es.add_argument("gene", help="gene symbol or canonical Ensembl gene id")
    es.add_argument("--model", default="", help="DepMap ModelID for the expression channel")
    es.add_argument("--limit", type=int, default=6,
                    help="candidate paralogs to print; every candidate is evaluated first")
    es.set_defaults(func=cmd_escape)

    va = sub.add_parser("validation",
                        help="what the Validation Network can currently state")
    va.add_argument("action", choices=("status", "report", "publish", "retract"),
                    help="status prints a readable summary; report is the same "
                         "content and accepts --json; publish writes the fitted "
                         "heads and their coverage to the database; retract "
                         "stops claiming a question is calibrated")
    va.add_argument("--promote", action="store_true",
                    help="with publish: make these heads the ones the console "
                         "reads. Without it the fit is recorded and claims "
                         "nothing.")
    va.add_argument("--question", action="append",
                    help="with retract: limit to these questions")
    va.add_argument("--notes", help="with publish: why this fit was made")
    va.add_argument("--cohort", help="outcome cohort JSON; the default location "
                                     "or $SPLICR_VALIDATION_COHORT when omitted")
    va.add_argument("--json", action="store_true", help="machine-readable output")
    va.set_defaults(func=cmd_validation)

    sc = sub.add_parser("schema", help="JSON Schema of an API response model")
    sc.add_argument("model", help="model name; 'disagreement' is the guide-disagreement report")
    sc.set_defaults(func=cmd_schema)

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
                   help="plasmid, reference, control or treatment. 'plasmid' is the "
                        "plasmid pool, 'reference' a T0 or day-0 sample; both are "
                        "library references that QC measures dropout against. Inferred "
                        "from the sample label when it says so (plasmid, pDNA, T0, D0, "
                        "input), otherwise from which side of the contrast it is on")
    r.add_argument("--treatment", action="append", metavar="LABEL")
    r.add_argument("--control", action="append", metavar="LABEL")
    r.add_argument("--library", help="library slug; detected when omitted")
    r.add_argument("--cell-line")
    r.add_argument("--model-id", help="DepMap ModelID, enables measured copy-number flagging")
    r.add_argument("--phenotype")
    r.add_argument("--modality", choices=("knockout", "inhibition", "activation"), default="knockout")
    r.add_argument("--condition", help="chemical or experimental condition for Atlas context")
    r.add_argument("--fitness-assay", action=argparse.BooleanOptionalAction, default=None,
                   help="declare whether essential-gene dropout QC is appropriate")
    r.add_argument("--drugz", action="store_true", help="run DrugZ for a chemogenetic contrast")
    r.add_argument("--drugz-paired", action="store_true",
                   help="with --drugz: treatment/control lists are matched pairs in the listed order")
    r.add_argument("--workdir")
    r.add_argument("--persist", action="store_true", help="write results to Postgres")
    r.add_argument("--org", help="organization uuid")
    r.add_argument("--org-slug", default="splicr-engine")
    r.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
