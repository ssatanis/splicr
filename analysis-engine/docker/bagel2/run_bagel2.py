#!/usr/bin/env python3
"""
BAGEL2 Analysis Script for SplicR
Runs BAGEL2 for essential gene prediction
"""

import argparse
import subprocess
import boto3
import sys
from pathlib import Path
import pandas as pd
import numpy as np
import logging
from progress_reporter import ProgressReporter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class BAGEL2Analysis:
    """BAGEL2 essential gene prediction"""
    
    def __init__(self, s3_bucket, analysis_id, region='us-east-1'):
        self.s3 = boto3.client('s3', region_name=region)
        self.bucket = s3_bucket
        self.analysis_id = analysis_id
        self.work_dir = Path('/analysis/work')
        self.work_dir.mkdir(exist_ok=True, parents=True)
        self.bagel_dir = Path('/bagel2')
        self.progress = ProgressReporter(analysis_id)
    
    def download_count_matrix(self, s3_key):
        """Download count matrix from previous MAGeCK run"""
        logger.info(f"Downloading count matrix: {s3_key}")
        self.progress.update(10, "Downloading count matrix")
        
        local_path = self.work_dir / "counts.txt"
        
        try:
            self.s3.download_file(self.bucket, s3_key, str(local_path))
            return local_path
        except Exception as e:
            logger.error(f"Failed to download count matrix: {str(e)}")
            raise
    
    def calculate_fold_changes(self, count_file, treatment_cols, control_cols):
        """Calculate fold changes"""
        logger.info("Calculating fold changes...")
        self.progress.update(25, "Calculating fold changes")
        
        df = pd.read_csv(count_file, sep='\t')
        
        # Calculate mean counts
        df['treatment_mean'] = df[treatment_cols].mean(axis=1)
        df['control_mean'] = df[control_cols].mean(axis=1)
        
        # Calculate log2 fold change with pseudocount
        pseudocount = 1
        df['log2fc'] = np.log2(
            (df['treatment_mean'] + pseudocount) / (df['control_mean'] + pseudocount)
        )
        
        # Save fold changes
        fc_file = self.work_dir / 'fold_changes.txt'
        df[['Gene', 'log2fc']].to_csv(fc_file, sep='\t', index=False, header=False)
        
        self.progress.update(40, "Fold changes calculated")
        return fc_file
    
    def run_bagel(self, fc_file, essentials_file, nonessentials_file):
        """Run BAGEL2 classifier"""
        logger.info("Running BAGEL2...")
        self.progress.update(50, "Running BAGEL2 classifier")
        
        cmd = [
            'python', str(self.bagel_dir / 'BAGEL.py'),
            'fc',
            '-i', str(fc_file),
            '-o', str(self.work_dir / 'bagel_output'),
            '-e', essentials_file,
            '-n', nonessentials_file,
            '-c', '1,2'  # Columns with gene and fold change
        ]
        
        logger.info(f"Command: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            logger.info("BAGEL2 completed successfully")
            logger.debug(f"STDOUT: {result.stdout}")
            
            self.progress.update(75, "BAGEL2 complete")
            
            return self.work_dir / 'bagel_output.bf'
            
        except subprocess.CalledProcessError as e:
            logger.error(f"BAGEL2 failed: {e.stderr}")
            raise Exception(f"BAGEL2 failed: {e.stderr}")
    
    def parse_results(self, bf_file):
        """Parse BAGEL2 Bayes Factor results"""
        logger.info("Parsing BAGEL2 results...")
        
        df = pd.read_csv(bf_file, sep='\t')
        
        # Calculate statistics
        stats = {
            'total_genes': len(df),
            'essential_genes': len(df[df['BF'] > 5]),  # BF > 5 threshold
            'high_confidence_essential': len(df[df['BF'] > 10]),
            'top_essential': df.nlargest(20, 'BF')[['GENE', 'BF']].to_dict('records')
        }
        
        logger.info(f"Found {stats['essential_genes']} essential genes (BF > 5)")
        
        return stats
    
    def upload_results(self):
        """Upload results to S3"""
        logger.info("Uploading results to S3...")
        self.progress.update(85, "Uploading results")
        
        results_prefix = f"results/{self.analysis_id}/bagel2/"
        
        uploaded = 0
        for file_path in self.work_dir.glob('*'):
            if file_path.is_file():
                s3_key = f"{results_prefix}{file_path.name}"
                logger.info(f"Uploading {file_path.name}")
                
                try:
                    self.s3.upload_file(str(file_path), self.bucket, s3_key)
                    uploaded += 1
                except Exception as e:
                    logger.error(f"Failed to upload {file_path.name}: {str(e)}")
        
        logger.info(f"Uploaded {uploaded} files to S3")
        self.progress.update(95, "Upload complete")
        
        return results_prefix


def main():
    parser = argparse.ArgumentParser(description='Run BAGEL2 essential gene prediction')
    parser.add_argument('--analysis-id', required=True)
    parser.add_argument('--count-matrix', required=True, help='S3 key for count matrix')
    parser.add_argument('--s3-bucket', required=True)
    parser.add_argument('--treatment', required=True)
    parser.add_argument('--control', required=True)
    parser.add_argument('--essentials', required=True, help='Essential genes reference')
    parser.add_argument('--nonessentials', required=True, help='Non-essential genes reference')
    parser.add_argument('--region', default='us-east-1')
    
    args = parser.parse_args()
    
    logger.info("="*60)
    logger.info("SplicR BAGEL2 Analysis")
    logger.info("="*60)
    
    treatment_cols = args.treatment.split(',')
    control_cols = args.control.split(',')
    
    try:
        analyzer = BAGEL2Analysis(args.s3_bucket, args.analysis_id, args.region)
        
        logger.info("\nStep 1/4: Downloading count matrix...")
        count_file = analyzer.download_count_matrix(args.count_matrix)
        
        logger.info("\nStep 2/4: Calculating fold changes...")
        fc_file = analyzer.calculate_fold_changes(count_file, treatment_cols, control_cols)
        
        logger.info("\nStep 3/4: Running BAGEL2...")
        bf_file = analyzer.run_bagel(fc_file, args.essentials, args.nonessentials)
        
        logger.info("\nStep 4/4: Uploading results...")
        stats = analyzer.parse_results(bf_file)
        results_prefix = analyzer.upload_results()
        
        analyzer.progress.update(100, "BAGEL2 complete")
        
        logger.info("\n" + "="*60)
        logger.info("✓ BAGEL2 analysis completed!")
        logger.info(f"Results: s3://{args.s3_bucket}/{results_prefix}")
        logger.info("="*60)
        
        return 0
        
    except Exception as e:
        logger.error(f"\n✗ BAGEL2 failed: {str(e)}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
