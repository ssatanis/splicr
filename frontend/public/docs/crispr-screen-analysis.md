# CRISPR Screen Analysis — SplicR Documentation

## 1. Introduction

**CRISPR pooled screens** enable systematic interrogation of gene function across the genome. SplicR provides a unified, reproducible, and efficient workflow for primary analysis of CRISPR knockout (CRISPRko), activation (CRISPRa), and inhibition (CRISPRi) screens.

This documentation outlines the computational principles, statistical methods, and result interpretation for CRISPR screen data processed through SplicR.

---

## 2. Workflow Overview

The analysis pipeline in SplicR encompasses the following key steps:

1. **Upload**: Raw FASTQ files and sample metadata are provided.
2. **Demultiplexing & Guide Counting**: Reads are assigned to single guide RNAs (sgRNAs) using library-specific matching.
3. **Normalization**: Read counts are normalized across samples to control for sequencing depth and technical variability.
4. **Statistical Testing**: Performed using state-of-the-art methods (MAGeCK, BAGEL2, DrugZ) for hit calling.
5. **Multiple Testing Correction**: Adjustment for false discovery using the Benjamini-Hochberg procedure.
6. **Quality Control**: Comprehensive metrics to assess screen quality, coverage, and reproducibility.
7. **Visualization & Export**: Publication-ready plots and downloadable result tables.

---

## 3. Data Processing Details

### Guide Counting

- SplicR extracts sgRNA sequences from each FASTQ read.
- Guides are mapped against the reference library allowing for user-defined mismatches.

Let $C_{i,j}$ denote the raw read count for sgRNA $i$ in sample $j$.

### Normalization

**Median-ratio normalization** (default; MAGeCK style):

$$s_j = \text{median}_i \left( \frac{C_{i,j}}{g_i} \right)$$

where $g_i$ is the geometric mean across samples for sgRNA $i$:

$$g_i = \left( \prod_{j=1}^n C_{i,j} \right)^{1/n}$$

Normalized counts:

$$C'_{i,j} = \frac{C_{i,j}}{s_j}$$

Additional supported: Total count (CPM), quantile, or no normalization.

---

## 4. Statistical Analysis

### 4.1 MAGeCK (Robust Rank Aggregation)

**Purpose**: Identify genes significantly enriched or depleted.

**Model**: Negative binomial modeling of read counts.

For each gene $G$:

**Fold change**:

$$\Delta_{G} = \log_2 \left( \frac{\bar{C}_{G,\text{treatment}}}{\bar{C}_{G,\text{control}}} \right)$$

**p-value** from RRA aggregation of per-guide rankings.

**FDR correction** via Benjamini-Hochberg.

---

### 4.2 BAGEL2 (Bayesian Analysis of Gene Essentiality)

**Purpose**: Classify genes as essential/non-essential.

**Statistic**: Bayes Factor for each gene $G$:

$$\text{BF}_G = \log_{10} \left( \frac{P(\text{data}_G \mid \text{essential})}{P(\text{data}_G \mid \text{non-essential})} \right)$$

**Interpretation**:
- $\text{BF}_G > 10$: Strong evidence for essentiality
- $\text{BF}_G < -10$: Strong evidence for non-essentiality

---

### 4.3 DrugZ

**Purpose**: Detect genetic interactions/synthetic lethality (e.g., drug response screens).

**Test statistic**:

$$Z_{G} = \frac{ \bar{\text{LFC}}_{G,\text{treatment}} - \bar{\text{LFC}}_{G,\text{control}} }{ \sqrt{ \text{Var}(\text{LFC}_G) / n } }$$

where LFC is log2 fold change per sgRNA.

**Multiple test correction**: Benjamini-Hochberg FDR.

---

## 5. Quality Control Metrics

- **Library coverage**: Guides detected (%) across samples.
- **Gini index**: Uniformity of guide representation.
- **Replicate correlation**: Pearson $R^2$ across replicates.
- **Outlier guides/genes**: Identified and flagged for review.

---

## 6. Output & Download

- **Gene-level results**: log2 fold changes, p-values, FDR, Bayes factors
- **sgRNA-level results**: counts, normalized values
- **QC report**: Core metrics, sample stats, recommendations
- **Plots**: Volcano, MA, Gini, replicate scatter
- **Export formats**: .tsv, .csv, LaTeX-ready .tex, full PDF report

---

## 7. Methods Section Template (for Papers)

*CRISPR screen data were analyzed using SplicR (https://splicr.org). FASTQ files were mapped to library sequences, count tables normalized using median-ratio scaling, differential abundance calculated using MAGeCK (Li et al., Genome Biol 2014), with FDR < 0.05 as the significance threshold. Essentiality analysis used BAGEL2 (Hart et al.) based on curated reference sets. Quality metrics and visualizations were auto-generated using the platform.*

---

## 8. References

- Li W, et al. (2014) "MAGeCK enables robust identification of essential genes from genome-scale CRISPR/Cas9 knockout screens." *Genome Biology*.
- Kim E, Hart T. (2021) "BAGEL2: Improved essential gene identification..." *BMC Genomics*.
- Colic M, et al. (2019) "Identifying chemogenetic interactions from CRISPR screens with drugZ." *Genetics*.

---

**Last updated**: February 2026  
**Version**: 1.0
