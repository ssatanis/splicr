import numpy as np
from typing import Dict, Any
import logging
from .ml.model_loader import ModelLoader

logger = logging.getLogger(__name__)

class CRISPRConfidenceScorer:
    def __init__(self):
        self.model_loader = ModelLoader()
        # Define weights
        self.weights = {
            'w1': 0.25, # sgRNA concordance
            'w2': 0.25, # Reproducibility
            'w3': 0.15, # Pathway coherence
            'w4': 0.15, # ML validation likelihood
            'w5': 0.20  # Off-target risk (negative)
        }

    def calculate_S_sgRNA(self, features: Dict[str, float]) -> float:
        """
        Calculate S_sgRNA based on guide concordance and count.
        """
        cv = features.get('guide_cv', 0.0)
        n_guides = features.get('n_guides', 0)
        
        # Step 3: Penalize low guide count
        guide_penalty = min(n_guides / 4.0, 1.0)
        
        # Step 4: Transform CV to concordance score
        if cv < 0.3:
            concordance_raw = 1.0
        elif cv > 1.5:
            concordance_raw = 0.0
        else:
            concordance_raw = 1.0 - ((cv - 0.3) / 1.2)
            
        return concordance_raw * guide_penalty

    def calculate_S_offtarget(self, features: Dict[str, float]) -> float:
        """
        Calculate S_offtarget based on max CFD score.
        """
        max_risk = features.get('max_cfd', 0.0)
        
        if max_risk < 0.5:
            return 0.0
        elif max_risk > 2.5:
            return 1.0
        else:
            return (max_risk - 0.5) / 2.0

    def calculate_S_repro(self, features: Dict[str, float]) -> float:
        """
        Calculate S_repro based on replicate correlation / WBC.
        """
        # Simplified using replicate_correlation if WBC not available
        repro_metric = features.get('replicate_correlation', 0.0) 
        # Or wbc_zscore if available and processed
        
        # Assuming metric is [0,1] correlation for now or similar 
        # Spec has complex WBC. We start with simple linear mapping of correlation
        # If correlation > 0.8 -> 1.0, < 0.0 -> 0.0
        
        score = max(0.0, min(1.0, repro_metric))
        return score

    def calculate_S_pathway(self, features: Dict[str, float]) -> float:
        """
        Calculate S_pathway based on enrichment and network.
        """
        # Simplified based on features
        n_enriched = features.get('n_enriched_pathways', 0)
        ppi_degree = features.get('ppi_degree', 0)
        
        # Normalize (empirically: 3+ enriched pathways is strong)
        pathway_score = min(n_enriched / 3.0, 1.0)
        
        # Normalize (empirically: 5+ high-confidence connections is strong)
        network_score = min(ppi_degree / 5.0, 1.0)
        
        # Combine (approximate standard weights from spec)
        return 0.6 * pathway_score + 0.4 * network_score

    def score_gene(self, features: Dict[str, float]) -> Dict[str, Any]:
        """
        Calculate the final CRISPR Confidence Score for a gene.
        """
        S_sgRNA = self.calculate_S_sgRNA(features)
        S_offtarget = self.calculate_S_offtarget(features)
        S_repro = self.calculate_S_repro(features)
        S_pathway = self.calculate_S_pathway(features)
        
        # ML Score
        S_ML = self.model_loader.predict(features)
        
        # Final CCS
        CCS_raw = (
            self.weights['w1'] * S_sgRNA +
            self.weights['w2'] * S_repro +
            self.weights['w3'] * S_pathway +
            self.weights['w4'] * S_ML -
            self.weights['w5'] * S_offtarget
        )
        
        CCS_raw = max(0.0, min(1.0, CCS_raw))
        CCS_final = CCS_raw * 100.0
        
        # Tier
        if CCS_final >= 90:
            tier = "High Confidence"
        elif CCS_final >= 70:
            tier = "Good Candidate"
        elif CCS_final >= 50:
            tier = "Medium Risk"
        else:
            tier = "High Risk"
            
        return {
            'score': round(CCS_final, 1),
            'tier': tier,
            'components': {
                'S_sgRNA': round(S_sgRNA, 2),
                'S_offtarget': round(S_offtarget, 2),
                'S_repro': round(S_repro, 2),
                'S_pathway': round(S_pathway, 2),
                'S_ML': round(S_ML, 2)
            }
        }
