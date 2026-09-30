#!/usr/bin/env python
"""
Acceptance test for the ingest engine's execution stages, on a real screen.

GSE145743 (olaparib x GeCKO v2 in HeLa; Juhász et al. 2020, PMID 33355125) has a
known design, curated by hand in data/testdata/GSE145743/metadata/sample_sheet.tsv
and a known expected hit (CHD1L sensitizes to olaparib). This script seeds that
design as a StudyPlan, bypassing automatic design inference, so fetch -> md5 ->
FastQC -> count -> QC -> MAGeCK/BAGEL2 -> harmonize -> publish can be checked on
their own. The same accession is then planned automatically and the inferred
plan compared with this one.

    set -a; source .env; set +a
    engine/.tools/env/bin/python scripts/data/ingest-acceptance-gse145743.py seed
    modal run engine/modal_app.py::main --action process --accession GSE145743
    engine/.tools/env/bin/python scripts/data/ingest-acceptance-gse145743.py check
"""

from __future__ import annotations

import csv
import io
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))

from splicr.ingest import state  # noqa: E402
from splicr.ingest.models import (Contrast, RunRecord, SampleRole, StudyCandidate,  # noqa: E402
                                  StudyPlan)

ACC = "GSE145743"
SHEET = ROOT / "data/testdata/GSE145743/metadata/sample_sheet.tsv"
ENA = ("https://www.ebi.ac.uk/ena/portal/api/filereport?accession=PRJNA608032&result=read_run"
       "&fields=run_accession,experiment_accession,sample_accession,fastq_ftp,fastq_md5,fastq_bytes,"
       "read_count,base_count,library_layout,library_strategy,instrument_model&format=tsv")


def build() -> tuple[StudyCandidate, StudyPlan]:
    ena = {r["run_accession"]: r for r in csv.DictReader(
        io.StringIO(urllib.request.urlopen(ENA, timeout=60).read().decode()), delimiter="\t")}
    runs, roles = [], []
    role_map = {"plasmid": "plasmid", "T0_input": "reference", "DMSO": "control", "olaparib": "treatment"}
    for row in csv.DictReader(open(SHEET), delimiter="\t"):
        e = ena[row["run_accession"]]
        runs.append(RunRecord(
            run=row["run_accession"], experiment=e["experiment_accession"], sample=e["sample_accession"],
            geo_sample=row["gsm"], sample_title=row["geo_sample_title"],
            library_strategy=e["library_strategy"], library_layout=e["library_layout"],
            instrument=e["instrument_model"], read_count=int(e["read_count"]), base_count=int(e["base_count"]),
            fastq_urls=["https://" + u for u in e["fastq_ftp"].split(";")],
            fastq_md5=e["fastq_md5"].split(";"), fastq_bytes=[int(b) for b in e["fastq_bytes"].split(";")]))
        arm = row["arm"]
        label = f"lib{row['half_library']}_{arm}" + (f"_rep{row['replicate']}" if row["replicate"] else "")
        roles.append(SampleRole(run=row["run_accession"], label=label, role=role_map[arm.split("_rep")[0]],
                                condition=arm, replicate=row["replicate"] or None, confidence=1.0,
                                evidence=["hand-curated sample sheet (acceptance test)"]))
    lab = {r.condition: [] for r in roles}
    for r in roles:
        lab[r.condition].append(r.label)
    dmso = [r.label for r in roles if r.condition == "DMSO"]
    olap = [r.label for r in roles if r.condition == "olaparib"]
    t0 = [r.label for r in roles if r.condition == "T0_input"]
    cand = StudyCandidate(
        accession=ACC, source="geo",
        title="Genome-wide CRISPR knockout screen using GeCKO v2 to identify synthetic lethal "
              "interactions with the PARP inhibitor Olaparib",
        organism="Homo sapiens", taxid=9606,
        xrefs={"geo": ACC, "bioproject": "PRJNA608032", "sra_study": "SRP250346"},
        pubmed_ids=["33355125"], first_public="2020-08-01", n_runs=len(runs), score=1.0, verdict="screen",
        reasons=["acceptance-test seed: design curated by hand"])
    plan = StudyPlan(
        accession=ACC, taxid=9606, runs=runs, roles=roles,
        contrasts=[Contrast("dropout_T0_vs_DMSO", treatment=dmso, control=t0, kind="dropout"),
                   Contrast("olaparib_vs_DMSO", treatment=olap, control=dmso, kind="drug_modifier")],
        modality="knockout", phenotype="proliferation; olaparib sensitivity",
        cell_line_raw="HeLa (mCAT1)", cell_line_rrid="CVCL_0030",
        compound_raw="olaparib", compound_chembl="CHEMBL521686",
        library_hint="GeCKO v2 A and B", confidence=1.0, status="ready", issues=[])
    return cand, plan


def seed() -> None:
    cand, plan = build()
    with state.connect() as conn:
        print(state.upsert_candidates(conn, [cand]))
        cur = state.status_of(conn, ACC)
        if cur not in ("discovered", "needs_review", "failed"):
            conn.execute("update ingest.studies set status = 'discovered', attempts = 0 where accession = %s", (ACC,))
        state.save_plan(conn, plan)
        state.event(conn, ACC, "plan", "ok", "acceptance-test plan seeded from the curated sample sheet")
        print(state.status_of(conn, ACC), len(plan.runs), "runs,", len(plan.contrasts), "contrasts")


def check() -> None:
    with state.connect() as conn:
        print(conn.execute("select status, error_stage, left(error, 300), atlas_screen_id from ingest.studies "
                           "where accession = %s", (ACC,)).fetchone())
        for r in conn.execute("select stage, status, message from ingest.events where accession = %s "
                              "order by at", (ACC,)).fetchall():
            print(" ", r)
        rows = conn.execute("""
            select s.source_id, s.n_genes, s.n_hits, s.cell_line_rrid, s.compound_chembl,
                   (select string_agg(h.gene_symbol || ' ' || h.ensembl_gene_id || ' fdr=' || round(h.fdr::numeric, 4)
                                      || ' ' || h.direction, '; ' order by h.fdr) filter (where h.gene_symbol = 'CHD1L')
                    from atlas.screen_hits h where h.screen_id = s.id) as chd1l
            from atlas.screens s where s.ingest_accession = %s order by 1""", (ACC,)).fetchall()
        for r in rows:
            print(" ", r)


if __name__ == "__main__":
    {"seed": seed, "check": check}[sys.argv[1] if len(sys.argv) > 1 else "check"]()
