"""
S_sgRNA: sgRNA Concordance Score Component
Measures agreement among multiple sgRNAs targeting the same gene.
"""
import numpy as np
import pandas as pd
from typing import List, Dict, Any, Optional

def compute_s_sgrna(
    gene: str,
    guide_table: pd.DataFrame,
    effect_table: pd.DataFrame,
    config: Optional[Dict] = None
) -> float:
    """
    Compute S_sgRNA concordance score for a single gene.
    
    Args:
        gene: Gene symbol
        guide_table: DataFrame containing guide sequences and target genes.
                     Expected columns: ['sgrna', 'gene', 'sequence']
        effect_table: DataFrame containing guide-level effects (LFCs).
                      Expected columns: ['sgrna', 'lfc', 'activity_score'] (optional activity)
        config: Optional configuration dictionary
        
    Returns:
        S_sgRNA score [0.0, 1.0]
    """
    # 1. Filter guides for this gene
    # Assume guide_table maps sgrna -> gene
    gene_guides = guide_table[guide_table['gene'] == gene]['sgrna'].tolist()
    
    if not gene_guides:
        return 0.0
        
    # 2. Get LFCs and Activity Scores for these guides
    # intersect with effect table
    gene_effects = effect_table[effect_table['sgrna'].isin(gene_guides)].copy()
    
    n_guides = len(gene_effects)
    
    # Needs at least 1 guide to have a score, but statistically we need more
    if n_guides == 0:
        return 0.0
        
    # Activity score fallback (Azimuth 2.0 or uniform)
    if 'activity_score' not in gene_effects.columns:
        gene_effects['activity_score'] = 0.7
    else:
        # Fill missing with 0.7
        gene_effects['activity_score'] = gene_effects['activity_score'].fillna(0.7)
        
    lfc_values = gene_effects['lfc'].values
    activities = gene_effects['activity_score'].values
    
    # Step 1: Get activity-weighted fold changes
    weighted_lfc = lfc_values * activities
    
    # Step 2: Compute dispersion (CV)
    mean_wlfc = np.mean(weighted_lfc)
    
    if n_guides < 2:
        # Cannot compute variance/CV with 1 point
        # Fallback for single guide: medium confidence if strong effect, else low
        return 0.5
        
    # Variance & Std Dev
    # ddof=1 for sample variance
    variance_wlfc = np.var(weighted_lfc, ddof=1)
    std_wlfc = np.sqrt(variance_wlfc)
    
    # Coefficient of Variation
    # Avoid division by zero
    if abs(mean_wlfc) < 1e-6:
        cv = float('inf') # Effectively huge dispersion relative to mean
    else:
        cv = abs(std_wlfc / mean_wlfc)
        
    # Step 3: Penalize low guide count
    # Ideal >= 4 guides
    guide_penalty = min(n_guides / 4.0, 1.0)
    
    # Step 4: Transform CV to concordance score
    # Empirical: CV < 0.3 is excellent, CV > 1.5 is poor
    if cv < 0.3:
        concordance_raw = 1.0
    elif cv > 1.5:
        concordance_raw = 0.0
    else:
        # Linear decay mapping [0.3, 1.5] -> [1.0, 0.0]
        # Slope = -1 / (1.5 - 0.3) = -1 / 1.2
        concordance_raw = 1.0 - ((cv - 0.3) / 1.2)
        
    # Step 5: Final score calculation
    s_sgrna = concordance_raw * guide_penalty
    
    return max(0.0, min(1.0, s_sgrna))
