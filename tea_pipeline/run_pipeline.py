"""
TxScore Pipeline Orchestrator
Runs all 9 loading steps in sequence, with progress tracking and error recovery.

Usage:
    python run_pipeline.py              # Run all steps
    python run_pipeline.py --from 4     # Resume from step 4
    python run_pipeline.py --steps 1,3  # Run only steps 1 and 3
    python run_pipeline.py --check      # Print current DB row counts
"""
import sys
import os
import argparse
import time
import subprocess
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

STEPS = [
    (1,  "01_load_metadata.py",      "Tissue & cancer metadata"),
    (2,  "02_load_genes_master.py",  "Gene master table (gnomAD + GTEx + UniProt)"),
    (3,  "03_load_depmap.py",        "DepMap CRISPR essentiality (~17M rows)"),
    (4,  "04_load_gtex.py",          "GTEx tissue expression (~1.1M rows)"),
    (5,  "05_load_gnomad.py",        "gnomAD v4.1 constraint metrics"),
    (6,  "06_load_clinvar.py",       "ClinVar clinical variants"),
    (7,  "07_load_dgidb.py",         "DGIdb drug interactions"),
    (8,  "08_load_alphafold.py",     "AlphaFold structure metadata"),
    (9,  "09_compute_txscore.py",    "TxScore computation (~600K scores)"),
]


def check_status():
    """Print current row counts for all tx_ tables."""
    try:
        from utils.db import transaction, count_rows
        tables = [
            "tx_genes_master", "tx_cell_line_metadata", "tx_depmap_data",
            "tx_gtex_expression", "tx_gnomad_constraint", "tx_alphafold_structures",
            "tx_clinvar_variants", "tx_drug_interactions", "tx_clinical_trials",
            "tx_txscore_cache",
        ]
        print(f"\n{'Table':<35} {'Rows':>12}")
        print("─" * 50)
        for t in tables:
            try:
                n = count_rows(t)
                print(f"{t:<35} {n:>12,}")
            except Exception as e:
                print(f"{t:<35} {'ERROR':>12}")
        print()
    except Exception as e:
        print(f"Error connecting to DB: {e}")


def run_step(step_num: int, script: str, description: str) -> bool:
    """Run a single pipeline step. Returns True on success."""
    print(f"\n{'='*70}")
    print(f"STEP {step_num}: {description}")
    print(f"Script: {script}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*70}\n")

    start = time.time()
    script_path = os.path.join(os.path.dirname(__file__), script)

    result = subprocess.run(
        [sys.executable, script_path],
        cwd=os.path.dirname(__file__)
    )

    elapsed = time.time() - start
    mins, secs = divmod(int(elapsed), 60)

    if result.returncode == 0:
        print(f"\n✓ Step {step_num} completed in {mins}m {secs}s")
        return True
    else:
        print(f"\n✗ Step {step_num} FAILED (exit code {result.returncode}) after {mins}m {secs}s")
        return False


def main():
    parser = argparse.ArgumentParser(description="TxScore data pipeline")
    parser.add_argument("--from",    type=int, dest="from_step", default=1,
                        help="Start from this step number (default: 1)")
    parser.add_argument("--steps",   type=str, dest="steps",
                        help="Comma-separated list of step numbers to run (e.g. 1,3,5)")
    parser.add_argument("--check",   action="store_true",
                        help="Print current DB row counts and exit")
    args = parser.parse_args()

    if args.check:
        check_status()
        return

    # Determine which steps to run
    if args.steps:
        step_nums = {int(s.strip()) for s in args.steps.split(",")}
        steps_to_run = [(n, s, d) for (n, s, d) in STEPS if n in step_nums]
    else:
        steps_to_run = [(n, s, d) for (n, s, d) in STEPS if n >= args.from_step]

    if not steps_to_run:
        print("No steps to run.")
        return

    print(f"\n{'='*70}")
    print("TxScore Data Pipeline")
    print(f"Running {len(steps_to_run)} step(s): {[n for n,_,_ in steps_to_run]}")
    print(f"{'='*70}")

    pipeline_start = time.time()
    failed_steps   = []

    for step_num, script, description in steps_to_run:
        success = run_step(step_num, script, description)
        if not success:
            failed_steps.append(step_num)
            print(f"\nStep {step_num} failed. Continue? [y/N]: ", end="", flush=True)
            response = input().strip().lower()
            if response != "y":
                break

    total_elapsed = time.time() - pipeline_start
    mins, secs    = divmod(int(total_elapsed), 60)

    print(f"\n{'='*70}")
    print(f"Pipeline {'COMPLETED' if not failed_steps else 'FINISHED WITH ERRORS'}")
    print(f"Total time: {mins}m {secs}s")
    if failed_steps:
        print(f"Failed steps: {failed_steps}")
        print(f"To retry:  python run_pipeline.py --steps {','.join(map(str, failed_steps))}")
    print(f"{'='*70}\n")

    # Final status
    check_status()


if __name__ == "__main__":
    main()
