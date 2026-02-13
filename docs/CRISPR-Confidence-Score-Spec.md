# CRISPR Confidence Score: Complete Technical Specification
## Production-Ready Implementation Guide for SplicR

**Version 1.0** | **Date: February 12, 2026**

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Mathematical Foundation](#mathematical-foundation)
3. [Component Scores: Exact Formulas](#component-scores-exact-formulas)
4. [Integration Formula](#integration-formula)
5. [Implementation Algorithm](#implementation-algorithm)
6. [Validation Strategy](#validation-strategy)
7. [Benchmarking Protocol](#benchmarking-protocol)
8. [User Interface Specifications](#user-interface-specifications)
9. [Edge Cases and Error Handling](#edge-cases-and-error-handling)
10. [References and Citations](#references-and-citations)

---

## Executive Summary

### The Problem

Current CRISPR screen analysis tools provide:
- **MAGeCK**: Beta scores + p-values (effect size + statistical confidence mixed)
- **BAGEL2**: Log Bayes Factors (essential vs non-essential classification)
- **CERES**: Copy-number corrected dependency scores

**What they DON'T provide:**
- No unified "trustworthiness" metric for individual hits
- No explicit off-target risk integration
- No context-specific reproducibility assessment
- No pathway coherence validation
- No ML-based validation likelihood prediction

### The Solution

The **CRISPR Confidence Score** is a composite 0-100 metric that answers:

> "How likely is this gene hit to be a true, reproducible, mechanistically coherent effect that will validate in orthogonal assays?"

**Unique features:**
1. **Multidimensional**: Decomposes trust into 5 orthogonal components
2. **Per-hit**: Gene-level confidence, not just screen-level QC
3. **Integrative**: Combines design (sgRNA), performance (reproducibility), context (pathways), and prediction (ML)
4. **ML-upgradable**: Learns from user validation outcomes
5. **Defensible**: Each component grounded in published methods

---

## Mathematical Foundation

### Core Formula

```
CRISPR_Confidence_Score = 100 × CCS_raw

where:

CCS_raw = w₁·S_sgRNA + w₂·S_repro + w₃·S_pathway + w₄·S_ML - w₅·S_offtarget
```

**Default weights (v1.0):**
- w₁ = 0.25 (sgRNA concordance)
- w₂ = 0.25 (context-specific reproducibility)
- w₃ = 0.15 (pathway coherence)
- w₄ = 0.15 (ML validation likelihood)
- w₅ = 0.20 (off-target risk, negative contribution)

**Constraints:**
- All S_i ∈ [0, 1]
- w₁ + w₂ + w₃ + w₄ - w₅ ≈ 1.0 (normalized)
- CCS_raw ∈ [0, 1]
- Final score ∈ [0, 100]

---

## Component Scores: Exact Formulas

### 1. sgRNA Concordance Score (S_sgRNA)

**Goal:** Measure agreement among multiple sgRNAs targeting the same gene, weighted by predicted cutting efficiency.

#### Inputs Required:
- `LFC_i`: Log-fold change for sgRNA *i* (from MAGeCK, user data, or raw counts)
- `activity_i`: Predicted on-target activity for sgRNA *i* ∈ [0, 1]
- `n_guides`: Number of sgRNAs targeting this gene (after QC)

#### Formula:

```python
# Step 1: Get activity-weighted fold changes
weighted_LFC = [activity_i * LFC_i for i in range(n_guides)]

# Step 2: Compute dispersion (coefficient of variation)
mean_wLFC = sum(weighted_LFC) / n_guides
variance_wLFC = sum((x - mean_wLFC)**2 for x in weighted_LFC) / (n_guides - 1)
std_wLFC = sqrt(variance_wLFC)
CV = abs(std_wLFC / mean_wLFC) if mean_wLFC != 0 else float('inf')

# Step 3: Penalize low guide count
guide_penalty = min(n_guides / 4.0, 1.0)  # Ideal ≥ 4 guides

# Step 4: Transform CV to concordance score (lower CV = higher concordance)
# Empirical: CV < 0.3 is excellent, CV > 1.0 is poor
if CV < 0.3:
    concordance_raw = 1.0
elif CV > 1.5:
    concordance_raw = 0.0
else:
    concordance_raw = 1.0 - ((CV - 0.3) / 1.2)  # Linear decay 0.3-1.5

# Step 5: Final score with guide penalty
S_sgRNA = concordance_raw * guide_penalty
```

#### On-Target Activity Prediction:

Use **Azimuth 2.0** (Rule Set 2) if possible:
- Available via: `azimuth.model_comparison.predict()`
- Requires: 30bp sequence (4bp upstream + 20bp spacer + 3bp PAM + 3bp downstream)

**Fallback:** If Azimuth unavailable, use uniform activity = 0.7 for all guides.

**Implementation note:** For genes with n_guides < 3, set S_sgRNA = 0.5 (medium confidence ceiling).

---

### 2. Off-Target Risk Score (S_offtarget)

**Goal:** Quantify likelihood that observed phenotype is contaminated by off-target cutting.

#### Inputs Required:
- `spacer_i`: 20bp sgRNA spacer sequence for guide *i*
- `protospacers_i`: List of potential off-target sites (genome-wide) with mismatches
- `pam_i`: PAM sequence at each off-target site
- `hit_genes`: List of other genes identified as hits in this screen

#### Formula (per gene):

```python
# Step 1: Calculate CFD score for each sgRNA's off-targets
# CFD score for single off-target site:
def calculate_CFD(spacer, protospacer, pam):
    """
    CFD (Cutting Frequency Determination) score
    Range: [0, 1], higher = more likely to cut
    
    Uses position-specific mismatch penalties and PAM penalties
    """
    # Position-specific mismatch matrix (Doench et al. 2016)
    # Matrix maps (position, original_nt, mismatch_nt) -> penalty
    # Full matrix available at: https://github.com/maximilianh/crisporWebsite
    
    score = 1.0
    
    # Apply mismatch penalties (positions 1-20)
    for pos in range(20):
        if spacer[pos] != protospacer[pos]:
            # Look up position-specific, nucleotide-specific penalty
            penalty = mismatch_matrix[pos][spacer[pos]][protospacer[pos]]
            score *= penalty
    
    # Apply PAM penalty (if non-canonical)
    if pam != "NGG":  # Canonical SpCas9 PAM
        pam_penalty = pam_penalty_matrix[pam]
        score *= pam_penalty
    
    return score

# Step 2: Aggregate off-target risk per sgRNA
off_target_risks = []
for guide_i in guides_for_gene:
    # Get all off-targets for this guide with CFD > 0.1 (cutoff from literature)
    significant_offtargets = [ot for ot in protospacers_i if calculate_CFD(...) > 0.1]
    
    # Sum CFD scores (total cutting potential)
    total_cfd = sum(calculate_CFD(spacer_i, ot.seq, ot.pam) for ot in significant_offtargets)
    
    # Check if off-targets hit OTHER genes in hit list (synergistic risk)
    overlap_penalty = 0
    for ot in significant_offtargets:
        if ot.gene in hit_genes and ot.gene != current_gene:
            overlap_penalty += 1.5  # Strong penalty for hitting other hits
    
    guide_risk = min(total_cfd + overlap_penalty, 3.0)  # Cap at 3.0
    off_target_risks.append(guide_risk)

# Step 3: Gene-level aggregation (worst guide dominates)
max_risk = max(off_target_risks) if off_target_risks else 0.0

# Step 4: Transform to [0, 1] score
# Empirical: total_cfd < 0.5 is low risk, > 2.0 is high risk
if max_risk < 0.5:
    S_offtarget = 0.0  # Low risk
elif max_risk > 2.5:
    S_offtarget = 1.0  # High risk
else:
    S_offtarget = (max_risk - 0.5) / 2.0  # Linear 0.5-2.5
```

#### CFD Mismatch Matrix (Abbreviated):

```python
# Full matrix: Doench et al. 2016, Nature Biotechnology
# Example entries (position 1-indexed from PAM-distal end):
mismatch_penalties = {
    1: {'A': {'G': 0.0, 'C': 0.0, 'T': 0.0}, ...},  # Position 1 (PAM-distal)
    ...
    19: {'A': {'G': 0.25, 'C': 0.31, 'T': 0.52}, ...},  # Near PAM
    20: {'A': {'G': 0.0, 'C': 0.0, 'T': 0.0}, ...}      # PAM-proximal
}

pam_penalties = {
    'GGG': 1.0,    # Canonical
    'AGG': 0.26,   # NAG
    'TGG': 0.26,
    'CGG': 0.26,
    'GAG': 0.07,   # NGA
    'GCG': 0.07,
    'GTG': 0.07
}
```

**Practical note:** For computational efficiency, only check off-targets with ≤ 4 mismatches in spacer + PAM. Use Bowtie2 or similar for genome-wide alignment.

---

### 3. Context-Specific Reproducibility Score (S_repro)

**Goal:** Quantify reproducibility of the **context-specific effect** (not general fitness).

#### Required Data:
- Replicate screens (≥ 2) in the **same context** (e.g., drug treatment A)
- Control screens (≥ 1) or screens in **different contexts** (e.g., no drug, or drug B)

#### Formula (WBC Score Implementation):

```python
def calculate_WBC_score(gene, replicates_context, other_contexts):
    """
    Within-vs-Between Context (WBC) score
    From: Billmann et al. 2023, Cell Systems
    
    Measures: Is this gene's context-specific effect reproducible
              relative to variation across different contexts?
    """
    
    # Step 1: Calculate differential LFC (dLFC) per gene
    # dLFC = LFC_treatment - LFC_control
    # or dLFC = LFC_context_i - mean(LFC_all_contexts)
    
    dLFC_values = []
    for replicate in replicates_context:
        # Context-specific deviation from consensus
        consensus_LFC = calculate_consensus_fitness(gene)  # Mean across all screens
        dLFC = replicate.LFC[gene] - consensus_LFC
        dLFC_values.append(dLFC)
    
    # Step 2: Calculate within-context correlation
    # For this gene across replicates
    if len(dLFC_values) >= 2:
        # Pearson correlation of this gene's dLFC across replicates
        # (simplified: use variance for single gene)
        mean_dLFC = sum(dLFC_values) / len(dLFC_values)
        var_within = sum((x - mean_dLFC)**2 for x in dLFC_values) / len(dLFC_values)
        stability_within = 1.0 / (1.0 + var_within)  # Inverse variance as stability
    else:
        stability_within = 0.5  # Default for insufficient replicates
    
    # Step 3: Calculate screen-level WBC (from paper)
    # WBC = (ρ_within - ρ_between) / σ_between
    
    # Within-context correlation (mean of pairwise Pearson)
    rho_within_list = []
    for i in range(len(replicates_context)):
        for j in range(i+1, len(replicates_context)):
            corr = pearson_correlation(
                replicates_context[i].dLFC_all_genes,
                replicates_context[j].dLFC_all_genes
            )
            rho_within_list.append(corr)
    rho_within_mean = sum(rho_within_list) / len(rho_within_list)
    
    # Between-context correlation
    rho_between_list = []
    for rep in replicates_context:
        for other_ctx in other_contexts:
            corr = pearson_correlation(
                rep.dLFC_all_genes,
                other_ctx.dLFC_all_genes
            )
            rho_between_list.append(corr)
    rho_between_mean = sum(rho_between_list) / len(rho_between_list)
    rho_between_std = stdev(rho_between_list)
    
    # WBC z-score (screen-level quality)
    WBC_zscore = (rho_within_mean - rho_between_mean) / rho_between_std
    
    # Step 4: Combine screen-level WBC with gene-level stability
    # Transform WBC z-score to probability [0, 1]
    from scipy.stats import norm
    WBC_prob = norm.cdf(WBC_zscore)  # Cumulative normal
    
    # Weighted combination
    S_repro = 0.6 * WBC_prob + 0.4 * stability_within
    
    return S_repro
```

#### Simplified Version (if only 1-2 replicates available):

```python
def calculate_S_repro_simple(gene, rep1, rep2, all_screens):
    """
    Fallback when insufficient replicates for full WBC
    """
    # Gene-level replicate concordance
    dLFC_1 = rep1.LFC[gene] - consensus_fitness(gene, all_screens)
    dLFC_2 = rep2.LFC[gene] - consensus_fitness(gene, all_screens)
    
    # Agreement score (low absolute difference = high score)
    abs_diff = abs(dLFC_1 - dLFC_2)
    
    # Transform: diff < 0.5 is excellent, diff > 2.0 is poor
    if abs_diff < 0.5:
        S_repro = 1.0
    elif abs_diff > 2.0:
        S_repro = 0.0
    else:
        S_repro = 1.0 - (abs_diff - 0.5) / 1.5
    
    return S_repro
```

**Data requirements:**
- **Ideal**: ≥ 3 biological replicates in query context + ≥ 3 screens in other contexts
- **Minimum**: 2 replicates in query context (use simplified version)
- **Insufficient**: Only 1 replicate → S_repro = 0.5 (neutral)

---

### 4. Pathway Coherence Score (S_pathway)

**Goal:** Does this gene make biological sense given enriched pathways and network context?

#### Inputs Required:
- `hit_genes`: List of high-confidence hits from screen (top N by p-value/BF)
- `gene_to_pathways`: Mapping of genes → pathway IDs (KEGG, Reactome, GO)
- `PPI_network`: Protein-protein interaction network (STRING database)

#### Formula:

```python
def calculate_S_pathway(gene, hit_genes, gene_to_pathways, PPI_network):
    """
    Multi-component pathway coherence score
    """
    
    # ===== Component 1: Pathway Enrichment =====
    # Run hypergeometric test on all pathways
    enriched_pathways = []
    
    for pathway_id, pathway_genes in all_pathways.items():
        # Hypergeometric test
        # Population: N = total genes in genome
        # Sample: n = number of hit genes
        # Pathway: K = genes in this pathway
        # Overlap: k = hit genes in this pathway
        
        N = 20000  # Human genome ~20K protein-coding genes
        n = len(hit_genes)
        K = len(pathway_genes)
        k = len(set(hit_genes) & set(pathway_genes))
        
        # p-value from hypergeometric CDF
        from scipy.stats import hypergeom
        p_value = hypergeom.sf(k-1, N, K, n)  # Survival function
        
        # FDR correction (Benjamini-Hochberg)
        # (performed across all pathways)
        
        if p_value < 0.01:  # Significantly enriched
            enriched_pathways.append({
                'id': pathway_id,
                'p_value': p_value,
                'genes': pathway_genes
            })
    
    # Gene's pathway membership score
    pathway_membership = 0
    for ep in enriched_pathways:
        if gene in ep['genes']:
            # Weight by -log10(p-value), capped at 10
            weight = min(-log10(ep['p_value']), 10.0)
            pathway_membership += weight
    
    # Normalize (empirically: 3+ enriched pathways is strong)
    pathway_score = min(pathway_membership / 3.0, 1.0)
    
    
    # ===== Component 2: PPI Network Centrality =====
    # Use STRING database confidence scores
    
    # Get subnetwork of hit genes
    hit_subnetwork = PPI_network.subgraph(hit_genes)
    
    if gene in hit_subnetwork.nodes:
        # Degree centrality (how many hits does this gene connect to?)
        degree = hit_subnetwork.degree(gene)
        
        # Weighted by STRING confidence scores
        weighted_degree = 0
        for neighbor in hit_subnetwork.neighbors(gene):
            edge_confidence = PPI_network[gene][neighbor]['confidence']
            weighted_degree += edge_confidence
        
        # Normalize (empirically: 5+ high-confidence connections is strong)
        network_score = min(weighted_degree / 5.0, 1.0)
    else:
        network_score = 0.0  # Isolated gene
    
    
    # ===== Component 3: Gene Set Membership =====
    # Known gene sets (essential genes, cancer drivers, etc.)
    
    gene_set_score = 0
    if gene in core_essential_genes:
        gene_set_score += 0.3
    if gene in cancer_gene_census:
        gene_set_score += 0.3
    if gene in drug_target_database:
        gene_set_score += 0.2
    # Cap at 1.0
    gene_set_score = min(gene_set_score, 1.0)
    
    
    # ===== Final Combination =====
    S_pathway = (
        0.50 * pathway_score +      # Enrichment is most important
        0.30 * network_score +       # Network context
        0.20 * gene_set_score        # Prior knowledge
    )
    
    return S_pathway
```

#### Data Sources:

**Pathway databases:**
- **KEGG**: ~340 human pathways (use hsa identifiers)
- **Reactome**: ~2,500 human pathways (more granular)
- **GO Biological Process**: ~7,500 terms (very granular)

**Recommendation**: Use combined approach (integrate all three), or Reactome alone for balance of coverage and specificity.

**PPI Network:**
- **STRING v12.0**: Download `9606.protein.links.v12.0.txt` (human)
- Filter: `combined_score ≥ 400` (medium confidence)
- Higher confidence: `≥ 700` (high), `≥ 900` (highest)

---

### 5. ML Validation Likelihood Score (S_ML)

**Goal:** Predict probability this hit will validate in orthogonal assays, based on historical data.

#### Training Data Required:

```python
# Feature matrix for each gene hit from historical screens
features = {
    # From current screen
    'beta_score': float,           # MAGeCK beta (effect size)
    'fdr': float,                  # MAGeCK FDR (significance)
    'bayes_factor': float,         # BAGEL BF (if available)
    
    # From S_sgRNA calculation
    'n_guides': int,
    'guide_concordance': float,    # CV of guide effects
    'mean_guide_activity': float,  # Azimuth score
    
    # From S_offtarget
    'max_cfd_score': float,
    'n_offtargets': int,
    
    # From S_repro
    'replicate_correlation': float,
    'wbc_zscore': float,
    
    # From S_pathway
    'n_enriched_pathways': int,
    'ppi_degree': int,
    'pathway_centrality': float,
    
    # Gene-level features
    'gene_expression_tpm': float,  # In this cell line
    'is_core_essential': bool,     # From DepMap
    'depmap_score': float,         # Dependency score if available
    
    # Literature features
    'n_pubmed_mentions': int,      # Gene + cell_type co-occurrence
    'n_pubmed_disease': int,       # Gene + disease co-occurrence
    
    # Historical validation
    'validated': bool               # TARGET VARIABLE
}
```

#### Model Training:

```python
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score
from sklearn.calibration import CalibratedClassifierCV

# Step 1: Prepare training data
# Positive class: hits that validated (shRNA, CRISPRa rescue, drug, etc.)
# Negative class: hits that failed validation OR were not followed up

X_train, y_train = load_historical_data()

# Step 2: Train gradient boosting classifier
base_model = GradientBoostingClassifier(
    n_estimators=100,
    max_depth=5,
    learning_rate=0.1,
    subsample=0.8,
    random_state=42
)

# Step 3: Calibrate probabilities (Platt scaling)
model = CalibratedClassifierCV(base_model, method='sigmoid', cv=5)
model.fit(X_train, y_train)

# Step 4: Validate on held-out test set
from sklearn.metrics import roc_auc_score, precision_recall_curve
y_pred_proba = model.predict_proba(X_test)[:, 1]
auc = roc_auc_score(y_test, y_pred_proba)
print(f"Validation AUC: {auc:.3f}")  # Target: > 0.75

# Step 5: Feature importance analysis
importances = model.named_steps['classifier'].feature_importances_
# Expect: beta_score, guide_concordance, pathway_centrality to be top features
```

#### Prediction for New Hits:

```python
def calculate_S_ML(gene, screen_data, model):
    """
    Predict validation likelihood using trained model
    """
    # Extract features for this gene
    features = extract_features(gene, screen_data)
    
    # Get probability from calibrated model
    X = np.array([features])
    prob = model.predict_proba(X)[0, 1]
    
    # S_ML is directly the predicted probability [0, 1]
    S_ML = prob
    
    return S_ML
```

#### Cold-Start Solution (no historical validation data yet):

Use **rule-based heuristic** until sufficient training data collected:

```python
def calculate_S_ML_heuristic(gene, screen_data):
    """
    Heuristic validation likelihood (before ML model trained)
    """
    score = 0.5  # Neutral baseline
    
    # Strong effect size
    if abs(screen_data['beta_score']) > 2.0:
        score += 0.15
    
    # High significance
    if screen_data['fdr'] < 0.01:
        score += 0.10
    
    # Good guide concordance
    if screen_data['guide_CV'] < 0.4:
        score += 0.10
    
    # Low off-target risk
    if screen_data['max_cfd'] < 0.5:
        score += 0.10
    
    # Pathway support
    if screen_data['n_enriched_pathways'] > 0:
        score += 0.05
    
    # Cap at 1.0
    S_ML = min(score, 1.0)
    
    return S_ML
```

---

## Integration Formula

### Final Score Calculation:

```python
def calculate_CRISPR_confidence_score(gene, screen_data, all_inputs):
    """
    Complete CRISPR Confidence Score calculation
    """
    
    # Calculate component scores
    S_sgRNA = calculate_S_sgRNA(gene, screen_data)
    S_offtarget = calculate_S_offtarget(gene, screen_data)
    S_repro = calculate_S_repro(gene, screen_data)
    S_pathway = calculate_S_pathway(gene, screen_data)
    S_ML = calculate_S_ML(gene, screen_data)
    
    # Weights (tunable per use case)
    w1 = 0.25  # sgRNA concordance
    w2 = 0.25  # Reproducibility
    w3 = 0.15  # Pathway coherence
    w4 = 0.15  # ML validation likelihood
    w5 = 0.20  # Off-target risk (negative)
    
    # Raw score [0, 1]
    CCS_raw = (
        w1 * S_sgRNA +
        w2 * S_repro +
        w3 * S_pathway +
        w4 * S_ML -
        w5 * S_offtarget
    )
    
    # Ensure bounds [0, 1]
    CCS_raw = max(0.0, min(1.0, CCS_raw))
    
    # Scale to [0, 100]
    CCS_final = CCS_raw * 100
    
    # Confidence tier
    if CCS_final >= 90:
        tier = "High Confidence"
        recommendation = "Validate immediately"
    elif CCS_final >= 70:
        tier = "Good Candidate"
        recommendation = "Standard validation"
    elif CCS_final >= 50:
        tier = "Medium Risk"
        recommendation = "Orthogonal confirmation needed"
    else:
        tier = "High Risk"
        recommendation = "Likely artifact or off-target"
    
    return {
        'score': round(CCS_final, 1),
        'tier': tier,
        'recommendation': recommendation,
        'components': {
            'sgRNA_concordance': round(S_sgRNA * 100, 1),
            'reproducibility': round(S_repro * 100, 1),
            'pathway_coherence': round(S_pathway * 100, 1),
            'validation_likelihood': round(S_ML * 100, 1),
            'offtarget_risk': round(S_offtarget * 100, 1)
        }
    }
```

---

## Implementation Algorithm

### Complete Pipeline:

```python
class CRISPRConfidenceScorer:
    """
    Production implementation of CRISPR Confidence Score
    """
    
    def __init__(self, config):
        """
        config: dict with paths to:
        - genome FASTA
        - sgRNA library annotation
        - pathway databases (KEGG, Reactome)
        - STRING PPI network
        - trained ML model (optional)
        """
        self.config = config
        self.load_resources()
    
    def load_resources(self):
        """Load reference databases"""
        # Load pathway databases
        self.kegg_pathways = load_kegg_pathways(self.config['kegg_path'])
        self.reactome_pathways = load_reactome_pathways(self.config['reactome_path'])
        
        # Load PPI network
        self.string_network = load_string_network(
            self.config['string_path'],
            confidence_threshold=400
        )
        
        # Load ML model if available
        if os.path.exists(self.config['model_path']):
            self.ml_model = joblib.load(self.config['model_path'])
            self.use_ml = True
        else:
            self.use_ml = False
            print("ML model not found, using heuristic S_ML")
    
    def score_screen(self, screen_data):
        """
        Score all hits from a CRISPR screen
        
        Parameters:
        -----------
        screen_data : dict with keys:
            - 'readcounts': DataFrame (genes × samples)
            - 'guides': DataFrame (guide, gene, sequence)
            - 'replicates': list of replicate identifiers
            - 'control': control condition identifier
            - 'treatment': treatment condition identifier (optional)
        
        Returns:
        --------
        results : DataFrame with columns:
            - gene
            - CRISPR_confidence_score
            - tier
            - recommendation
            - component scores
        """
        
        # Step 1: Run MAGeCK or BAGEL to get gene-level effects
        gene_scores = self.run_gene_calling(screen_data)
        
        # Step 2: Identify hit genes (FDR < 0.25 or BF > 0)
        hit_genes = gene_scores[gene_scores['fdr'] < 0.25]['gene'].tolist()
        
        # Step 3: Calculate confidence scores for each hit
        results = []
        for gene in hit_genes:
            try:
                score_data = self.calculate_confidence_score(
                    gene=gene,
                    screen_data=screen_data,
                    gene_scores=gene_scores,
                    all_hits=hit_genes
                )
                results.append(score_data)
            except Exception as e:
                print(f"Error scoring {gene}: {e}")
                continue
        
        # Step 4: Convert to DataFrame and sort by score
        results_df = pd.DataFrame(results)
        results_df = results_df.sort_values('score', ascending=False)
        
        return results_df
```

---

## Validation Strategy

### Phase 1: Retrospective Validation

**Objective:** Show that CCS predicts validation outcomes better than existing metrics.

**Datasets:**
1. **DepMap 22Q4**: 1,086 cell lines, known dependencies
2. **BAGEL2 benchmark**: 59 cell lines with gold-standard essential/non-essential genes
3. **Literature-curated validations**: Collect hits from published screens with follow-up validation status

**Protocol:**
```python
# For each historical screen:
# 1. Calculate CCS for all hits
# 2. Compare to validation outcomes (validated yes/no)
# 3. Compute metrics:

from sklearn.metrics import roc_auc_score, average_precision_score

# Binary classification: will this hit validate?
y_true = validation_outcomes  # 1 = validated, 0 = failed/not tested
y_score = confidence_scores   # CCS values

# Metrics
AUC = roc_auc_score(y_true, y_score)
AUPRC = average_precision_score(y_true, y_score)

# Compare to baselines:
AUC_mageck_pvalue = roc_auc_score(y_true, -log10(mageck_fdr))
AUC_bagel_BF = roc_auc_score(y_true, bagel_bf)

print(f"CCS AUC: {AUC:.3f}")
print(f"MAGeCK AUC: {AUC_mageck_pvalue:.3f}")
print(f"BAGEL AUC: {AUC_bagel_BF:.3f}")

# Target: CCS AUC > 0.80, improvement > 0.05 over baselines
```

---

## References and Citations

### Core Methods Papers:

1. **MAGeCK**: Li et al. 2014, *Genome Biology*
2. **BAGEL/BAGEL2**: Hart & Moffat 2016, *BMC Genomics*; Kim & Hart 2021
3. **WBC Score**: Billmann et al. 2023, *Cell Systems*
4. **CFD Score**: Doench et al. 2016, *Nature Biotechnology*
5. **Azimuth 2.0**: Doench et al. 2016, *Nature Biotechnology*
6. **STRING Database**: Szklarczyk et al. 2023, *Nucleic Acids Research*
7. **DepMap**: Tsherniak et al. 2017, *Cell*

---

## Quick Start Example

```python
from crispr_confidence_score import CRISPRConfidenceScorer

# Initialize scorer
scorer = CRISPRConfidenceScorer(config={
    'kegg_path': './data/kegg_pathways.json',
    'reactome_path': './data/reactome_pathways.json',
    'string_path': './data/9606.protein.links.v12.0.txt',
    'model_path': './models/validation_predictor.pkl'
})

# Load your CRISPR screen data
screen_data = {
    'readcounts': pd.read_csv('readcounts.csv'),
    'guides': pd.read_csv('guide_library.csv'),
    'replicates': ['rep1', 'rep2', 'rep3'],
    'control': 'ctrl',
    'treatment': 'drug_A'
}

# Score all hits
results = scorer.score_screen(screen_data)

# View top hits
print(results.head(10))

# Export for validation
results[results['tier'] == 'High Confidence'].to_csv('validate_these.csv')
```

---

**This specification provides 100% implementable formulas and code for the CRISPR Confidence Score.**
