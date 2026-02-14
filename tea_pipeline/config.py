"""
TxScore Pipeline Configuration
"""
import os
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────
ROOT_DIR = Path(__file__).parent
DATA_DIR = ROOT_DIR.parent / "tea_data"

# ─── Database ─────────────────────────────────────────────────────────────────
# Session pooler (IPv4-compatible)
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres.bxfrhmvkylipqdtoehii:SplicRCornell01@aws-0-us-west-2.pooler.supabase.com:5432/postgres"
)

# ─── Data Files ───────────────────────────────────────────────────────────────
DEPMAP_GENE_EFFECT   = DATA_DIR / "CRISPRGeneEffect.csv"
DEPMAP_GENE_DEP      = DATA_DIR / "CRISPRGeneDependency.csv"
DEPMAP_MODEL         = DATA_DIR / "Model.csv"

GTEX_MEDIAN_TPM      = DATA_DIR / "GTEx_Analysis_2017-06-05_v8_RNASeQCv1.1.9_gene_median_tpm.gct.gz"

GNOMAD_CONSTRAINT    = DATA_DIR / "gnomad.v4.1.constraint_metrics.tsv"

ALPHAFOLD_TAR        = DATA_DIR / "UP000005640_9606_HUMAN_v6.tar"

CLINVAR_VARIANTS     = DATA_DIR / "variant_summary.txt.gz"
CLINVAR_GENE_COND    = DATA_DIR / "gene_condition_source_id.txt"

UNIPROT_DAT          = DATA_DIR / "UP000005640_9606.dat.gz"

DGIDB_INTERACTIONS   = DATA_DIR / "interactions.tsv"
DGIDB_GENES          = DATA_DIR / "genes.tsv"

AACT_ZIP             = DATA_DIR / "7nnf9i1u9swkf95mjeko54v2vuvf.zip"

# ─── Processing ───────────────────────────────────────────────────────────────
BATCH_SIZE      = 2000      # rows per DB upsert
DEPMAP_RELEASE  = "25Q3"
ALPHAFOLD_VER   = "v6"
GTEX_VERSION    = "v8"
GNOMAD_VERSION  = "v4.1"

