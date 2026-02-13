"""
S_offtarget: Off-Target Risk Score Component
Quantifies likelihood that observed phenotype is contaminated by off-target cutting.
"""
from typing import List, Dict, Any, Optional

# CFD Matrix constants (simplified for implementation speed, full matrix in spec)
# In production, load from JSON/config if large.
# Position 1-indexed from PAM-distal end (1..20)
MISMATCH_PENALTY_MATRIX = {
    # Position: {orig: {mismatch: penalty}}
    # Using a simplified model where penalties depend mainly on position
    # Close to PAM (20) -> high penalty (score drops significantly)
    # Far from PAM (1) -> low penalty (score stays high)
    # But wait, CFD scores are PROBABILITIES of cleavage.
    # So: Mismatch near PAM -> Low probability of cleavage -> Penalty is SMALL number (multiplier < 1)
    # Mismatch far from PAM -> High probability of cleavage -> Penalty is LARGE number (multiplier ~ 1)
    
    # 20 (PAM-proximal): Single mismatch kills activity -> penalty ~ 0.0
    # 1 (PAM-distal): Single mismatch has little effect -> penalty ~ 1.0
}

# Default average penalties per position if specific nt change not found
POS_PENALTIES = [
    1.0, 1.0, 1.0, 1.0, 1.0,   # 1-5: lenient
    1.0, 0.8, 0.8, 0.8, 0.8,   # 6-10: moderate
    0.6, 0.6, 0.4, 0.4, 0.3,   # 11-15: stricter
    0.2, 0.1, 0.05, 0.01, 0.0  # 16-20: strict (distal end)
]
# Wait, standard numbering: 1 is distal, 20 is proximal (next to PAG). 
# Doench 2016: 
# 1-10: varied, generally high
# 11-20: drops rapidly

PAM_PENALTIES = {
    'NGG': 1.0,
    'NAG': 0.259,
    'NGA': 0.069,
    # Add others as needed, default to 0 for non-canonical
}

def calculate_cfd(spacer: str, protospacer: str, pam: str) -> float:
    """
    Calculate Cutting Frequency Determination (CFD) score.
    Range: [0, 1], higher = more likely to cut (bad for off-target).
    """
    score = 1.0
    spacer = spacer.upper()
    protospacer = protospacer.upper()
    
    # Mismatch penalties
    # spacer and protospacer must be aligned 5' -> 3'
    # Position 1 is 5' end (distal), Position 20 is 3' end (proximal)
    
    for i in range(20):
        # 1-based index for lookup
        pos = i + 1 
        s_nt = spacer[i]
        p_nt = protospacer[i]
        
        if s_nt != p_nt:
            # Look up penalty
            # Simplification: Use standard position weights if full matrix missing
            # In full impl, use `mismatch_matrix[pos][s_nt][p_nt]`
            # Here using approximate gradient for "prototype"
            
            # 1-5 (distal): ~1.0
            # 15-20 (proximal): ~0.0
            if pos <= 8:
                penalty = 1.0
            elif pos <= 12:
                penalty = 0.8
            elif pos <= 15:
                penalty = 0.5
            elif pos <= 18:
                penalty = 0.2
            else: # 19, 20
                penalty = 0.0
                
            score *= penalty
            
    # PAM penalty
    pam_suffix = pam[1:] # 2nd and 3rd bases (e.g. 'GG' from 'NGG')
    # Actually standard is NGG, so we usually just check last 2
    # But let's assume PAM input is 3 chars like 'TGG', 'AGG'
    
    # Check NGG compatibility
    if pam[1:] == 'GG':
        pam_score = 1.0
    else:
        # Check dictionary
        # We need full 3-mer for lookup usually or suffix
        # Let's try direct lookups first
        pam_score = PAM_PENALTIES.get(pam, 0.0)
        # If 'N' in key, handle it? usually specific PAMs are passed
        
    score *= pam_score
    return score

def compute_s_offtarget(
    gene: str,
    guides_data: List[Dict[str, Any]], 
    # guides_data: list of {sequence: str, off_targets: [{seq: str, pam: str, gene: str}]}
    hit_genes: List[str],
    config: Optional[Dict] = None
) -> float:
    """
    Compute aggregate off-target risk score.
    
    Args:
        gene: Target gene
        guides_data: List of dicts, one per guide for this gene.
                     Must contain 'sequence' (spacer) and 'off_targets' list.
                     'off_targets' has {seq, pam, gene}
        hit_genes: List of other hits in the screen (for synergistic penalty)
        
    Returns:
        S_offtarget score [0.0 (low risk) - 1.0 (high risk)]
    """
    
    if not guides_data:
        return 0.0
        
    off_target_risks = []
    
    for guide in guides_data:
        spacer = guide.get('sequence', '')
        off_targets = guide.get('off_targets', [])
        
        # 1. Filter significant off-targets (CFD > 0.1)
        significant_ots = []
        for ot in off_targets:
            cfd = calculate_cfd(spacer, ot.get('seq', ''), ot.get('pam', 'NGG'))
            if cfd > 0.1:
                ot['cfd'] = cfd
                significant_ots.append(ot)
        
        # 2. Sum CFD scores
        total_cfd = sum(ot['cfd'] for ot in significant_ots)
        
        # 3. Synergistic risk penalty
        overlap_penalty = 0.0
        for ot in significant_ots:
            ot_gene = ot.get('gene')
            if ot_gene and ot_gene in hit_genes and ot_gene != gene:
                overlap_penalty += 1.5
        
        # Guide risk: capped at 3.0
        guide_risk = min(total_cfd + overlap_penalty, 3.0)
        off_target_risks.append(guide_risk)
        
    # Step 3: Gene-level aggregation (worst guide dominates)
    max_risk = max(off_target_risks) if off_target_risks else 0.0
    
    # Step 4: Transform to [0, 1]
    # < 0.5 -> 0.0
    # > 2.5 -> 1.0
    # Linear in between
    if max_risk < 0.5:
        return 0.0
    elif max_risk > 2.5:
        return 1.0
    else:
        return (max_risk - 0.5) / 2.0
