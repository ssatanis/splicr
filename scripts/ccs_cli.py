import argparse
import sys
import subprocess
import logging
from pathlib import Path
import pandas as pd
import json

# Ensure src is in path (script now in scripts/ so we need parent.parent)
sys.path.append(str(Path(__file__).resolve().parent.parent))

from src.crispr_confidence.ml.feature_extraction import FeatureExtractor
from src.crispr_confidence.scoring import CRISPRConfidenceScorer
from src.crispr_confidence.config import get_config
from src.crispr_confidence.storage import get_storage
# from src.crispr_confidence.ml.train_validation_model import ValidationModelTrainer

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def bootstrap():
    """Run the bootstrap script."""
    logger.info("Running bootstrap environment script...")
    script_path = "scripts/bootstrap_environment.py"
    if not Path(script_path).exists():
        logger.error(f"Bootstrap script not found at {script_path}")
        sys.exit(1)
    
    subprocess.run([sys.executable, script_path], check=True)

def score_screen(screen_id, input_file, output_dir):
    """Run CCS pipeline on a screen."""
    logger.info(f"Scoring screen {screen_id}...")
    
    config = get_config()
    storage = get_storage()
    
    # Load input
    input_path = Path(input_file)
    if not input_path.exists():
        logger.error(f"Input file not found: {input_path}")
        sys.exit(1)
        
    try:
        if input_path.suffix == '.parquet':
            df = pd.read_parquet(input_path)
        else:
            df = pd.read_csv(input_path)
        logger.info(f"Loaded {len(df)} genes from {input_path}")
    except Exception as e:
        logger.error(f"Failed to load input: {e}")
        sys.exit(1)
        
    # 1. Feature Extraction
    logger.info("Extracting features...")
    extractor = FeatureExtractor()
    # Assuming df contains raw screen results. 
    # If df already contains features (e.g. from previous run), we might skip or re-extract
    # For now, we assume we need to process it.
    feature_df = extractor.process_screen(screen_id, df, output_dir=Path(output_dir) if output_dir else None)
    
    # 2. Scoring
    logger.info("Calculating CRISPR Confidence Scores...")
    scorer = CRISPRConfidenceScorer()
    
    results = []
    for idx, row in feature_df.iterrows():
        features = row.to_dict()
        score_data = scorer.score_gene(features)
        
        result_row = {
            'gene': row.get('gene', f"Gene_{idx}"),
            'CCS': score_data['score'],
            'Tier': score_data['tier'],
            'Recommendation': score_data.get('recommendation', ''), # recommendation logic was in spec but not implemented in scorer return dict, adding TODO
            **score_data['components']
        }
        # Add back original data if needed
        # result_row.update(features) 
        results.append(result_row)
        
    results_df = pd.DataFrame(results)
    results_df = results_df.sort_values('CCS', ascending=False)
    
    # Save
    out_path = Path(output_dir) / f"{screen_id}_ccs_results.csv"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    results_df.to_csv(out_path, index=False)
    logger.info(f"Saved results to {out_path}")
    
    # Upload
    try:
        pass
        # storage.upload_file(out_path, f"processed/ccs_results/{screen_id}.csv")
    except Exception:
        pass

def train_ml():
    """Train the validation model."""
    logger.info("Starting ML training...")
    from src.crispr_confidence.ml.train_validation_model import ValidationModelTrainer
    trainer = ValidationModelTrainer()
    trainer.train()

def validate_ccs(input_file):
    """Run validation suite."""
    logger.info("Running validation suite...")
    cmd = [sys.executable, "scripts/evaluate_ccs.py", "--input", input_file]
    subprocess.run(cmd, check=True)

def main():
    parser = argparse.ArgumentParser(description="CRISPR Confidence Score CLI")
    subparsers = parser.add_subparsers(dest="command", help="Command to run")
    
    # Bootstrap
    subparsers.add_parser("bootstrap", help="Run bootstrap script")
    
    # Score Screen
    score_parser = subparsers.add_parser("score-screen", help="Run CCS on a screen")
    score_parser.add_argument("--screen-id", required=True, help="ID of the screen")
    score_parser.add_argument("--input", required=True, help="Input file (CSV/Parquet) with screen results")
    score_parser.add_argument("--output-dir", default="data/processed/ccs_results", help="Output directory")
    # score_parser.add_argument("--config", help="Path to config.yaml (optional)") # Config is loaded via get_config mostly
    
    # Train ML
    subparsers.add_parser("train-ml", help="Train S_ML model")
    
    # Validate
    val_parser = subparsers.add_parser("validate-ccs", help="Run validation")
    val_parser.add_argument("--input", required=True, help="Input file for validation")

    args = parser.parse_args()
    
    if args.command == "bootstrap":
        bootstrap()
    elif args.command == "score-screen":
        score_screen(args.screen_id, args.input, args.output_dir)
    elif args.command == "train-ml":
        train_ml()
    elif args.command == "validate-ccs":
        validate_ccs(args.input)
    else:
        parser.print_help()

if __name__ == "__main__":
    main()
