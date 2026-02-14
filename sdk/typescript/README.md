# @splicr/txscore-sdk

**TypeScript SDK for TxScore** - Therapeutic Viability Score System for Cancer Target Prioritization

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-green.svg)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 🎯 Overview

TxScore integrates **8 major genomic datasets** to compute a multi-dimensional **Therapeutic Viability Score (TVS)** for cancer drug targets:

- **DepMap Chronos** - CRISPR gene essentiality
- **GTEx v8** - Normal tissue expression
- **gnomAD v4.1** - Loss-of-function constraint
- **AlphaFold** - Protein structures & druggable pockets
- **ClinVar** - Clinical variants
- **DGIdb** - Drug-gene interactions
- **ClinicalTrials.gov** - Clinical trials
- **UniProt** - Protein annotations

The SDK provides a **type-safe, batteries-included** interface for querying TxScore data and performing advanced analytics.

---

## 🚀 Installation

```bash
npm install @splicr/txscore-sdk @supabase/supabase-js
```

---

## 📖 Quick Start

### Basic Usage

```typescript
import TxScoreClient from '@splicr/txscore-sdk';

const client = new TxScoreClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Get gene by symbol
const gene = await client.getGeneBySymbol('BRCA2');
console.log(gene);
// {
//   gene_id: 'ENSG00000139618',
//   gene_symbol: 'BRCA2',
//   gene_name: 'BRCA2 DNA repair associated',
//   protein_class: 'enzyme',
//   ...
// }

// Get TxScore for BRCA2 in breast cancer
const txscore = await client.getTxScore('ENSG00000139618', 'BRCA');
console.log(txscore);
// {
//   tvs: 0.82,
//   efficacy_score: 0.91,
//   safety_score: 0.76,
//   druggability_score: 0.88,
//   precedent_score: 0.95,
//   stratification_score: 0.67,
//   ...
// }
```

---

## 📚 API Reference

### Gene Queries

#### `getGene(geneId: string): Promise<Gene | null>`
Get gene by Ensembl ID.

#### `getGeneBySymbol(symbol: string): Promise<Gene | null>`
Get gene by HGNC symbol (case-insensitive).

#### `searchGenes(query: string, limit?: number): Promise<Gene[]>`
Fuzzy search genes by symbol or name.

#### `getGenesByProteinClass(proteinClass: string): Promise<Gene[]>`
Get all genes in a protein class (e.g., 'kinase', 'gpcr').

#### `getGenesInRegion(chromosome: string, start: number, end: number): Promise<Gene[]>`
Get genes in genomic region.

**Example:**
```typescript
const tp53 = await client.getGeneBySymbol('TP53');
const kinases = await client.getGenesByProteinClass('kinase');
const chr17Genes = await client.getGenesInRegion('chr17', 7000000, 8000000);
```

---

### DepMap Queries

#### `getDepMapData(geneId: string, cancerType?: string, release?: string): Promise<DepMapData[]>`
Get DepMap CRISPR essentiality data.

#### `getEssentialGenes(cancerType: string, chronosThreshold?: number, prevalenceThreshold?: number): Promise<string[]>`
Get genes essential in a cancer type.

#### `getSelectivityIndex(geneId: string, targetCancerType: string): Promise<number>`
Compute cancer-specific selectivity (0-1 scale).

**Example:**
```typescript
// Get DepMap data for KRAS in lung cancer
const depmap = await client.getDepMapData('ENSG00000133703', 'LUAD');

// Find essential genes in breast cancer
const essential = await client.getEssentialGenes('BRCA', -0.75, 0.5);
console.log(`${essential.length} essential genes in BRCA`);

// Compute selectivity
const selectivity = await client.getSelectivityIndex('ENSG00000133703', 'LUAD');
console.log(`KRAS selectivity in LUAD: ${selectivity.toFixed(2)}`);
```

---

### GTEx Expression Queries

#### `getGTExExpression(geneId: string): Promise<GTExExpression[]>`
Get expression across all 54 GTEx tissues.

#### `getHighExpressionTissues(geneId: string, tpmThreshold?: number): Promise<string[]>`
Get tissues with high expression (TPM > threshold).

#### `getTissueExpression(geneId: string, tissueName: string): Promise<GTExExpression | null>`
Get expression in a specific tissue.

**Example:**
```typescript
// Get all tissues for MYC
const gtex = await client.getGTExExpression('ENSG00000136997');

// Find highly expressed tissues
const highExpr = await client.getHighExpressionTissues('ENSG00000136997', 50);
console.log(`MYC highly expressed in: ${highExpr.join(', ')}`);

// Get heart-specific expression
const heartExpr = await client.getTissueExpression(
  'ENSG00000136997',
  'Heart - Left Ventricle'
);
console.log(`MYC in heart: ${heartExpr?.median_tpm.toFixed(1)} TPM`);
```

