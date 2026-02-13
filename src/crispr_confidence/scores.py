"""
Core scoring functions for CRISPR Confidence Score (CCS).
Implements the 5 component scores and final aggregation.
"""
import numpy as np
import math
from typing import List, Dict, Any, Optional

# --- Component 1: sgRNA Concordance Score ---
def calculate_sgRNA_score(
    lfcs: List[float],
    activities: Optional[List[float]] = None
) -> Dict[str, Any]:
    """
    Calculate sgRNA Concordance Score (S_sgRNA).
    
    Args:
        lfcs: List of Log-Fold Changes for guides targeting the gene.
        activities: Optional list of activity scores [0, 1]. Defaults to 0.7 if None.
        
    Returns:
        Dict containing 'score' (0-1) and metadata.
    """
    n_guides = len(lfcs)
    if n_guides == 0:
        return {'score': 0.0, 'raw_cv': None, 'n_guides': 0}
        
    if activities is None or len(activities) != n_guides:
        activities = [0.7] * n_guides
        
    # 1. Activity-weighted LFC
    weighted_lfc = [a * l for a, l in zip(activities, lfcs)]
    
    # 2. Compute Dispersion (CV)
    mean_wLFC = np.mean(weighted_lfc)
    if mean_wLFC == 0:
        cv = float('inf')
    else:
        std_wLFC = np.std(weighted_lfc, ddof=1) if n_guides > 1 else 0.0
        cv = abs(std_wLFC / mean_wLFC)
        
    # 3. Penalty for low guide count
    guide_penalty = min(n_guides / 4.0, 1.0)
    
    # 4. Transform CV to Score
    # CV < 0.3 -> 1.0
    # CV > 1.5 -> 0.0
    if cv < 0.3:
        concordance_raw = 1.0
    elif cv > 1.5:
        concordance_raw = 0.0
    else:
        concordance_raw = 1.0 - ((cv - 0.3) / 1.2)
        
    s_sgrna = concordance_raw * guide_penalty
    
    # Low guide count fallback
    if n_guides < 3:
         # Cap at 0.5 for very few guides unless perfect concordance? 
         # Spec says: "For genes with n_guides < 3, set S_sgRNA = 0.5"
         s_sgrna = 0.5

    return {
        'score': float(s_sgrna),
        'cv': float(cv) if cv != float('inf') else 999.0,
        'mean_lfc': float(mean_wLFC),
        'n_guides': n_guides
    }

# --- Component 2: Off-Target Risk Score ---
def calculate_offtarget_score(
    spacers: List[str],
    # simplified for now, assuming we get pre-calculated risk or mock it
    # in a real implementation we'd need a big lookup table or external service
    max_risk_score: float = 0.0 
) -> Dict[str, Any]:
    """
    Calculate Off-Target Risk Score (S_offtarget).
    
    Args:
        spacers: List of spacer sequences.
        max_risk_score: Pre-calculated max CFD risk for the gene.
        
    Returns:
        Dict with 'score' (0-1).
    """
    # Transform to [0, 1]
    # < 0.5 -> 0.0 (Low risk)
    # > 2.5 -> 1.0 (High risk)
    if max_risk_score < 0.5:
        s_offtarget = 0.0
    elif max_risk_score > 2.5:
        s_offtarget = 1.0
    else:
        s_offtarget = (max_risk_score - 0.5) / 2.0
        
    return {
        'score': float(s_offtarget),
        'max_risk': float(max_risk_score)
    }

# --- Component 3: Reproducibility Score ---
def calculate_reproducibility_score(
    lfc_replicates: List[float],
    lfc_others: Optional[List[float]] = None
) -> Dict[str, Any]:
    """
    Calculate Context-Specific Reproducibility Score (S_repro).
    Simplified version using variance if extensive context data is missing.
    """
    n_reps = len(lfc_replicates)
    if n_reps < 2:
        return {'score': 0.5, 'method': 'insufficient_reps'}
        
    # Calculate simple variance/agreement
    mean_lfc = np.mean(lfc_replicates)
    variance = np.var(lfc_replicates)
    
    # Inverse variance stability metric
    # Var=0 -> 1.0
    stability = 1.0 / (1.0 + variance)
    
    # If we had other contexts, we'd do the full WBC calculation.
    # For now, we use a simplified stability metric mapped to 0-1
    
    # Heuristic mapping
    s_repro = float(stability)
    
    return {
        'score': min(max(s_repro, 0.0), 1.0),
        'variance': float(variance)
    }