# ─── Cancer-type metadata (TCGA/OncotreeCodes) ────────────────────────────────
CANCER_TYPE_METADATA = {
    "LUAD":       {"name": "Lung Adenocarcinoma",                          "tissue": "Lung",         "category": "carcinoma"},
    "LUSC":       {"name": "Lung Squamous Cell Carcinoma",                 "tissue": "Lung",         "category": "carcinoma"},
    "BRCA":       {"name": "Breast Invasive Carcinoma",                    "tissue": "Breast",       "category": "carcinoma"},
    "COAD":       {"name": "Colon Adenocarcinoma",                         "tissue": "Colon",        "category": "carcinoma"},
    "READ":       {"name": "Rectal Adenocarcinoma",                        "tissue": "Rectum",       "category": "carcinoma"},
    "GBM":        {"name": "Glioblastoma Multiforme",                      "tissue": "Brain",        "category": "glioma"},
    "LGG":        {"name": "Brain Lower Grade Glioma",                     "tissue": "Brain",        "category": "glioma"},
    "OV":         {"name": "Ovarian Serous Cystadenocarcinoma",            "tissue": "Ovary",        "category": "carcinoma"},
    "KIRC":       {"name": "Kidney Clear Cell Carcinoma",                  "tissue": "Kidney",       "category": "carcinoma"},
    "KIRP":       {"name": "Kidney Papillary Cell Carcinoma",              "tissue": "Kidney",       "category": "carcinoma"},
    "HNSC":       {"name": "Head and Neck Squamous Cell Carcinoma",        "tissue": "Head/Neck",    "category": "carcinoma"},
    "BLCA":       {"name": "Bladder Urothelial Carcinoma",                 "tissue": "Bladder",      "category": "carcinoma"},
    "STAD":       {"name": "Stomach Adenocarcinoma",                       "tissue": "Stomach",      "category": "carcinoma"},
    "SKCM":       {"name": "Skin Cutaneous Melanoma",                      "tissue": "Skin",         "category": "melanoma"},
    "LIHC":       {"name": "Liver Hepatocellular Carcinoma",               "tissue": "Liver",        "category": "carcinoma"},
    "CESC":       {"name": "Cervical Squamous Cell Carcinoma",             "tissue": "Cervix",       "category": "carcinoma"},
    "SARC":       {"name": "Sarcoma",                                      "tissue": "Soft Tissue",  "category": "sarcoma"},
    "LAML":       {"name": "Acute Myeloid Leukemia",                       "tissue": "Blood",        "category": "hematologic"},
    "DLBC":       {"name": "Diffuse Large B-Cell Lymphoma",                "tissue": "Lymph Node",   "category": "hematologic"},
    "MM":         {"name": "Multiple Myeloma",                             "tissue": "Blood",        "category": "hematologic"},
    "MESO":       {"name": "Mesothelioma",                                 "tissue": "Pleura",       "category": "carcinoma"},
    "PRAD":       {"name": "Prostate Adenocarcinoma",                      "tissue": "Prostate",     "category": "carcinoma"},
    "THCA":       {"name": "Thyroid Carcinoma",                            "tissue": "Thyroid",      "category": "carcinoma"},
    "UCEC":       {"name": "Uterine Corpus Endometrial Carcinoma",         "tissue": "Uterus",       "category": "carcinoma"},
    "ESCA":       {"name": "Esophageal Carcinoma",                         "tissue": "Esophagus",    "category": "carcinoma"},
    "PAAD":       {"name": "Pancreatic Adenocarcinoma",                    "tissue": "Pancreas",     "category": "carcinoma"},
    "PCPG":       {"name": "Pheochromocytoma and Paraganglioma",           "tissue": "Adrenal",      "category": "other"},
    "ACC":        {"name": "Adrenocortical Carcinoma",                     "tissue": "Adrenal",      "category": "carcinoma"},
    "CHOL":       {"name": "Cholangiocarcinoma",                           "tissue": "Bile Duct",    "category": "carcinoma"},
    "TGCT":       {"name": "Testicular Germ Cell Tumor",                   "tissue": "Testis",       "category": "other"},
    "THYM":       {"name": "Thymoma",                                      "tissue": "Thymus",       "category": "other"},
    "HGSOC":      {"name": "High-Grade Serous Ovarian Cancer",             "tissue": "Ovary",        "category": "carcinoma"},
    "pan-cancer": {"name": "Pan-Cancer (All Types)",                       "tissue": "All",          "category": "pan-cancer"},
}

