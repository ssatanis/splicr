"""
SplicR autonomous ingest on Modal.

    modal deploy engine/modal_app.py                                  # schedules go live
    modal run engine/modal_app.py::main --action discover --since 2026-09-01
    modal run engine/modal_app.py::main --action request --accession GSE123456   # a lab's own deposit
    modal run engine/modal_app.py::main --action plan --accession GSE145743
    modal run engine/modal_app.py::main --action process --accession GSE145743
    modal run engine/modal_app.py::main --action sweep

Schedules once deployed (UTC):

    discover_daily  07:00  GEO + SRA + ENA since the watermark; plans every new
                           study the classifier calls a screen
    sweep           every 2 h  plans unplanned screens, processes planned ones
                           (bounded per sweep), retries FASTQ that ENA had not
                           yet generated

Each unit of work is one of splicr.ingest.runner.{discover, plan, process}; the
functions here only give them compute. State lives in Supabase (ingest.*),
results in R2 and Supabase, reference data in the `splicr-reference-data`
volume, credentials in the `splicr-ingest` secret. Nothing in the container is
kept between runs.

The image pins the same analysis stack as engine/environment.yml: MAGeCK
0.5.9.5 from bioconda, numpy < 2 for BAGEL2, pandas 2 for DrugZ.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import modal

ENGINE = Path(__file__).resolve().parent


def _git_version() -> str:
    try:
        sha = subprocess.run(["git", "-C", str(ENGINE), "rev-parse", "--short=12", "HEAD"],
                             capture_output=True, text=True, check=True).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(ENGINE), "status", "--porcelain", "--", "splicr"],
                               capture_output=True, text=True).stdout.strip()
        return f"{sha}{'+dirty' if dirty else ''}"
    except Exception:  # noqa: BLE001 - only informational
        return "unknown"


PIPELINE_VERSION = _git_version() if modal.is_local() else None

image = (
    modal.Image.micromamba(python_version="3.11")
    .apt_install("git", "curl", "procps")
    .micromamba_install(
        "mageck=0.5.9.5", "fastqc=0.12.1", "bowtie=1.3.1", "numpy<2", "scipy", "pandas=2.2", "click",
        "libstdcxx-ng", "libgcc-ng",
        channels=["conda-forge", "bioconda"],
    )
    # conda's scipy is built against a newer libstdc++ than Debian's; without
    # this the first `import scipy.stats` (BAGEL2, DrugZ) dies with CXXABI_1.3.15.
    .env({"LD_LIBRARY_PATH": "/opt/conda/lib"})
    .pip_install(
        "duckdb==1.5.5", "pyarrow==25.0.1", "psycopg[binary]==3.3.6", "requests==2.34.2", "boto3==1.43.103",
        "scikit-learn==1.9.1", "statsmodels", "openpyxl==3.1.5",
    )
    .run_commands(
        # Same BAGEL2 commit as the local engine/.tools/bagel2 (v2.0 build 115).
        "git clone -q https://github.com/hart-lab/bagel.git /opt/tools/bagel2"
        " && git -C /opt/tools/bagel2 checkout -q 53388adbb4fb0931e5c9dda135502be19e4555f0",
        "git clone -q https://github.com/hart-lab/drugz.git /opt/tools/drugz",
        "git -C /opt/tools/bagel2 rev-parse HEAD > /opt/tools/bagel2/COMMIT",
        "git -C /opt/tools/drugz rev-parse HEAD > /opt/tools/drugz/COMMIT",
        "mageck -v && fastqc --version && python /opt/tools/bagel2/BAGEL.py version | head -3",
    )
    .env({
        "SPLICR_REFERENCE_DIR": "/refs/references",
        "SPLICR_TOOLS_DIR": "/opt/tools",
        "SPLICR_TOOL_BIN": "/opt/conda/bin",
        "SPLICR_WORK_DIR": "/tmp/splicr-work",
        "SPLICR_PIPELINE_VERSION": PIPELINE_VERSION or "",
        "PYTHONUNBUFFERED": "1",
    })
    .add_local_dir(ENGINE / "splicr", "/root/splicr",
                   ignore=["**/__pycache__/**", "**/*.pyc", "**/cache/**"])
)

app = modal.App("splicr-ingest", image=image)
refs = modal.Volume.from_name("splicr-reference-data")
secret = modal.Secret.from_name("splicr-ingest")
COMMON = dict(secrets=[secret], volumes={"/refs": refs})

MAX_PROCESS_PER_SWEEP = 6
# Plan everything the classifier calls "screen" or "maybe" (score >= 0.40). On
# the held-out labels, "screen" alone recalls 0.61 of true screens and
# "screen or maybe" 0.92 (research/artifacts/ingest/classifier_eval.json).
# Planning is cheap; design inference, which refuses what it cannot place
# confidently, is the real gate before any compute is spent.
MIN_SCORE_TO_PLAN = 0.40


# Planning is bound by two independent budgets, not by CPU. NCBI E-utilities
# allow 10 req/s per API key across every container, so PLANNERS is passed to
# the workers as SPLICR_NCBI_WORKERS and each one paces itself at 1/PLANNERS of
# that; the aggregate stays legal however many run. ENA (filereport, and the
# read probe that streams a FASTQ prefix) has its own per-host budget and is
# what actually parallelises, which is why more containers still help.
PLANNERS = 12


@app.function(**COMMON, cpu=1.0, memory=2048, timeout=1800, max_containers=PLANNERS,
              env={"SPLICR_NCBI_WORKERS": str(PLANNERS)})
def plan_study(accession: str) -> dict:
    from splicr.ingest import runner
    return runner.plan(accession)


@app.function(**COMMON, cpu=8.0, memory=16384, ephemeral_disk=512 * 1024, timeout=6 * 3600,
              max_containers=8)
def process_study(accession: str) -> dict:
    from splicr.ingest import runner
    return runner.process(accession, processes=8)


@app.function(**COMMON, cpu=1.0, memory=2048, timeout=1800)
def request_study(accession: str) -> dict:
    """A lab's request: record, plan, and start processing if the plan is ready."""
    from splicr.ingest import runner
    out = runner.request(accession)
    if out.get("status") == "ready":
        out["processing"] = process_study.spawn(out["accession"]).object_id
    return out


