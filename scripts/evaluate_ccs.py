import argparse
import pandas as pd
import numpy as np
import json
import logging
from pathlib import Path
from sklearn.metrics import roc_auc_score, average_precision_score, precision_recall_curve

import sys
import os

# Ensure src is in path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.crispr_confidence.ml.feature_extraction import FeatureExtractor
from src.crispr_confidence.scoring import CRISPRConfidenceScorer
from src.crispr_confidence.config import get_config
from src.crispr_confidence.storage import get_storage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def evaluate_ccs(input_file: str, output_file: str):
    """
    Run CCS on a set of historical screens (or a file with features/results) and validate.
    """
    config = get_config()
    storage = get_storage()
    
    # Load input data
    input_path = Path(input_file)
    if not input_path.exists():
        # Try to download from storage if not local
        try:
             # Assume input_file is a key in storage if not a local path
             logger.info(f"Downloading {input_file} from storage...")
             local_path = Path(config['paths']['data']) / input_file
             storage.download_file(f"processed/{input_file}", local_path)
             input_path = local_path
        except Exception as e:
            logger.error(f"Could not load input file: {e}")
            return

    logger.info(f"Loading data from {input_path}...")
    try:
        if input_path.suffix == '.parquet':
            df = pd.read_parquet(input_path)
        else:
            df = pd.read_csv(input_path)
    except Exception as e:
        logger.error(f"Failed to read data: {e}")
        return

    # Check for ground truth column
    if 'validated' not in df.columns:
        logger.warning("No 'validated' column found. Cannot compute validation metrics. Will only calc scores.")
        validate = False
    else:
        validate = True

    # Initialize Scorer
    scorer = CRISPRConfidenceScorer()
    # extractor = FeatureExtractor() # Not needed if input already has features, but if raw screen data, we need it.
    
    # Check if we have features or need to extract
    # For simplicity, assume input is a "features" dataframe or "results" dataframe with necessary cols
    # If using FeatureExtractor, we'd loop through genes.
    
    results = []
    
    for idx, row in df.iterrows():
        # Convert row to dict for scoring
        features = row.to_dict()
        
        # Calculate CCS
        score_data = scorer.score_gene(features)
        
        result_row = {
            'gene': row.get('gene', f"Gene_{idx}"),
            'CCS': score_data['score'],
            'Tier': score_data['tier'],
            'S_ML': score_data['components']['S_ML'],
            'validated': row.get('validated', None)
        }
        results.append(result_row)

    results_df = pd.read_json(json.dumps(results)) # simplest way to df
    
    # Save results
    results_path = Path(output_file)
    results_path.parent.mkdir(parents=True, exist_ok=True)
    results_df.to_csv(results_path, index=False)
    logger.info(f"Saved scored results to {results_path}")

    # Compute Metrics if validated
    if validate:
        clean_df = results_df.dropna(subset=['validated'])
        if len(clean_df) > 0:
            y_true = clean_df['validated'].astype(int)
            y_score = clean_df['CCS'] / 100.0 # Scale back to [0,1] for AUC
            
            try:
                auc_roc = roc_auc_score(y_true, y_score)
                auc_pr = average_precision_score(y_true, y_score)
                
                # Calibration / Precision@K
                # Precision at top 10%
                k = int(len(clean_df) * 0.1)
                top_k = clean_df.nlargest(k, 'CCS')
                precision_at_k = top_k['validated'].mean()
                
                metrics = {
                    'AUC_ROC': round(auc_roc, 3),
                    'AUC_PR': round(auc_pr, 3),
                    'Precision@10%': round(precision_at_k, 3),
                    'N_Validate': len(clean_df)
                }
                
                print("\nValidation Metrics:")
                print(json.dumps(metrics, indent=2))
                
                # Save metrics
                metrics_path = Path("reports/ccs_validation_summary.json")
                metrics_path.parent.mkdir(parents=True, exist_ok=True)
                with open(metrics_path, 'w') as f:
                    json.dump(metrics, f, indent=2)
                
                # storage.upload_file(metrics_path, "reports/ccs_validation_summary.json")

            except Exception as e:
                logger.error(f"Error computing metrics: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate CCS on a dataset")
    parser.add_argument("--input", "-i", required=True, help="Input file (CSV/Parquet) with features and validation status")
    parser.add_argument("--output", "-o", default="reports/ccs_scores.csv", help="Output file for scores")
    
    args = parser.parse_args()
    evaluate_ccs(args.input, args.output)
