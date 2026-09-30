"""
The source registry: every external dataset SplicR uses or plans to use, where
it lives, what licence governs it, and exactly how much of it SplicR holds.

    python -m splicr sources            # table
    python -m splicr sources --json     # machine-readable, for docs and the web

`status` is the only field anything should branch on, and it is literal:

    lake        harmonized Parquet in data/lake and on R2; queryable now
    local       raw files downloaded and checksummed; not yet in the lake
    remote      not downloaded; queried in place (DuckDB over HTTPS/S3/HF)
    cataloged   metadata ingested, the data themselves are not
    manual      needs a human with a browser (Turnstile / captcha gate)
    controlled  needs a data-access agreement (dbGaP / EGA); not requested
    unreachable host did not answer when last probed

Scale figures are the source's own published numbers, not SplicR's holdings.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    layer: str                      # screening | perturbation | single_cell | baseline_omics | knowledge
    modality: str
    scale: str
    access: str                     # how it is fetched
    url: str
    licence: str
    status: str
    holdings: str                   # what SplicR has, concretely
    lake_datasets: tuple[str, ...] = ()
    harmonized_to: tuple[str, ...] = ()
    connector: str = ""
    notes: str = ""
    urls: tuple[str, ...] = field(default_factory=tuple)


SOURCES: tuple[Source, ...] = (
    # --- A. genetic screening evidence -------------------------------------------------
    Source("depmap", "DepMap Public 26Q1 (Broad)", "screening",
           "CRISPR KO (Chronos), raw guide counts, omics", "1,208 screened models; 2,154 models",
           "portal download (browser-gated)", "https://depmap.org/portal/data_page/?tab=allData",
           "CC BY 4.0", "lake",
           "19 release files (5.4 GB) in data/references/depmap/26Q1 with MD5SUMS; 9 gene-level "
           "matrices (246M values), 2,281 raw-count sequencing runs and 8 map/QC tables in the lake",
           ("depmap_matrix", "depmap_models", "depmap_raw_readcounts", "depmap_guide_map",
            "depmap_sequence_map", "depmap_screen_map", "depmap_screen_qc", "depmap_sequence_qc",
            "depmap_model_conditions", "depmap_omics_profiles"),
           ("HGNC", "Cellosaurus RRID"), "scripts/data/build-depmap-lake.py",
           "The portal serves a Cloudflare Turnstile page to scripts; files are fetched by hand."),
    Source("project_score", "Project Score (Sanger)", "screening", "CRISPR KO, raw counts",
           "~900 screens", "direct download", "https://score.depmap.sanger.ac.uk/downloads",
           "Internal research only; no redistribution", "local",
           "Raw counts and essentiality matrices (3.5 GB) in data/references/projectscore; excluded from R2",
           notes="Licence forbids redistribution, so it never goes to R2 or a public page."),
    Source("biogrid_orcs", "BioGRID ORCS 2.0.18", "screening", "Published CRISPR screen hit calls",
           "~2,200 human screens; 26M gene rows", "direct download (human archive by browser)",
           "https://downloads.thebiogrid.org/BioGRID-ORCS", "MIT", "lake",
           "All five species archives; parsed Atlas store and web snapshot",
           ("screen_hits", "screens"), ("NCBI Gene",), "scripts/data/ingest-orcs.py"),
    Source("crispview", "CRISP-view", "screening", "Uniformly reprocessed CRISPR screens",
           "11,146 samples", "web portal", "http://crispview.weililab.org", "Not stated",
           "unreachable", "None",
           notes="Timed out from this network on 2026-09-29. Overlaps ORCS/DepMap heavily."),
    Source("icsdb", "iCSDB", "screening", "CRISPR/RNAi screens", "1,375 screens, 976 cell lines",
           "web portal", "https://www.kobic.re.kr/icsdb/", "Not stated", "manual", "None",
           notes="No bulk download link exposed; export is per-query through the UI."),
    Source("genomecrispr", "GenomeCRISPR", "screening", "sgRNA-level screen data",
           "84 experiments, 48 cell lines", "web portal", "http://genomecrispr.dkfz.de/",
           "Not stated", "manual", "None",
           notes="The historical bulk file URL now 301-redirects to the portal; no API listing."),
    Source("geo_sra", "NCBI GEO / SRA (CRISPR screens)", "screening", "Deposited screens with raw reads",
           "continuously growing", "E-utilities API", "https://www.ncbi.nlm.nih.gov/geo/",
           "Public domain (NCBI); per-study terms", "cataloged",
           "Watch list of every GEO series describing a pooled CRISPR screen, flagged by SRA raw reads "
           "and by whether the Atlas already holds it",
           ("geo_crispr_series",), (), "scripts/data/ingest-sources.py geo",
           "Detection stage of the autonomous ingest. FASTQ -> count -> MAGeCK runs locally via "
           "`python -m splicr`; unattended execution needs a worker (see docs/01-architecture.md)."),
    Source("encode", "ENCODE functional characterization", "screening",
           "CRISPR screens of regulatory elements", "904 released records", "REST API",
           "https://www.encodeproject.org/", "CC0 / ENCODE data use policy", "cataloged",
           "Experiment and series metadata with examined loci", ("encode_functional_screens",), (),
           "scripts/data/ingest-sources.py encode"),

    # --- B. perturbational biology ---------------------------------------------------------
    Source("tahoe100m", "Tahoe-100M (Arc Virtual Cell Atlas)", "perturbation",
           "scRNA-seq under 379 drugs x 50 cancer lines", "~100M cells; 3,388 parquet shards",
           "Hugging Face / GCS", "https://huggingface.co/datasets/tahoebio/Tahoe-100M", "CC0 1.0",
           "remote",
           "Drug, cell-line, sample and gene metadata harmonized (drugs -> ChEMBL, lines -> RRID); "
           "cell matrices and ~92 GB pseudobulk DE queried in place",
           ("tahoe_drugs", "tahoe_cell_lines", "tahoe_samples"), ("ChEMBL", "Cellosaurus RRID"),
           "scripts/data/ingest-sources.py tahoe",
           urls=("gs://arc-institute-virtual-cell-atlas/tahoe100M/",)),
    Source("scbasecount", "scBaseCount (Arc Virtual Cell Atlas)", "single_cell",
           "Uniformly re-aligned public scRNA-seq", "500M+ cells across 26 species",
           "GCS (public, anonymous)", "https://github.com/ArcInstitute/arc-virtual-cell-atlas",
           "CC0 1.0", "cataloged",
           "Per-sample (SRX) metadata for every species, release 2026-01-12; count matrices stay on GCS",
           ("scbasecount_samples",), (), "scripts/data/ingest-sources.py scbasecount",
           urls=("gs://arc-institute-virtual-cell-atlas/scbasecount/2026-01-12/",)),
    Source("jump", "JUMP Cell Painting (cpg0016)", "perturbation",
           "Cell Painting morphology: CRISPR, ORF, compounds", "~136k perturbations; ~116 TB images",
           "AWS Open Data (anonymous S3)", "https://registry.opendata.aws/cellpainting-gallery/",
           "CC0 1.0", "lake",
           "All perturbation metadata (genes -> Ensembl + HGNC, compounds -> ChEMBL) and gene-level consensus "
           "morphology embeddings from the consortium's batch-corrected CRISPR and ORF profiles",
           ("jump_perturbations", "jump_crispr_gene_morphology", "jump_orf_gene_morphology"),
           ("Ensembl gene", "HGNC", "ChEMBL"), "scripts/data/ingest-sources.py jump",
           "Raw TIFFs and the 2.8 GB compound profile table remain on S3.",
           urls=("s3://cellpainting-gallery/cpg0016-jump/", "https://github.com/jump-cellpainting/datasets")),
    Source("replogle2022", "Genome-scale Perturb-seq (Replogle 2022)", "perturbation",
           "CRISPRi Perturb-seq, K562 genome-wide and RPE1", "~2.5M cells; ~9.8k K562 knockdowns",
           "figshare+", "https://plus.figshare.com/articles/dataset/20029387", "CC BY 4.0", "lake",
           "Authors' pseudobulk z-normalized signatures, one vector per knockdown (targets -> Ensembl + HGNC)",
           ("perturbseq_k562_signatures", "perturbseq_rpe1_signatures",
            "perturbseq_k562_readout_genes", "perturbseq_rpe1_readout_genes"), ("Ensembl gene", "HGNC"),
           "scripts/data/ingest-sources.py perturbseq",
           "Single-cell matrices (66 GB K562 gwps) not downloaded."),
    Source("scperturb", "scPerturb", "perturbation", "44 harmonized perturbation datasets (h5ad)",
           "54 files, 43 GB", "Zenodo", "https://scperturb.org/", "CC BY 4.0", "remote",
           "File inventory recorded; Replogle is taken from the authors' pseudobulk instead",
           urls=("https://zenodo.org/records/13350497",)),
    Source("lincs_l1000", "LINCS L1000 phase II (GSE70138)", "perturbation",
           "978-gene L1000 expression signatures", "118,050 Level 5 signatures; 345,976 profiles",
           "NCBI GEO FTP", "https://www.ncbi.nlm.nih.gov/geo/query/acc.cgi?acc=GSE70138",
           "Public (GEO); LINCS data release policy", "cataloged",
           "Signature, perturbagen, cell and gene metadata (lines -> RRID, compounds -> ChEMBL); "
           "5.4 GB Level 5 matrix registered for in-place reads",
           ("lincs_signatures",), ("Cellosaurus RRID", "ChEMBL"), "scripts/data/ingest-sources.py lincs"),

    # --- baseline multi-omics -------------------------------------------------------------
    Source("ccle_omics", "CCLE baseline omics (via DepMap 26Q1)", "baseline_omics",
           "Expression (TPM), WGS copy number, somatic mutations", "1,775 expression / 1,132 WGS models",
           "portal download", "https://depmap.org/portal/data_page/?tab=allData", "CC BY 4.0", "lake",
           "Processed matrices in depmap_matrix (expression_tpm_log1p, copy_number_wgs, mutation_*)",
           ("depmap_matrix",), ("HGNC", "Cellosaurus RRID"), "scripts/data/build-depmap-lake.py",
           "Raw CCLE BAM/FASTQ (SRA PRJNA523380) are hundreds of TB and not needed for model-level context."),
    Source("tcga", "TCGA", "baseline_omics", "Tumour WGS/WES/RNA-seq", "~11k patients; PB-scale raw",
           "GDC (dbGaP-controlled for raw reads)", "https://portal.gdc.cancer.gov/",
           "Open tier: NIH GDS policy; raw: dbGaP authorization", "controlled", "None",
           notes="Raw BAM/FASTQ require an approved dbGaP request; the open-tier processed files can be "
                 "added through the GDC API without one."),
    Source("gtex", "GTEx", "baseline_omics", "Normal tissue RNA-seq / WGS", "~1k donors, 54 tissues",
           "GTEx portal / AnVIL (raw is dbGaP-controlled)", "https://gtexportal.org/", "Open processed; raw controlled",
           "controlled", "None",
           notes="Processed TPM matrices are open and are the right input for 'non-essential in healthy tissue'."),

    # --- knowledge graph ------------------------------------------------------------------
    Source("string", "STRING v12.0", "knowledge", "Protein-protein interactions", "Human: ~13M scored links",
           "direct download", "https://string-db.org/", "CC BY 4.0", "lake",
           "Full human network; high-confidence edges in the knowledge graph", ("kg_edges",), ("Ensembl gene", "HGNC")),
    Source("reactome", "Reactome", "knowledge", "Pathway membership", "~2.7k human pathways",
           "direct download", "https://reactome.org/", "CC BY 4.0", "lake",
           "Pathway gene sets in the knowledge graph", ("kg_edges",), ("Ensembl gene", "HGNC")),
    Source("opentargets", "Open Targets Platform 26.09", "knowledge",
           "Drug-target mechanisms, target-disease evidence", "19,170 molecules; 6,092 mechanisms",
           "EBI FTP", "https://platform.opentargets.org/", "CC0 (component terms apply)", "lake",
           "Targets, drugs, mechanisms, associations; drug->target edges in the knowledge graph",
           ("kg_edges",), ("Ensembl", "ChEMBL")),
    Source("cellosaurus", "Cellosaurus 56.0", "knowledge", "Cell line nomenclature (RRID)",
           "~169k cell lines", "direct download", "https://www.cellosaurus.org/", "CC BY 4.0", "local",
           "Full flat file; the authority for cell-line harmonization", (), (),
           "engine/splicr/harmonize.py"),
    Source("hgnc", "HGNC complete set", "knowledge", "Gene nomenclature", "~44k approved loci",
           "direct download", "https://www.genenames.org/", "CC0", "local",
           "Full set; the authority for gene harmonization", (), (), "engine/splicr/harmonize.py"),
)


def by_id(source_id: str) -> Source:
    for s in SOURCES:
        if s.id == source_id:
            return s
    raise KeyError(source_id)


def as_json() -> str:
    return json.dumps([asdict(s) for s in SOURCES], indent=2)


def summary() -> dict[str, int]:
    out: dict[str, int] = {}
    for s in SOURCES:
        out[s.status] = out.get(s.status, 0) + 1
    return out


# Remote reads: the large sources are queried where they live. DuckDB reads only
# the row groups and columns a query touches, so a per-drug count over Tahoe
# transfers a few hundred MB, not the ~300 GB of shards.
REMOTE_PATHS = {
    "tahoe100m_cells": "hf://datasets/tahoebio/Tahoe-100M/data/*.parquet",
    "tahoe100m_pseudobulk_de": "hf://datasets/tahoebio/Tahoe-100M/metadata/pseudobulk_differential_expression/*.parquet",
    "jump_compound_profiles": "https://cellpainting-gallery.s3.amazonaws.com/cpg0016-jump-assembled/source_all/"
                              "workspace/profiles_assembled/COMPOUND/v1.0/profiles_var_mad_int_featselect_harmony.parquet",
    "scbasecount_human_cells": "https://storage.googleapis.com/arc-institute-virtual-cell-atlas/scbasecount/"
                               "2026-01-12/metadata/Gene/Homo_sapiens/obs_metadata.parquet",
}