# ─── GTEx Tissue Metadata ─────────────────────────────────────────────────────
TISSUE_METADATA = {
    "Adipose - Subcutaneous":                  {"category": "adipose",         "critical": False, "weight": 0.5},
    "Adipose - Visceral (Omentum)":            {"category": "adipose",         "critical": False, "weight": 0.5},
    "Adrenal Gland":                           {"category": "endocrine",       "critical": True,  "weight": 1.5},
    "Artery - Aorta":                          {"category": "cardiovascular",  "critical": True,  "weight": 1.8},
    "Artery - Coronary":                       {"category": "cardiovascular",  "critical": True,  "weight": 1.8},
    "Artery - Tibial":                         {"category": "cardiovascular",  "critical": False, "weight": 1.0},
    "Bladder":                                 {"category": "urinary",         "critical": False, "weight": 0.8},
    "Brain - Amygdala":                        {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Anterior cingulate cortex (BA24)":{"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Caudate (basal ganglia)":         {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Cerebellar Hemisphere":           {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Cerebellum":                      {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Cortex":                          {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Frontal Cortex (BA9)":            {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Hippocampus":                     {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Hypothalamus":                    {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Nucleus accumbens (basal ganglia)":{"category": "brain",          "critical": True,  "weight": 2.0},
    "Brain - Putamen (basal ganglia)":         {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Spinal cord (cervical c-1)":      {"category": "brain",           "critical": True,  "weight": 2.0},
    "Brain - Substantia nigra":                {"category": "brain",           "critical": True,  "weight": 2.0},
    "Breast - Mammary Tissue":                 {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Cells - Cultured fibroblasts":            {"category": "cell_line",       "critical": False, "weight": 0.3},
    "Cells - EBV-transformed lymphocytes":     {"category": "cell_line",       "critical": False, "weight": 0.3},
    "Cervix Uteri":                            {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Colon - Sigmoid":                         {"category": "digestive",       "critical": False, "weight": 1.0},
    "Colon - Transverse":                      {"category": "digestive",       "critical": False, "weight": 1.0},
    "Esophagus - Gastroesophageal Junction":   {"category": "digestive",       "critical": False, "weight": 0.8},
    "Esophagus - Mucosa":                      {"category": "digestive",       "critical": False, "weight": 0.8},
    "Esophagus - Muscularis":                  {"category": "digestive",       "critical": False, "weight": 0.8},
    "Fallopian Tube":                          {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Heart - Atrial Appendage":                {"category": "cardiovascular",  "critical": True,  "weight": 2.0},
    "Heart - Left Ventricle":                  {"category": "cardiovascular",  "critical": True,  "weight": 2.0},
    "Kidney - Cortex":                         {"category": "urinary",         "critical": True,  "weight": 1.8},
    "Kidney - Medulla":                        {"category": "urinary",         "critical": True,  "weight": 1.8},
    "Liver":                                   {"category": "digestive",       "critical": True,  "weight": 1.8},
    "Lung":                                    {"category": "respiratory",     "critical": True,  "weight": 1.5},
    "Minor Salivary Gland":                    {"category": "digestive",       "critical": False, "weight": 0.5},
    "Muscle - Skeletal":                       {"category": "musculoskeletal", "critical": False, "weight": 1.0},
    "Nerve - Tibial":                          {"category": "nervous",         "critical": False, "weight": 1.0},
    "Ovary":                                   {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Pancreas":                                {"category": "endocrine",       "critical": True,  "weight": 1.5},
    "Pituitary":                               {"category": "endocrine",       "critical": True,  "weight": 1.5},
    "Prostate":                                {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Skin - Not Sun Exposed (Suprapubic)":     {"category": "skin",            "critical": False, "weight": 0.5},
    "Skin - Sun Exposed (Lower leg)":          {"category": "skin",            "critical": False, "weight": 0.5},
    "Small Intestine - Terminal Ileum":        {"category": "digestive",       "critical": False, "weight": 1.0},
    "Spleen":                                  {"category": "immune",          "critical": False, "weight": 1.0},
    "Stomach":                                 {"category": "digestive",       "critical": False, "weight": 1.0},
    "Testis":                                  {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Thyroid":                                 {"category": "endocrine",       "critical": False, "weight": 1.0},
    "Uterus":                                  {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Vagina":                                  {"category": "reproductive",    "critical": False, "weight": 0.8},
    "Whole Blood":                             {"category": "hematopoietic",   "critical": True,  "weight": 1.5},
}

# ─── Protein Class Druggability ───────────────────────────────────────────────
DRUGGABLE_CLASSES = {
    "kinase":               0.90,
    "gpcr":                 0.95,
    "ion_channel":          0.85,
    "nuclear_receptor":     0.90,
    "protease":             0.80,
    "phosphatase":          0.70,
    "epigenetic_regulator": 0.75,
    "enzyme":               0.60,
    "transporter":          0.65,
    "receptor":             0.75,
    "transcription_factor": 0.30,
    "structural":           0.20,
    "ubiquitin_ligase":     0.60,
    "deubiquitinase":       0.65,
    "chaperone":            0.55,
    "unknown":              0.50,
}
