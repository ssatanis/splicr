"""
S_pathway: Pathway Coherence Score Component
Measures biological coherence given enriched pathways and network context.
"""
import math
import numpy as np
from typing import List, Dict, Any, Optional
from scipy.stats import hypergeom

def compute_s_pathway(
    gene: str,
    hit_genes: List[str],
    ref_manager: Any, # ReferenceDataManager instance
    config: Optional[Dict] = None
) -> float:
    """
    Compute S_pathway score based on enrichment, PPI, and gene sets.
    
    Args:
        gene: Target gene
        hit_genes: List of high-confidence hits from the screen
        ref_manager: Instance of ReferenceDataManager to access loaded data
        config: Optional config
        
    Returns:
        S_pathway score [0.0, 1.0]
    """
    
    # === Component 1: Pathway Enrichment ===
    # Using cached pathways from manager
    # Combine KEGG and Reactome for comprehensive search
    # In production, check config to see which DBs to use
    pathways = ref_manager.get_all_pathways_combined()
    
    # Identify enriched pathways
    # Creating a set for intersection check
    hit_set = set(hit_genes)
    n_hits = len(hit_set)
    N_GENOME = 20000 # Approx protein coding genes
    
    enriched_pathways = []
    
    # Optimization: Only check pathways containing the target gene first?
    # No, we need to know if the gene *belongs* to a pathway that is *enriched* by the screen hits.
    # So we must find enriched pathways first based on ALL hits.
    # This step is expensive if done per-gene. 
    # Ideally, enrichment should be pre-calculated once per screen.
    # For this function's isolation, we will do a simplified check:
    # Check only pathways containing THIS gene.
    
    gene_pathways = []
    for pid, pdata in pathways.items():
        if gene in pdata.get('genes', []):
            gene_pathways.append((pid, pdata['genes']))
            
    # Calculate enrichment ONLY for pathways this gene is in
    pathway_membership_score = 0.0
    
    for pid, p_genes in gene_pathways:
        # Hypergeometric Test
        # k: hits in pathway
        # K: pathway size
        # n: total hits
        # N: total genome
        
        pathway_gene_set = set(p_genes)
        k = len(hit_set.intersection(pathway_gene_set))
        K = len(pathway_gene_set)
        
        # Calculate p-value (survival function = 1 - cdf)
        # hypergeom.sf(k-1, N, K, n)
        p_val = hypergeom.sf(k-1, N_GENOME, K, n_hits)
        
        if p_val < 0.05: # Loose threshold for component score
            # Weight by significance
            # -log10(p)
            log_p = -math.log10(p_val) if p_val > 1e-10 else 10.0
            pathway_membership_score += min(log_p, 10.0)
            
    # Normalize membership (empirically 3 strong pathways -> 1.0)
    # Using a scaling factor, say max score around 15-20 sum
    # Let's say if score > 3.0 (i.e. one p<0.001 path), that's good.
    # Spec says: "min(pathway_membership / 3.0, 1.0)" (where membership is sum of weights)
    # Wait, spec says "min(-log10(p), 10)" per pathway. 
    # So 3 highly significant pathways => score 30? No, normalized by 3.0?
    # "min(pathway_membership / 3.0, 1.0)" -> means if membership sum is > 3, score is 1.
    # So just having one p=0.001 pathway (score=3) gives full marks??
    # That seems generous but let's follow spec or reasonable interpretation.
    # Let's use 10.0 as divisor if log_p can be 10.
    # Actually, usually enrichment scores are aggregated. 
    # Let's stick to spec: "min(sum / 3.0, 1.0)" 
    # This implies one strong pathway is enough to saturate this sub-score.
    pathway_score = min(pathway_membership_score / 3.0, 1.0)
    
    
    # === Component 2: PPI Network Centrality ===
    # Load STRING graph
    G = ref_manager.load_string_network()
    
    network_score = 0.0
    if gene in G:
        # Check neighbors effectively
        # We want to know if neighbors are also hits
        neighbors = set(G.neighbors(gene))
        hit_neighbors = neighbors.intersection(hit_set)
        
        if hit_neighbors:
            # Sum of confidence scores
            weighted_degree = 0
            for neighbor in hit_neighbors:
                # Edge weight is 'combined_score' (0-1000)
                # Normalize to 0-1
                w = G[gene][neighbor].get('combined_score', 0) / 1000.0
                weighted_degree += w
                
            # Normalize (empirically 5+ high conf neighbors is strong)
            network_score = min(weighted_degree / 5.0, 1.0)
            
            
    # === Component 3: Gene Set Membership ===
    # Check BAGEL2 essentials etc.
    bagel_essentials = ref_manager.load_bagel_essentials()
    # Others can be added (COSMIC etc.)
    
    gene_set_score = 0.0
    if gene in bagel_essentials:
        gene_set_score += 0.3
        
    # Placeholder for other sets
    # if gene in cancer_drivers: gene_set_score += 0.3
    
    gene_set_score = min(gene_set_score, 1.0)
    
    # === Final Combination ===
    # Weights: 50% Pathway, 30% Network, 20% Prior
    s_pathway = (
        0.50 * pathway_score +
        0.30 * network_score +
        0.20 * gene_set_score
    )
    
    return max(0.0, min(1.0, s_pathway))
