#!/usr/bin/env python3
"""
DrugZ Analysis Script for SplicR
Runs DrugZ for CRISPR screen analysis with improved statistics
"""

import argparse
import subprocess
import boto3
import sys
from pathlib import Path
import pandas as pd
import logging
from progress_reporter import ProgressReporter

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DrugZAnalysis:
    """DrugZ CRISPR screen analysis"""
    
    def __init__(self, s3_bucket, analysis_id, region='us-east-1'):
        self.s3 = boto3.client('s3', region_name=region)
        self.bucket = s3_bucket
        self.analysis_id = analysis_id
        self.work_dir = Path('/analysis/work')
        self.work_dir.mkdir(exist_ok=True, parents=True)
        self.drugz_script = Path('/drugz/drugz.py')
        self.progress = ProgressReporter(analysis_id)
    
    def download_count_file(self, s3_key):
        """Download count file from S3"""
        logger.info(f"Downloading count file: {s3_key}")
        self.progress.update(10, "Downloading count file")
        
        local_path = self.work_dir / "counts.txt"
        
        try:
            self.s3.download_file(self.bucket, s3_key, str(local_path))
            return local_path
        except Exception as e:
            logger.error(f"Failed to download count file: {str(e)}")
            raise
    
    def run_drugz(self, count_file, treatment_cols, control_cols):
        """Run DrugZ analysis"""
        logger.info("Running DrugZ...")
        self.progress.update(30, "Running DrugZ analysis")
        
        # Prepare column indices (DrugZ uses column indices)
        treatment_indices = ','.join(str(i) for i in treatment_cols)
        control_indices = ','.join(str(i) for i in control_cols)
        
        output_file = self.work_dir / 'drugz_output.txt'
        
        cmd = [
            'python', str(self.drugz_script),
            '-i', str(count_file),
            '-o', str(output_file),
            '-c', control_indices,
            '-x', treatment_indices,
            '--remove_genes', 'NO_CURRENT',
            '--half_window_size', '500',
            '--pseudocount', '5'
        ]
        
        logger.info(f"Command: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True
            )
            
            logger.info("DrugZ completed successfully")
            logger.debug(f"STDOUT: {result.stdout}")
            
            self.progress.update(70, "DrugZ complete")
            
            return output_file
            
        except subprocess.CalledProcessError as e:
            logger.error(f"DrugZ failed: {e.stderr}")
            raise Exception(f"DrugZ failed: {e.stderr}")
    
    def parse_results(self, drugz_file):
        """Parse DrugZ results"""
        logger.info("Parsing DrugZ results...")
        
        df = pd.read_csv(drugz_file, sep='\t')
        
        stats = {
            'total_genes': len(df),
            'significant_genes_005': len(df[df['fdr'] < 0.05]),
            'significant_genes_01': len(df[df['fdr'] < 0.1]),
            'top_depleted': df.nsmallest(10, 'normZ')[['GENE', 'normZ', 'fdr']].to_dict('records'),
            'top_enriched': df.nlargest(10, 'normZ')[['GENE', 'normZ', 'fdr']].to_dict('records')
        }
        
        logger.info(f"Found {stats['significant_genes_005']} significant genes (FDR < 0.05)")
        
        return stats
    
    def upload_results(self):
        """Upload results to S3"""
        logger.info("Uploading results to S3...")
        self.progress.update(85, "Uploading results")
        
        results_prefix = f"results/{self.analysis_id}/drugz/"
        
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
        
        logger.info(f"Uploaded {uploaded} files")
        self.progress.update(95, "Upload complete")
        
        return results_prefix


def main():
    parser = argparse.ArgumentParser(description='Run DrugZ CRISPR screen analysis')
    parser.add_argument('--analysis-id', required=True)
    parser.add_argument('--count-file', required=True, help='S3 key for count file')
    parser.add_argument('--s3-bucket', required=True)
    parser.add_argument('--treatment-cols', required=True, help='Comma-separated treatment column indices')
    parser.add_argument('--control-cols', required=True, help='Comma-separated control column indices')
    parser.add_argument('--region', default='us-east-1')
    
    args = parser.parse_args()
    
    logger.info("="*60)
    logger.info("SplicR DrugZ Analysis")
    logger.info("="*60)
    
    treatment_cols = [int(x) for x in args.treatment_cols.split(',')]
    control_cols = [int(x) for x in args.control_cols.split(',')]
    
    try:
        analyzer = DrugZAnalysis(args.s3_bucket, args.analysis_id, args.region)
        
        logger.info("\nStep 1/3: Downloading count file...")
        count_file = analyzer.download_count_file(args.count_file)
        
        logger.info("\nStep 2/3: Running DrugZ...")
        drugz_file = analyzer.run_drugz(count_file, treatment_cols, control_cols)
        
        logger.info("\nStep 3/3: Uploading results...")
        stats = analyzer.parse_results(drugz_file)
        results_prefix = analyzer.upload_results()
        
        analyzer.progress.update(100, "DrugZ complete")
        
        logger.info("\n" + "="*60)
        logger.info("✓ DrugZ analysis completed!")
        logger.info(f"Results: s3://{args.s3_bucket}/{results_prefix}")
        logger.info("="*60)
        
        return 0
        
    except Exception as e:
        logger.error(f"\n✗ DrugZ failed: {str(e)}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
