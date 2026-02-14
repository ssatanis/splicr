"""
Step 02: Build tx_genes_master from multiple sources
 1. gnomAD v4.1 constraint TSV  → canonical ENSG IDs + gene symbols
 2. GTEx GCT header             → additional ENSG IDs
 3. UniProt .dat.gz              → UniProt accession + protein class + subcellular location
 4. DGIdb genes.tsv             → druggability categories

Primary key = Ensembl gene ID (ENSG...).
"""
import re
import gzip
import json
import sys, os
import tarfile
sys.path.insert(0, os.path.dirname(__file__))

import pandas as pd
from tqdm import tqdm
from config import (GNOMAD_CONSTRAINT, GTEX_MEDIAN_TPM, UNIPROT_DAT,
                    DGIDB_GENES, DEPMAP_GENE_EFFECT, DRUGGABLE_CLASSES)
from utils.db import upsert_rows, count_rows

# ─── Regex for gene symbol validation (must match DB constraint) ──────────────
SYMBOL_RE = re.compile(r'^[A-Z0-9][A-Z0-9\-]*$')

SYMBOL_BLACKLIST = {"NAN", "NA", "NULL", "NONE", "", "NAN"}

def clean_symbol(sym: str) -> str:
    """Uppercase and strip invalid chars to match DB constraint."""
    if not sym or str(sym).lower() in ("nan", "na", "null", "none", ""):
        return ""
    sym = str(sym).upper().strip()
    # Remove anything not A-Z, 0-9, or hyphen
    sym = re.sub(r'[^A-Z0-9\-]', '', sym)
    if sym in SYMBOL_BLACKLIST:
        return ""
    return sym


def parse_gnomad_genes() -> dict:
    """
    Returns {ensg_id: {gene_symbol, loeuf, pli, ...}} from gnomAD canonical rows.
    gnomAD has two rows per gene: one with Entrez gene_id, one with ENSG.
    We keep only the ENSG rows where canonical == 'true'.
    """
    print("Parsing gnomAD for gene IDs...")
    genes = {}

    df = pd.read_csv(
        GNOMAD_CONSTRAINT,
        sep="\t",
        low_memory=False,
        usecols=lambda c: c in {
            "gene", "gene_id", "transcript", "canonical",
            "lof.oe_ci.upper", "lof.oe_ci.lower",
            "lof.pLI", "lof.oe",
        }
    )

    # Keep only ENSG canonical rows
    mask = (
        df["gene_id"].astype(str).str.startswith("ENSG") &
        (df["canonical"].astype(str).str.lower() == "true")
    )
    df = df[mask].copy()

    for _, row in df.iterrows():
        ensg = str(row["gene_id"]).strip()
        sym  = clean_symbol(str(row["gene"]))
        if not sym or not SYMBOL_RE.match(sym):
            continue
        genes[ensg] = {
            "gene_symbol": sym,
            "gene_id":     ensg,
        }

    print(f"  gnomAD: {len(genes)} canonical genes")
    return genes


def parse_gtex_genes() -> set:
    """Parse GTEx GCT to collect all ENSG IDs (strip version suffix)."""
    print("Parsing GTEx for ENSG IDs...")
    ensg_ids = set()
    with gzip.open(GTEX_MEDIAN_TPM, "rt") as f:
        for i, line in enumerate(f):
            if i < 3:       # skip header lines (#1.2, dimensions, tissues)
                continue
            ensg_ver = line.split("\t")[0]
            ensg = ensg_ver.split(".")[0]   # strip version: ENSG00000...5 → ENSG00000...
            ensg_ids.add(ensg)
    print(f"  GTEx: {len(ensg_ids)} ENSG IDs")
    return ensg_ids


def parse_depmap_genes() -> dict:
    """
    Parse CRISPRGeneEffect header for gene symbol → entrez_id mapping.
    Column format: 'GENE_SYMBOL (ENTREZ_ID)'
    """
    print("Parsing DepMap gene list...")
    genes = {}
    with open(DEPMAP_GENE_EFFECT, "r") as f:
        header = f.readline()
    cols = header.strip().split(",")
    for col in cols[1:]:   # skip first empty cell (cell line column)
        m = re.match(r'^"?([A-Za-z0-9\.\-]+)\s+\((\d+)\)"?$', col.strip())
        if m:
            sym, entrez = m.group(1), m.group(2)
            sym_clean = clean_symbol(sym)
            if sym_clean:
                genes[sym_clean] = int(entrez)
    print(f"  DepMap: {len(genes)} genes with Entrez IDs")
    return genes


