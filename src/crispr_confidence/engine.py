"""
CRISPR Confidence Score Engine.
Orchestrates data loading and scoring.
"""
import pandas as pd
import numpy as np
from typing import Dict, List, Any, Optional
from pathlib import Path
import logging

from .scores import (
    calculate_sgRNA_score,
    calculate_offtarget_score,
    calculate_reproducibility_score,
    calculate_pathway_score,
    calculate_ml_score,
    calculate_ccs
)
from .config import get_config
# from .storage import get_storage # Will use later for remote fetching

logger = logging.getLogger(__name__)

class CRISPRConfidenceScorer:
    def __init__(self):
        self.config = get_config()
        self.reference_data = {}
        # Placeholder for loading reference data (PPI, Pathways, etc.)
        # In a real impl, we'd load these here or lazy-load them.
        self._load_references()

    def _load_references(self):
        """
        Load reference datasets (PPI, Pathways).
        Currently just logs placeholders.
        """
        logger.info("Loading reference data for CCS...")
        # self.ppi_network = ...
        # self.pathways = ...
        pass

    def score_screen(self, screen_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Score an entire screen.
        
        Args:
            screen_data: Dictionary containing:
                - 'gene_data': List of dicts with gene-level info (beta, fdr, etc.)
                - 'guide_data': Dict mapping gene_id -> list of LFCs
                - 'replicate_data': Dict mapping gene_id -> list of LFCs from replicates
                
        Returns:
            List of CCS results for each gene, sorted by score.
        """
        results = []
        
        # Extract data parts
        gene_items = screen_data.get('gene_data', [])
        guide_map = screen_data.get('guide_data', {})
        replicate_map = screen_data.get('replicate_data', {})
        
        logger.info(f"Starting CCS calculation for {len(gene_items)} genes.")
        
        for item in gene_items:
            gene_id = item.get('gene_id')
            if not gene_id:
                continue
                
            # --- 1. sgRNA Score ---
            # Get LFCs for this gene's guides
            guides_lfc = guide_map.get(gene_id, [])
            if not guides_lfc and 'lfc' in item:
                # Fallback if guide data missing but gene has aggregate LFC
                # Treat as single "guide" which is bad practice but handles edge case
                guides_lfc = [item['lfc']]
                
            s_sgrna_res = calculate_sgRNA_score(guides_lfc)
            
            # --- 2. Off-Target Score ---
            # Ideally we have spacers. Here we assume pre-calculated risk or 0
            max_risk = item.get('max_offtarget_risk', 0.0)
            s_offtarget_res = calculate_offtarget_score([], max_risk_score=max_risk)
            
            # --- 3. Reproducibility Score ---
            # Get replicate LFCs
            reps_lfc = replicate_map.get(gene_id, [])
            s_repro_res = calculate_reproducibility_score(reps_lfc)
            
            # --- 4. Pathway Score ---
            # Logic: We'd check if gene is in enriched pathways.
            # Mock for now:
            s_pathway_res = calculate_pathway_score(gene_id, [], [])
            
            # --- 5. ML / Heuristic Score ---
            s_ml_res = calculate_ml_score(
                beta_score=item.get('beta_score', 0.0),
                fdr=item.get('fdr', 1.0),
                s_sgrna=s_sgrna_res['score'],
                s_offtarget=s_offtarget_res['score']
            )
            
            # --- Final Aggregation ---
            component_scores = {
                'S_sgRNA': s_sgrna_res['score'],
                'S_offtarget': s_offtarget_res['score'],
                'S_repro': s_repro_res['score'],
                'S_pathway': s_pathway_res['score'],
                'S_ML': s_ml_res['score']
            }
            
            ccs_result = calculate_ccs(gene_id, component_scores)
            
            # Attach individual component details if needed for debugging
            ccs_result['details'] = {
                'sgRNA': s_sgrna_res,
                'repro': s_repro_res
            }
            
            results.append(ccs_result)
            
        # Sort by final score
        results.sort(key=lambda x: x['score'], reverse=True)
            
        return results

# Singleton instance
_scorer = None

def get_scorer() -> CRISPRConfidenceScorer:
    global _scorer
    if _scorer is None:
        _scorer = CRISPRConfidenceScorer()
    return _scorer
