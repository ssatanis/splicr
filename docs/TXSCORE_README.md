# TxScore Database Schema & SDK

**Therapeutic Viability Score System for Cancer Target Prioritization**

A comprehensive PostgreSQL schema and TypeScript SDK for computing, storing, and querying multi-modal therapeutic target assessments.

---

## 📋 Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [TypeScript SDK](#typescript-sdk)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Example Queries](#example-queries)
- [Performance Optimization](#performance-optimization)
- [Data Sources](#data-sources)

---

## 🎯 Overview

TxScore integrates **8 major datasets** to compute a **Therapeutic Viability Score (TVS)** for cancer targets:

### Core Datasets
1. **DepMap Chronos** - CRISPR gene essentiality (2-3 GB)
2. **GTEx v8** - Normal tissue expression (50 MB)
3. **gnomAD v4.1** - Loss-of-function constraint (10 MB)
4. **AlphaFold** - Protein structures & pockets (200 MB metadata)
5. **ClinVar** - Clinical variants (100 MB)
6. **DGIdb** - Drug-gene interactions (50 MB)
7. **ClinicalTrials.gov** - Clinical trials (500 MB)
8. **UniProt** - Protein annotations (200 MB)

### TxScore Components
The TVS is a weighted geometric mean of 5 subscores:

```
TVS = (Efficacy^0.3 × Safety^0.25 × Druggability^0.2 × Precedent^0.15 × Stratification^0.1)
```

Where:
- **Efficacy**: DepMap dependency + selectivity + genetic evidence
- **Safety**: GTEx expression × gnomAD constraint (tissue-specific)
- **Druggability**: AlphaFold pockets + chemical matter + protein class
- **Precedent**: ClinVar variants + clinical trials + approved drugs
- **Stratification**: Biomarker correlation + patient prevalence

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Data Ingestion Layer                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │  DepMap  │  │   GTEx   │  │  gnomAD  │  │AlphaFold │   │
│  │ (Python) │  │ (Python) │  │ (Python) │  │ (Python) │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└───────┼─────────────┼─────────────┼─────────────┼──────────┘
        │             │             │             │
        ▼             ▼             ▼             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Supabase PostgreSQL                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ genes_master │  │ depmap_data  │  │gtex_expression│     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬────────┘     │
│         │                 │                 │              │
│  ┌──────▼──────────────────▼─────────────────▼────────┐    │
│  │         TxScore Computation Engine (Python)        │    │
│  │     ┌─────────────────────────────────────┐        │    │
│  │     │       txscore_cache table            │        │    │
│  │     │   (Pre-computed scores + metadata)   │        │    │
│  │     └─────────────────────────────────────┘        │    │
│  └───────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                  TypeScript SDK (Frontend)                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ Gene Search  │  │Target Ranking│  │  Analytics   │     │
│  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema

### Core Tables

#### 1. `genes_master` (Master Gene Registry)
```sql
PRIMARY KEY: gene_id (Ensembl ID)
UNIQUE INDEX: gene_symbol
```
- **20,000+ protein-coding genes**
- Identifiers: Ensembl, HGNC, UniProt, Entrez
- Genomic coordinates (GRCh38)
- Protein class annotations

#### 2. `depmap_data` (CRISPR Essentiality)
```sql
COMPOSITE KEY: (gene_id, cell_line_id, depmap_release)
INDEXES: gene_id, cancer_type, chronos_effect
```
- **~20M rows** (20K genes × 1K cell lines)
- Chronos effect scores (-3 to +1)
- Dependency probabilities (0-1)
- Cancer type annotations

#### 3. `gtex_expression` (Tissue Expression)
```sql
COMPOSITE KEY: (gene_id, tissue_name, gtex_version)
INDEXES: gene_id, tissue_name, median_tpm
```
- **~1.1M rows** (20K genes × 54 tissues)
- Median/mean TPM
- Tissue categories

#### 4. `gnomad_constraint` (Gene Constraint)
```sql
PRIMARY KEY: gene_id
INDEXES: loeuf, pli
```
- **~19K genes** with constraint metrics
- LOEUF (LoF observed/expected upper bound)
- pLI (probability of LoF intolerance)

#### 5. `alphafold_structures` (Protein Structures)
```sql
COMPOSITE KEY: (gene_id, uniprot_id, alphafold_version)
INDEXES: mean_plddt, num_druggable_pockets
```
- **~20K structures**
- pLDDT confidence scores
- Binding pocket predictions (JSONB)
- Domain annotations

#### 6. `clinvar_variants` (Clinical Variants)
```sql
PRIMARY KEY: variant_id
INDEXES: gene_id, clinical_significance
```
- **~2M variants**
- Pathogenic/benign classifications
- HGVS notation

#### 7. `drug_interactions` (Drug-Gene Interactions)
```sql
COMPOSITE KEY: (gene_id, drug_name, source)
INDEXES: approval_status, clinical_trial_phase
```
- **~100K interactions**
- DGIdb, DrugBank, ChEMBL sources
- Approval status

#### 8. `clinical_trials` (ClinicalTrials.gov)
```sql
PRIMARY KEY: nct_id
INDEXES: gene_id, phase, status
```
- **~500K trials**
- Phase, status, enrollment
- Conditions, interventions (JSONB)

#### 9. `txscore_cache` (Pre-computed Scores)
```sql
PRIMARY KEY: (gene_id, cancer_type)
INDEXES: tvs DESC, cancer_type, efficacy_score
```
- **~600K entries** (20K genes × 30 cancer types)
- TVS + 5 subscores
- Tissue risks (JSONB)
- Modality recommendations

---

## 💻 TypeScript SDK

### Installation

```bash
npm install @supabase/supabase-js
```

### Basic Usage

```typescript
import TxScoreClient from './sdk/typescript/txscore-client';

const client = new TxScoreClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Get gene by symbol
const gene = await client.getGeneBySymbol('BRCA2');

// Get TxScore for BRCA2 in breast cancer
const txscore = await client.getTxScore('ENSG00000139618', 'BRCA');

console.log(txscore);
// {
//   gene_id: 'ENSG00000139618',
//   cancer_type: 'BRCA',
//   tvs: 0.82,
//   efficacy_score: 0.91,
//   safety_score: 0.76,
//   druggability_score: 0.88,
//   precedent_score: 0.95,
//   stratification_score: 0.67,
//   modality_recommendation: {
//     small_molecule: 0.65,
//     antibody: 0.20,
//     gene_therapy: 0.95,
//     recommended_modality: 'gene_therapy'
//   }
// }
```

---

## 🚀 Quick Start

### 1. Apply Database Migrations

```bash
# Using Supabase CLI
npx supabase db push

# Or apply manually
psql -h <host> -U postgres -d postgres -f supabase/migrations/20260213000000_txscore_schema.sql
psql -h <host> -U postgres -d postgres -f supabase/migrations/20260213000001_txscore_functions.sql
```

### 2. Load Data (Python)

See the data loading pipeline in `/scripts/load_txscore_data.py` (to be created).

### 3. Query from TypeScript

```typescript
// Top 10 targets for lung adenocarcinoma
const topTargets = await client.getTopTargets('LUAD', {
  min_tvs: 0.7,
  min_safety: 0.6
}, {
  limit: 10
});

// Get comprehensive gene profile
const profile = await client.getGeneProfile('ENSG00000141510', 'LUAD');
// Returns: gene, depmap, gtex, constraint, structure, clinvar, drugs, trials, txscores

// Find genes with druggable pockets
const druggable = await client.getGenesWithDruggablePockets(2);

// Search genes
const results = await client.searchGenes('TP53');
```

---

## 📊 Example Queries

### 1. Top 10 Therapeutic Targets for Lung Cancer

```typescript
const targets = await client.getTopTargets('LUAD', {
  min_tvs: 0.7,
  min_efficacy: 0.6,
  min_safety: 0.5,
  has_approved_drugs: false // Exclude already-drugged targets
}, {
  limit: 10,
  order_by: 'tvs',
  order_direction: 'desc'
});

targets.forEach((t, i) => {
  console.log(`${i+1}. ${t.gene_id} - TVS: ${t.tvs.toFixed(2)}`);
});
```

### 2. Pan-Cancer Targets (High TVS across ≥5 Cancer Types)

```typescript
const panCancerTargets = await client.getPanCancerTargets(5, 0.75);

console.log(`Found ${panCancerTargets.length} pan-cancer targets`);
panCancerTargets.forEach(t => {
  console.log(`${t.gene_id}: ${t.cancer_types.join(', ')} (avg TVS: ${t.avg_tvs.toFixed(2)})`);
});
```

### 3. Kinases with High Druggability (No Approved Drugs)

```typescript
const kinases = await client.getGenesByProteinClass('kinase');

const undrugged = await Promise.all(
  kinases.map(async (gene) => {
    const drugs = await client.getApprovedDrugs(gene.gene_id);
    const structure = await client.getAlphaFoldStructure(gene.gene_id);
    const txscores = await client.getTxScoresForGene(gene.gene_id);
    
    return {
      gene,
      hasDrugs: drugs.length > 0,
      druggability: structure?.num_druggable_pockets || 0,
      maxTVS: Math.max(...txscores.map(t => t.tvs), 0)
    };
  })
);

const undrugged Kinases = undrugged
  .filter(k => !k.hasDrugs && k.druggability >= 2 && k.maxTVS > 0.6)
  .sort((a, b) => b.maxTVS - a.maxTVS);

console.log('Undrugged kinases with high druggability:');
undrugged Kinases.forEach(k => {
  console.log(`  ${k.gene.gene_symbol}: ${k.druggability} pockets, TVS ${k.maxTVS.toFixed(2)}`);
});
```

### 4. Safety Assessment (Critical Tissue Risk)

```typescript
const gene = await client.getGeneBySymbol('MYC');
const gtex = await client.getGTExExpression(gene!.gene_id);
const constraint = await client.getGnomADConstraint(gene!.gene_id);

const criticalTissues = ['Heart - Left Ventricle', 'Brain - Cortex', 'Liver'];

console.log(`Safety profile for ${gene!.gene_symbol}:`);
console.log(`  LOEUF: ${constraint?.loeuf?.toFixed(2)}`);
console.log(`  pLI: ${constraint?.pli?.toFixed(2)}`);

criticalTissues.forEach(tissue => {
  const expr = gtex.find(e => e.tissue_name === tissue);
  const tpm = expr?.median_tpm || 0;
  const risk = tpm > 10 && constraint?.loeuf && constraint.loeuf < 0.6 ? 'HIGH' : 'LOW';
  
  console.log(`  ${tissue}: ${tpm.toFixed(1)} TPM - Risk: ${risk}`);
});
```

### 5. Compare Two Genes Side-by-Side

```typescript
const comparison = await client.compareGenes(['ENSG00000141510', 'ENSG00000139618'], 'BRCA');

comparison.forEach(profile => {
  console.log(`\n=== ${profile.gene?.gene_symbol} ===`);
  console.log(`TVS: ${profile.txscores[0]?.tvs.toFixed(2)}`);
  console.log(`Efficacy: ${profile.txscores[0]?.efficacy_score.toFixed(2)}`);
  console.log(`Safety: ${profile.txscores[0]?.safety_score.toFixed(2)}`);
  console.log(`Approved drugs: ${profile.drugs.approved.length}`);
  console.log(`Clinical trials: ${profile.trials.all.length}`);
});
```

### 6. Custom Scoring (Emphasize Safety)

```typescript
// Custom weights: prioritize safety and druggability
const safeTargets = await client.rankTargets('LUAD', {
  efficacy: 0.20,
  safety: 0.40,      // 2× standard weight
  druggability: 0.30, // 1.5× standard weight
  precedent: 0.05,
  stratification: 0.05
}, 50);

console.log('Top 10 safe & druggable targets:');
safeTargets.slice(0, 10).forEach((t, i) => {
  console.log(`${i+1}. Gene: ${t.gene_id}, Safety: ${t.safety_score.toFixed(2)}, Druggability: ${t.druggability_score.toFixed(2)}`);
});
```

---

## ⚡ Performance Optimization

### Indexes
The schema includes **100+ indexes** for fast queries:

```sql
-- Gene lookups
CREATE INDEX idx_genes_master_symbol ON genes_master(gene_symbol);
CREATE INDEX idx_genes_master_uniprot ON genes_master(uniprot_id);

-- TxScore ranking
CREATE INDEX idx_txscore_tvs_desc ON txscore_cache(tvs DESC);
CREATE INDEX idx_txscore_cancer_tvs ON txscore_cache(cancer_type, tvs DESC);

-- DepMap filtering
CREATE INDEX idx_depmap_composite ON depmap_data(gene_id, cancer_type, chronos_effect);

-- JSONB searches
CREATE INDEX idx_alphafold_pockets_gin ON alphafold_structures USING GIN(pockets);
```

### Materialized Views

```sql
-- Pre-aggregate high-expression tissues
CREATE MATERIALIZED VIEW gtex_high_expression AS
SELECT 
  gene_id,
  ARRAY_AGG(tissue_name) FILTER (WHERE median_tpm > 10) AS expressed_tissues
FROM gtex_expression
GROUP BY gene_id;
```

### Query Tips

1. **Use specific filters first**:
   ```typescript
   // Good: Filter by cancer type first
   const targets = await client.getTopTargets('LUAD', { min_tvs: 0.7 });
   
   // Bad: Scan all cancer types
   const allTargets = await client.supabase.from('txscore_cache').select('*');
   ```

2. **Leverage JSONB indexes**:
   ```sql
   -- Indexed query
   SELECT * FROM txscore_cache
   WHERE modality_recommendation->>'recommended_modality' = 'small_molecule';
   ```

3. **Use `LIMIT` for large result sets**:
   ```typescript
   const top100 = await client.getTopTargets('BRCA', {}, { limit: 100 });
   ```

---

## 📦 Data Sources

### Required Downloads

Download all datasets to `/tea_data/` (already done):

```bash
# DepMap (latest release)
wget https://depmap.org/portal/download/all/?release=DepMap+Public+25Q3&file=CRISPR_gene_effect.csv
wget https://depmap.org/portal/download/all/?release=DepMap+Public+25Q3&file=Model.csv

# GTEx v8
wget https://storage.googleapis.com/adult-gtex/bulk-gex/v8/rna-seq/GTEx_Analysis_2017-06-05_v8_RNASeQCv1.1.9_gene_median_tpm.gct.gz
wget https://storage.googleapis.com/adult-gtex/annotations/v8/metadata-files/GTEx_Analysis_v8_Annotations_SampleAttributesDS.txt

# gnomAD v4.1
wget https://storage.googleapis.com/gcp-public-data--gnomad/release/4.1/constraint/gnomad.v4.1.constraint_metrics.tsv

# AlphaFold (human proteome)
wget https://ftp.ebi.ac.uk/pub/databases/alphafold/latest/UP000005640_9606_HUMAN_v4.tar

# ClinVar
wget https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/variant_summary.txt.gz

# DGIdb
wget https://www.dgidb.org/data/monthly_tsvs/2024-Dec/interactions.tsv
```

### Data Preprocessing

See Python preprocessing scripts (to be created):
- `/scripts/preprocess_depmap.py`
- `/scripts/preprocess_gtex.py`
- `/scripts/preprocess_gnomad.py`
- `/scripts/preprocess_alphafold.py`
- `/scripts/preprocess_clinvar.py`
- `/scripts/preprocess_dgidb.py`

---

## 🧪 Testing

```bash
# Run TypeScript tests
npm test

# Check database integrity
psql -c "SELECT COUNT(*) FROM genes_master;"
psql -c "SELECT COUNT(*) FROM txscore_cache;"
```

---

## 📝 License

MIT License - See LICENSE file

---

## 🤝 Contributing

Please submit issues and pull requests to the GitHub repository.

---

## 📚 References

1. **DepMap**: Pacini et al. (2021) _Nature_
2. **GTEx**: GTEx Consortium (2020) _Science_
3. **gnomAD**: Karczewski et al. (2020) _Nature_
4. **AlphaFold**: Jumper et al. (2021) _Nature_
5. **Shi et al.**: Shi et al. (2024) _Cell_ - Normal tissue essentiality prediction

---

## 🔗 Quick Links

- [Supabase Documentation](https://supabase.com/docs)
- [DepMap Portal](https://depmap.org/portal/)
- [GTEx Portal](https://gtexportal.org/)
- [gnomAD Browser](https://gnomad.broadinstitute.org/)
- [AlphaFold Database](https://alphafold.ebi.ac.uk/)

---

**Built with ❤️ for cancer drug discovery**
