import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Dict, Any, Optional
import logging

from ..config import get_config
from ..storage import get_storage

logger = logging.getLogger(__name__)

class ModelLoader:
    def __init__(self):
        self.config = get_config()
        self.storage = get_storage()
        self.model_path = Path(self.config['paths']['models']) / "validation_predictor.pkl"
        self.model = None
        self.load_model()

    def load_model(self):
        """
        Load the trained model from disk or download from storage.
        """
        if not self.model_path.exists():
            logger.info(f"Model not found at {self.model_path}, attempting download...")
            try:
                 self.storage.download_file("models/validation_predictor.pkl", self.model_path)
            except Exception as e:
                logger.warning(f"Could not download model: {e}")
        
        if self.model_path.exists():
            try:
                self.model = joblib.load(self.model_path)
                logger.info("ML Model loaded successfully.")
            except Exception as e:
                logger.error(f"Failed to load model from disk: {e}")
        else:
            logger.warning("No ML model available. Using heuristic scoring.")

    def predict(self, features: Dict[str, float]) -> float:
        """
        Predict validation likelihood using model or heuristic.
        """
        if self.model:
            try:
                # Prepare feature vector (ensure order matches training)
                # Need to match the columns used in training.
                # For now, we assume features dict keys match training columns.
                # In a real scenario, we'd enforce order.
                
                # List of features expected by the model (same as in trainer)
                expected_features = [
                    'beta_score', 'fdr', 'bayes_factor', 'neg_log_fdr',
                    'n_guides', 'guide_concordance', 'mean_guide_activity',
                    'max_cfd', 'n_offtargets',
                    'replicate_correlation', 'wbc_zscore',
                    'n_enriched_pathways', 'ppi_degree', 'pathway_centrality',
                    'gene_expression_tpm', 'is_core_essential', 'depmap_score',
                    'n_pubmed_mentions', 'n_pubmed_disease'
                ]
                
                feature_vector = []
                for feat in expected_features:
                    feature_vector.append(features.get(feat, 0.0))
                
                start_prob = self.model.predict_proba([feature_vector])[0, 1]
                return float(start_prob)
            except Exception as e:
                logger.error(f"Prediction failed: {e}. Falling back to heuristic.")
        
        return self.heuristic_score(features)

    def heuristic_score(self, features: Dict[str, float]) -> float:
        """
        Heuristic validation likelihood (before ML model trained)
        """
        score = 0.5  # Neutral baseline
        
        # Strong effect size
        if abs(features.get('beta_score', 0)) > 1.0: # Spec said > 2.0 but 1.0 is also reasonable, sticking to spec
             if abs(features.get('beta_score', 0)) > 2.0:
                 score += 0.15
        
        # High significance
        if features.get('fdr', 1.0) < 0.01:
            score += 0.10
        
        # Good guide concordance
        if features.get('guide_concordance', 1.0) < 0.4:
            score += 0.10
        
        # Low off-target risk -> using max_cfd
        if features.get('max_cfd', 0) < 0.5:
            score += 0.10
        
        # Pathway support
        if features.get('n_enriched_pathways', 0) > 0:
            score += 0.05
        
        # Cap at 1.0
        return min(score, 1.0)