@app.function(**COMMON, cpu=1.0, memory=2048, timeout=3600)
def discover(since: str | None = None, until: str | None = None) -> dict:
    from datetime import date

    from splicr.ingest import runner
    return runner.discover(date.fromisoformat(since) if since else None,
                           date.fromisoformat(until) if until else None)


@app.function(**COMMON, cpu=1.0, memory=1024, timeout=1800)
def sweep(max_process: int = MAX_PROCESS_PER_SWEEP) -> dict:
    """Hand the next pieces of work to plan_study / process_study."""
    from splicr.ingest import state

    with state.connect() as conn:
        to_plan = state.pending(conn, "discovered", limit=50, min_score=MIN_SCORE_TO_PLAN)
        to_process = state.pending(conn, "planned", limit=max_process)
    for acc in to_plan:
        plan_study.spawn(acc)
    for acc in to_process:
        process_study.spawn(acc)
    return {"planning": to_plan, "processing": to_process}


@app.function(**COMMON, cpu=1.0, memory=2048, timeout=3600, schedule=modal.Cron("0 7 * * *"))
def discover_daily() -> dict:
    out = discover.local()
    out["sweep"] = sweep.local()
    return out


@app.function(**COMMON, cpu=0.25, memory=512, timeout=600, schedule=modal.Period(hours=2))
def sweep_scheduled() -> dict:
    return sweep.local()


@app.function(**COMMON, cpu=1.0, memory=2048, timeout=900)
def doctor() -> dict:
    """Every tool and reference the ingest needs, checked inside the container."""
    import os
    import shutil

    out = {}
    for tool, cmd in {"mageck": ["mageck", "-v"], "fastqc": ["fastqc", "--version"],
                      "bagel2": ["python", "/opt/tools/bagel2/BAGEL.py", "version"]}.items():
        p = subprocess.run(cmd, capture_output=True, text=True)
        out[tool] = (p.stdout or p.stderr).strip().splitlines()[:2] if p.returncode == 0 else f"FAILED {p.stderr[-300:]}"
    out["RRA_on_path"] = shutil.which("RRA")
    # Run BAGEL2 exactly as the pipeline does (fc then bf) on a synthetic
    # dropout, so a broken interpreter path or missing gene sets fails here and
    # not as a quiet warning inside a published screen.
    import random
    import tempfile

    from splicr.hits import run_bagel2
    ess = [l.split()[0] for l in open("/opt/tools/bagel2/CEGv2.txt").read().split("\n")[1:] if l.strip()][:120]
    non = [l.split()[0] for l in open("/opt/tools/bagel2/NEGv1.txt").read().split("\n")[1:] if l.strip()][:120]
    rnd = random.Random(0)
    with tempfile.TemporaryDirectory() as tmp:
        counts = Path(tmp) / "counts.txt"
        with counts.open("w") as fh:
            fh.write("sgRNA\tGene\tT0\tD21a\tD21b\n")
            for gene in ess + non:
                for k in range(4):
                    # Overlapping fold-change distributions, as in a real screen:
                    # essentials drop ~2.5x with log-normal guide noise.
                    base = rnd.randint(300, 600)
                    shift = -1.3 if gene in ess else 0.0
                    d = [max(1, int(base * 2 ** rnd.gauss(shift, 0.7))) for _ in range(2)]
                    fh.write(f"{gene}_{k}\t{gene}\t{base}\t{d[0]}\t{d[1]}\n")
        bf = run_bagel2(counts, Path(tmp) / "bagel", ["T0", "D21a", "D21b"], ["T0"], ["D21a", "D21b"])
        out["bagel2_run"] = {"genes": len(bf), "mean_bf_essential": round(sum(bf[g] for g in ess if g in bf) / len(ess), 2),
                             "mean_bf_nonessential": round(sum(bf[g] for g in non if g in bf) / len(non), 2)}
    import numpy, pandas
    out["numpy"], out["pandas"] = numpy.__version__, pandas.__version__
    ref = Path(os.environ["SPLICR_REFERENCE_DIR"])
    out["references"] = sorted(p.name for p in ref.iterdir()) if ref.exists() else "MISSING"
    from splicr.references import available_libraries
    out["libraries"] = available_libraries()
    from splicr.ingest import state
    with state.connect() as conn:
        out["db"] = conn.execute("select count(*) from ingest.studies").fetchone()[0]
    return out


@app.local_entrypoint()
def main(action: str = "sweep", accession: str = "", since: str = "", until: str = ""):
    if action == "discover":
        print(discover.remote(since or None, until or None))
    elif action == "request":
        print(request_study.remote(accession))
    elif action == "plan":
        print(plan_study.remote(accession))
    elif action == "process":
        print(process_study.remote(accession))
    elif action == "sweep":
        print(sweep.remote())
    elif action == "doctor":
        import json
        print(json.dumps(doctor.remote(), indent=2))
    else:
        raise SystemExit(f"unknown action {action!r}: discover | request | plan | process | sweep | doctor")