---

### gnomAD Constraint Queries

#### `getGnomADConstraint(geneId: string): Promise<GnomADConstraint | null>`
Get loss-of-function constraint metrics.

#### `getConstrainedGenes(loeufThreshold?: number, pliThreshold?: number): Promise<string[]>`
Get highly constrained genes (essential genes).

**Example:**
```typescript
const constraint = await client.getGnomADConstraint('ENSG00000139618');
console.log(`BRCA2 LOEUF: ${constraint?.loeuf?.toFixed(2)}`);
console.log(`BRCA2 pLI: ${constraint?.pli?.toFixed(2)}`);

// Find constrained genes
const constrained = await client.getConstrainedGenes(0.6, 0.9);
console.log(`${constrained.length} highly constrained genes`);
```

---

### AlphaFold Structure Queries

#### `getAlphaFoldStructure(geneId: string): Promise<AlphaFoldStructure | null>`
Get AlphaFold structure metadata and pockets.

#### `getHighQualityStructures(pLDDTThreshold?: number): Promise<string[]>`
Get genes with high-confidence structures.

#### `getGenesWithDruggablePockets(minPockets?: number): Promise<string[]>`
Get genes with druggable binding pockets.

**Example:**
```typescript
const structure = await client.getAlphaFoldStructure('ENSG00000133703');
console.log(`KRAS pLDDT: ${structure?.mean_plddt.toFixed(1)}`);
console.log(`Druggable pockets: ${structure?.num_druggable_pockets}`);

// Find druggable targets
const druggable = await client.getGenesWithDruggablePockets(2);
console.log(`${druggable.length} genes with ≥2 druggable pockets`);
```

---

### Clinical Evidence Queries

#### `getClinVarVariants(geneId: string): Promise<ClinVarVariant[]>`
Get all ClinVar variants.

#### `getPathogenicVariants(geneId: string): Promise<ClinVarVariant[]>`
Get pathogenic/likely pathogenic variants only.

#### `getDrugInteractions(geneId: string): Promise<DrugInteraction[]>`
Get all drug-gene interactions.

#### `getApprovedDrugs(geneId: string): Promise<DrugInteraction[]>`
Get approved drugs only.

#### `getClinicalTrials(geneId: string): Promise<ClinicalTrial[]>`
Get all clinical trials.

#### `getAdvancedTrials(geneId: string): Promise<ClinicalTrial[]>`
Get Phase 2/3/4 trials only.

**Example:**
```typescript
// Get pathogenic variants
const pathogenic = await client.getPathogenicVariants('ENSG00000139618');
console.log(`BRCA2: ${pathogenic.length} pathogenic variants`);

// Get approved drugs
const drugs = await client.getApprovedDrugs('ENSG00000133703');
drugs.forEach(d => console.log(`- ${d.drug_name} (${d.interaction_type})`));

// Get advanced trials
const trials = await client.getAdvancedTrials('ENSG00000139618');
console.log(`BRCA2: ${trials.length} Phase 2+ trials`);
```

---

### TxScore Queries

#### `getTxScore(geneId: string, cancerType: string): Promise<TxScore | null>`
Get TxScore for a specific gene and cancer type.

#### `getTxScoresForGene(geneId: string): Promise<TxScore[]>`
Get TxScores across all cancer types.

#### `getTopTargets(cancerType: string, filters?: TxScoreFilters, options?: RankingOptions): Promise<TxScore[]>`
Get top-ranked targets for a cancer type.

#### `getPanCancerTargets(minCancerTypes?: number, minTvs?: number): Promise<PanCancerTarget[]>`
Find targets with high TVS across multiple cancer types.

#### `rankTargets(cancerType: string, weights: WeightConfig, limit?: number): Promise<TxScore[]>`
Custom ranking with user-defined weights.

**Example:**
```typescript
// Top 10 lung cancer targets
const top = await client.getTopTargets('LUAD', {
  min_tvs: 0.7,
  min_safety: 0.6
}, {
  limit: 10
});

// Pan-cancer targets
const panCancer = await client.getPanCancerTargets(5, 0.75);
console.log(`${panCancer.length} pan-cancer targets`);

// Custom ranking (emphasize safety)
const safe = await client.rankTargets('LUAD', {
  efficacy: 0.2,
  safety: 0.4,
  druggability: 0.3,
  precedent: 0.05,
  stratification: 0.05
}, 50);
```

---

### Advanced Queries

#### `getGeneProfile(geneId: string, cancerType?: string): Promise<GeneProfile>`
Get comprehensive profile (all data sources).

