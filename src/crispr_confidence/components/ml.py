"""
S_ML: Validation Likelihood Score Component
Heuristic or ML-based prediction of validation success.
"""
from typing import Dict, Any, Optional

def compute_s_ml_heuristic(
    gene: str,
    feature_dict: Dict[str, Any],
    config: Optional[Dict] = None
) -> float:
    """
    Compute heuristic validation likelihood (Cold Start S_ML).
    No ML model required; rule-based scoring.
    
    Args:
        gene: Target gene
        feature_dict: Dictionary containing necessary features:
            - beta_score (float): MAGeCK beta / effect size
            - fdr (float): Significance
            - guide_cv (float): Guide concordance CV (optional)
            - max_cfd (float): Off-target risk (optional)
            - n_enriched_pathways (int): Pathway count (optional)
        config: Optional config
        
    Returns:
        S_ML score [0.0, 1.0]
    """
    
    score = 0.5  # Neutral baseline
    
    # 1. Effect Size (Beta Score)
    # Strong depletion or enrichment
    beta = feature_dict.get('beta_score', 0.0)
    if abs(beta) > 2.0: # Strong effect
        score += 0.15
        
    # 2. Significance (FDR)
    fdr = feature_dict.get('fdr', 1.0)
    if fdr < 0.01:
        score += 0.10
        
    # 3. Guide Concordance (CV)
    # Lower is better
    cv = feature_dict.get('guide_cv', 1.0)
    if cv < 0.4:
        score += 0.10
        
    # 4. Off-Target Risk (Max CFD)
    # Lower is better
    max_cfd = feature_dict.get('max_cfd', 0.0)
    if max_cfd < 0.5:
        score += 0.10
        
    # 5. Pathway Support
    n_paths = feature_dict.get('n_enriched_pathways', 0)
    if n_paths > 0:
        score += 0.05
        
    # Validation evidence?
    # If prior validation exists, boost significantly
    # if feature_dict.get('prior_validation'): score = 1.0
    
    return min(score, 1.0)
