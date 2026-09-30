"""
Autonomous ingest of deposited CRISPR screens from NCBI GEO, SRA and ENA.

Stage contracts live in `models.py`. Modules:

    discover   search GEO / SRA / ENA for new studies since a watermark
    classify   score whether a study is a pooled CRISPR screen
    metadata   run-level metadata (ENA filereport) joined to GEO sample characteristics
    design     infer sample roles, contrasts, modality and entities -> StudyPlan
    fetch      download FASTQ over HTTPS, verify md5, run FastQC
    analyze    run the SplicR pipeline on a StudyPlan
    publish    write harmonized results to the lake and Postgres
    state      ingest.* table access (status transitions, watermarks, events)

`engine/modal_app.py` runs these on Modal; `orchestration/airflow` wraps the
same Modal functions for teams that schedule with Airflow.
"""