def parse_uniprot(gene_symbols: set) -> dict:
    """
    Parse UniProt .dat.gz flat file to build:
    {gene_symbol → {uniprot_id, protein_name, protein_length,
                    subcellular_location, protein_class}}
    """
    print("Parsing UniProt annotations...")
    result = {}
    current = {}

    def flush(entry):
        """Process a complete UniProt entry."""
        sym = entry.get("gene_symbol", "").upper().strip()
        # Also check synonyms
        candidates = [sym] + [s.upper() for s in entry.get("synonyms", [])]
        for cand in candidates:
            cand_clean = clean_symbol(cand)
            if cand_clean in gene_symbols:
                result[cand_clean] = {
                    "uniprot_id":           entry.get("accession"),
                    "protein_name":         entry.get("protein_name", ""),
                    "protein_length":       entry.get("sequence_length"),
                    "subcellular_location": entry.get("subcellular_loc", ""),
                    "protein_class":        classify_protein(
                                                entry.get("keywords", []),
                                                entry.get("protein_name", "")
                                            ),
                }
                break

    def classify_protein(keywords: list, name: str) -> str:
        kw_lower = {k.lower() for k in keywords}
        name_lower = name.lower()
        if "kinase" in kw_lower or "kinase" in name_lower:           return "kinase"
        if "g-protein coupled" in name_lower or "gpcr" in kw_lower:  return "gpcr"
        if "ion channel" in kw_lower or "channel" in name_lower:     return "ion_channel"
        if "nuclear receptor" in kw_lower:                            return "nuclear_receptor"
        if "protease" in kw_lower or "peptidase" in kw_lower:        return "protease"
        if "phosphatase" in kw_lower or "phosphatase" in name_lower: return "phosphatase"
        if "histone" in kw_lower or "methyltransferase" in name_lower or "deacetylase" in name_lower:
            return "epigenetic_regulator"
        if "transcription factor" in kw_lower or "transcription regulator" in kw_lower:
            return "transcription_factor"
        if "transporter" in kw_lower or "transport" in name_lower:   return "transporter"
        if "ubiquitin" in kw_lower:
            if "deubiquitinase" in name_lower or "dub" in name_lower: return "deubiquitinase"
            return "ubiquitin_ligase"
        if "chaperone" in kw_lower:                                   return "chaperone"
        if "structural protein" in kw_lower:                          return "structural"
        if "enzyme" in kw_lower or "transferase" in kw_lower or "reductase" in name_lower:
            return "enzyme"
        if "receptor" in kw_lower or "receptor" in name_lower:       return "receptor"
        return "unknown"

    # ── parse flat-file ──────────────────────────────────────────────────────
    total = 0
    with gzip.open(UNIPROT_DAT, "rt", errors="replace") as f:
        for line in tqdm(f, desc="  UniProt", unit="lines", mininterval=2):
            line = line.rstrip("\n")
            tag = line[:2]

            if tag == "ID":
                current = {}
                parts = line[5:].split()
                if len(parts) >= 3:
                    try:
                        current["sequence_length"] = int(parts[2])
                    except ValueError:
                        pass

            elif tag == "AC" and "accession" not in current:
                accs = line[5:].replace(";", " ").split()
                if accs:
                    current["accession"] = accs[0]

            elif tag == "DE":
                if "RecName: Full=" in line and "protein_name" not in current:
                    m = re.search(r"RecName: Full=([^;{]+)", line)
                    if m:
                        current["protein_name"] = m.group(1).strip()

            elif tag == "GN":
                # GN   Name=BRCA2; Synonyms=FANCD1;
                m = re.search(r"Name=([^;{,\s]+)", line)
                if m:
                    current["gene_symbol"] = m.group(1).strip().rstrip(";")
                syns = re.findall(r"Synonyms=([^;{]+)", line)
                if syns:
                    current.setdefault("synonyms", []).extend(
                        [s.strip() for s in syns[0].split(",")]
                    )

            elif tag == "KW":
                kws = [k.strip().rstrip(";.") for k in line[5:].split(";")]
                current.setdefault("keywords", []).extend(kws)

            elif tag == "CC" and "SUBCELLULAR LOCATION:" in line:
                m = re.search(r"SUBCELLULAR LOCATION:\s*(.+?)(?:\{|$)", line)
                if m:
                    current["subcellular_loc"] = m.group(1).strip()

            elif tag == "//":
                flush(current)
                total += 1
                current = {}

    print(f"  UniProt: {total} entries parsed, {len(result)} matched to our gene list")
    return result