#### `compareGenes(geneIds: string[], cancerType: string): Promise<GeneProfile[]>`
Compare multiple genes side-by-side.

#### `findSimilarTargets(geneId: string, cancerType: string, limit?: number): Promise<TxScore[]>`
Find targets with similar TxScore profiles.

**Example:**
```typescript
// Full gene profile
const profile = await client.getGeneProfile('ENSG00000139618', 'BRCA');
console.log(profile.gene);
console.log(profile.depmap);
console.log(profile.gtex);
console.log(profile.txscores);

// Compare BRCA1 vs BRCA2
const comparison = await client.compareGenes(
  ['ENSG00000012048', 'ENSG00000139618'],
  'BRCA'
);

// Find similar targets
const similar = await client.findSimilarTargets('ENSG00000133703', 'LUAD', 10);
```

---

### Analytics

#### `getTxScoreDistribution(cancerType: string): Promise<Distribution>`
Get TVS distribution histogram.

#### `getSubscoreCorrelations(cancerType?: string): Promise<Correlation[]>`
Get pairwise subscore correlations.

#### `getProteinClassEnrichment(cancerType: string, topN?: number): Promise<Enrichment[]>`
Analyze protein class enrichment in top targets.

**Example:**
```typescript
// TVS distribution for LUAD
const dist = await client.getTxScoreDistribution('LUAD');
console.log(dist);

// Subscore correlations
const corr = await client.getSubscoreCorrelations('LUAD');
corr.forEach(c => {
  console.log(`${c.subscore1} vs ${c.subscore2}: r=${c.correlation?.toFixed(2)}`);
});

// Protein class enrichment
const enrichment = await client.getProteinClassEnrichment('LUAD', 100);
enrichment.forEach(e => {
  console.log(`${e.protein_class}: ${e.enrichment_ratio?.toFixed(2)}×`);
});
```

---

## 🔧 Utility Functions

### Classification

```typescript
import {
  classifyTVS,
  classifyLOEUF,
  classifyPLI,
  classifyStructureQuality,
} from '@splicr/txscore-sdk';

classifyTVS(0.85); // 'exceptional'
classifyLOEUF(0.5); // 'constrained'
classifyPLI(0.95); // 'LoF_intolerant'
classifyStructureQuality(85); // 'very_high'
```

### Formatting

```typescript
import {
  formatTPM,
  formatPValue,
  getTVSColor,
} from '@splicr/txscore-sdk';

formatTPM(125.6); // '126'
formatPValue(0.0001); // 'p < 0.0001'
getTVSColor(0.85); // '#10b981' (green)
```

### Normalization

```typescript
import { normalizeChronos } from '@splicr/txscore-sdk';

normalizeChronos(-1.5); // 0.6 (normalized to [0,1])
```

---

## 🎨 Type Definitions

All types are fully exported:

```typescript
import type {
  Gene,
  TxScore,
  DepMapData,
  GTExExpression,
  GnomADConstraint,
  AlphaFoldStructure,
  ClinVarVariant,
  DrugInteraction,
  ClinicalTrial,
  TxScoreFilters,
  RankingOptions,
  ModalityRecommendation,
} from '@splicr/txscore-sdk';
```

---

## 🧪 Examples

See `/examples/txscore-demo.ts` for comprehensive examples:

```bash
npm run demo
```

### Example Output

```
🎯 EXAMPLE 1: Top 10 Therapeutic Targets for Lung Adenocarcinoma (LUAD)
================================================================================

Found 10 high-confidence targets:

1. KRAS (ENSG00000133703)
   TVS: 0.876 [EXCEPTIONAL] #10b981
   ├─ Efficacy:        0.921
   ├─ Safety:          0.812
   ├─ Druggability:    0.856
   ├─ Precedent:       0.934
   └─ Stratification:  0.789
   Recommended Modality: small_molecule
```

---

## 📊 Performance

- **Gene lookup by symbol**: <10ms
- **Top 100 targets**: <50ms
- **Full gene profile**: <200ms (parallel queries)
- **Batch operations**: Optimized with `Promise.all()`

---

## 🔒 Security

- Uses Supabase **Row-Level Security (RLS)**
- Read-only access with **anon key**
- Write access requires **service role key**
- All queries are **SQL injection safe**

---

## 🤝 Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 📝 License

MIT License - see [LICENSE](LICENSE) file.

---

## 🔗 Resources

- [TxScore Documentation](../../docs/TXSCORE_README.md)
- [Database Schema](../../supabase/migrations/)
- [Example Application](../../examples/txscore-demo.ts)
- [Supabase Docs](https://supabase.com/docs)

---

## 📧 Support

For questions or issues, please open an issue on GitHub.

---

**Built with ❤️ for cancer drug discovery**