# --- Component 4: Pathway Coherence Score ---
def calculate_pathway_score(
    gene_id: str,
    enriched_pathways: List[str],
    gene_pathways: List[str]
) -> Dict[str, Any]:
    """
    Calculate Pathway Coherence Score (S_pathway).
    """
    # Overlap between gene's pathways and enriched pathways
    overlap = set(gene_pathways).intersection(set(enriched_pathways))
    n_overlap = len(overlap)
    
    # Simple scoring: more overlap is better
    # 0 -> 0.0
    # 1 -> 0.5
    # >=2 -> 1.0
    if n_overlap == 0:
        s_pathway = 0.0
    elif n_overlap == 1:
        s_pathway = 0.5
    else:
        s_pathway = 1.0
        
    return {
        'score': s_pathway,
        'n_overlap': n_overlap
    }

# --- Component 5: ML / Heuristic Score ---
def calculate_ml_score(
    beta_score: float,
    fdr: float,
    s_sgrna: float,
    s_offtarget: float
) -> Dict[str, Any]:
    """
    Calculate ML Validation Likelihood (S_ML).
    Uses Heuristic if no model present.
    """
    score = 0.5 # Neutral
    
    # Strong effect
    if abs(beta_score) > 1.0: # relaxed threshold
        score += 0.15
        
    # High significance
    if fdr < 0.05:
        score += 0.10
        
    # Good guide concordance
    if s_sgrna > 0.7:
        score += 0.10
        
    # Low off-target
    if s_offtarget < 0.2:
        score += 0.10
        
    return {'score': min(score, 1.0)}

# --- Final Aggregation ---
def calculate_ccs(
    gene_id: str,
    component_scores: Dict[str, float],
    weights: Optional[Dict[str, float]] = None
) -> Dict[str, Any]:
    """
    Aggregate component scores into final CCS (0-100).
    """
    if weights is None:
        weights = {
            'w1': 0.25, # sgRNA
            'w2': 0.25, # Repro
            'w3': 0.15, # Pathway
            'w4': 0.15, # ML
            'w5': 0.20  # Off-target (subtractive)
        }
        
    w1, w2, w3, w4, w5 = weights['w1'], weights['w2'], weights['w3'], weights['w4'], weights['w5']
    
    s1 = component_scores.get('S_sgRNA', 0.5)
    s2 = component_scores.get('S_repro', 0.5)
    s3 = component_scores.get('S_pathway', 0.0)
    s4 = component_scores.get('S_ML', 0.5)
    s5 = component_scores.get('S_offtarget', 0.0)
    
    ccs_raw = (w1*s1) + (w2*s2) + (w3*s3) + (w4*s4) - (w5*s5)
    ccs_raw = max(0.0, min(1.0, ccs_raw))
    ccs_final = round(ccs_raw * 100, 1)
    
    # Classification
    if ccs_final >= 90:
        tier = "High Confidence"
        rec = "Validate immediately"
    elif ccs_final >= 70:
        tier = "Good Candidate"
        rec = "Standard validation"
    elif ccs_final >= 50:
        tier = "Medium Risk"
        rec = "Orthogonal confirmation needed"
    else:
        tier = "High Risk"
        rec = "Likely artifact or off-target"
        
    return {
        'gene': gene_id,
        'score': ccs_final,
        'tier': tier,
        'recommendation': rec,
        'components': {
            'sgRNA_concordance': round(s1 * 100, 1),
            'reproducibility': round(s2 * 100, 1),
            'pathway_coherence': round(s3 * 100, 1),
            'validation_likelihood': round(s4 * 100, 1),
            'offtarget_risk': round(s5 * 100, 1)
        }
    }