def load_genes_master():
    print("\n=== Building tx_genes_master ===\n")

    gnomad_genes = parse_gnomad_genes()
    gtex_ensg    = parse_gtex_genes()
    depmap_genes = parse_depmap_genes()

    # Merge: start with gnomAD canonical genes (most reliable ENSG source)
    # Add any GTEx-only genes we might be missing
    all_ensg = set(gnomad_genes.keys()) | gtex_ensg

    # Build symbol → ensg mapping from gnomAD
    symbol_to_ensg = {v["gene_symbol"]: k for k, v in gnomad_genes.items()}

    # Build complete gene list
    master_genes = {}
    for ensg in all_ensg:
        if ensg in gnomad_genes:
            master_genes[ensg] = gnomad_genes[ensg].copy()
        else:
            # GTEx-only: try to find symbol via DepMap
            master_genes[ensg] = {"gene_id": ensg, "gene_symbol": None}

    # Fill in Entrez IDs from DepMap where possible
    symbol_to_entrez = depmap_genes
    for ensg, info in master_genes.items():
        sym = info.get("gene_symbol")
        if sym and sym in symbol_to_entrez:
            info["entrez_id"] = symbol_to_entrez[sym]

    # Parse UniProt for the gene symbols we have
    known_symbols = {v["gene_symbol"] for v in master_genes.values() if v.get("gene_symbol")}
    uniprot_map = parse_uniprot(known_symbols)

    # Build rows for insertion
    print(f"\nBuilding {len(master_genes)} gene rows...")
    rows = []
    for ensg, info in tqdm(master_genes.items(), desc="  Preparing rows"):
        sym = info.get("gene_symbol")
        if not sym or not SYMBOL_RE.match(sym):
            continue

        uniprot_info = uniprot_map.get(sym, {})
        entrez_id    = info.get("entrez_id")

        aliases = {}
        if entrez_id:
            aliases["entrez_id"] = entrez_id

        rows.append((
            ensg,                                          # gene_id
            sym,                                           # gene_symbol
            uniprot_info.get("uniprot_id"),                # uniprot_id
            uniprot_info.get("protein_name", ""),          # gene_name (best proxy)
            None, None, None, None,                        # chr, start, end, strand
            json.dumps(aliases) if aliases else None,      # aliases JSONB
            "protein_coding",                              # gene_type (default)
            None,                                          # gene_biotype
            None,                                          # description
            uniprot_info.get("protein_length"),            # protein_length
            uniprot_info.get("protein_class", "unknown"),  # protein_class
            None,                                          # protein_family
            "gnomad_gtex",                                 # source
            "gnomad_v4.1",                                 # version
        ))

    COLS = [
        "gene_id", "gene_symbol", "uniprot_id", "gene_name",
        "chromosome", "start_position", "end_position", "strand",
        "aliases", "gene_type", "gene_biotype", "description",
        "protein_length", "protein_class", "protein_family",
        "source", "version",
    ]

    # Deduplicate by gene_symbol — keep row with most non-None fields
    seen_symbols = {}
    deduped = []
    for row in rows:
        sym = row[1]   # gene_symbol is at index 1
        if not sym:
            continue
        score = sum(1 for v in row if v is not None)
        if sym not in seen_symbols or score > seen_symbols[sym][1]:
            seen_symbols[sym] = (row, score)
    deduped = [v[0] for v in seen_symbols.values()]
    rows = deduped
    print(f"  After deduplication: {len(rows)} unique gene symbols")

    print(f"Inserting {len(rows)} genes into tx_genes_master...")
    BATCH = 5000
    total_inserted = 0
    for i in tqdm(range(0, len(rows), BATCH), desc="  Uploading"):
        chunk = rows[i:i+BATCH]
        upsert_rows(
            "tx_genes_master", COLS, chunk,
            conflict_cols=["gene_id"],
            update_cols=["gene_symbol", "uniprot_id", "gene_name", "protein_class",
                         "protein_length", "aliases"],
        )
        total_inserted += len(chunk)

    print(f"\nDone. tx_genes_master: {count_rows('tx_genes_master')} rows")


if __name__ == "__main__":
    load_genes_master()
