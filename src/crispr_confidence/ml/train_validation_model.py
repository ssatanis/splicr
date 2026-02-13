import pandas as pd
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold, train_test_split
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import roc_auc_score, average_precision_score, classification_report
import joblib
from pathlib import Path
import logging
import os

from ..config import get_config
from ..storage import get_storage

logger = logging.getLogger(__name__)

# Feature columns expected by the model
FEATURE_COLUMNS = [
    'beta_score', 'fdr', 'bayes_factor', 'neg_log_fdr',
    'n_guides', 'guide_concordance', 'mean_guide_activity',
    'max_cfd', 'n_offtargets',
    'replicate_correlation', 'wbc_zscore',
    'n_enriched_pathways', 'ppi_degree', 'pathway_centrality',
    'gene_expression_tpm', 'is_core_essential', 'depmap_score',
    'n_pubmed_mentions', 'n_pubmed_disease'
]

class ValidationModelTrainer:
    def __init__(self):
        self.config = get_config()
        self.storage = get_storage()
        self.model_path = Path(self.config['paths']['models']) / "validation_predictor.pkl"
        self.data_path = Path(self.config['paths']['processed']) / "labeled_validation_data.csv"

    def load_data(self):
        """
        Load labeled training data.
        Expected columns: feature columns + 'validated' (bool/int)
        """
        if not self.data_path.exists():
            # Try to download from storage
            try:
                self.storage.download_file("processed/labeled_validation_data.csv", self.data_path)
            except Exception as e:
                logger.warning(f"Could not load labeled data from {self.data_path} or storage: {e}")
                return None, None

        df = pd.read_csv(self.data_path)
        
        # Check for missing columns and fill with defaults
        for col in FEATURE_COLUMNS:
            if col not in df.columns:
                df[col] = 0.0
        
        X = df[FEATURE_COLUMNS]
        y = df['validated'].astype(int)
        
        return X, y

    def train(self):
        """Train and calibrate the model."""
        X, y = self.load_data()
        if X is None:
            logger.error("No training data available. Aborting training.")
            return

        logger.info(f"Training on {len(X)} samples...")

        # Split
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, stratify=y, random_state=42
        )

        # Base Model
        base_model = GradientBoostingClassifier(
            n_estimators=100,
            max_depth=5,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42
        )

        # Calibrated Model (Sigmoid / Platt Scaling)
        model = CalibratedClassifierCV(base_model, method='sigmoid', cv=5)
        model.fit(X_train, y_train)

        # Evaluate
        y_prob = model.predict_proba(X_test)[:, 1]
        auc = roc_auc_score(y_test, y_prob)
        auprc = average_precision_score(y_test, y_prob)
        
        logger.info(f"Test AUC: {auc:.3f}")
        logger.info(f"Test AUPRC: {auprc:.3f}")

        # Save model
        self.model_path.parent.mkdir(parents=True, exist_ok=True)
        joblib.dump(model, self.model_path)
        logger.info(f"Saved model to {self.model_path}")

        # Upload to storage
        try:
             self.storage.upload_file(self.model_path, "models/validation_predictor.pkl")
             logger.info("Uploaded model to storage.")
        except Exception as e:
            logger.error(f"Failed to upload model: {e}")

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    trainer = ValidationModelTrainer()
    trainer.train()
