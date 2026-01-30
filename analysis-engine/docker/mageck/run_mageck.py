#!/usr/bin/env python3
"""
MAGeCK Analysis Script for SplicR
Runs MAGeCK count and test on CRISPR screen data
"""

import argparse
import subprocess
import boto3
import os
import json
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


class MAGeCKAnalysis:
    """MAGeCK CRISPR screen analysis"""
    
    def __init__(self, s3_bucket, analysis_id, region='us-east-1'):
        self.s3 = boto3.client('s3', region_name=region)
        self.bucket = s3_bucket
        self.analysis_id = analysis_id
        self.work_dir = Path('/analysis/work')
        self.work_dir.mkdir(exist_ok=True, parents=True)
        self.progress = ProgressReporter(analysis_id)
    
    def download_files(self, file_keys):
        """Download FASTQ files from S3"""
        logger.info(f"Downloading {len(file_keys)} files from S3...")
        self.progress.update(10, "Downloading files from S3")
        
        local_files = []
        for i, key in enumerate(file_keys):
            filename = Path(key).name
            local_path = self.work_dir / filename
            
            logger.info(f"Downloading {filename}...")
            try:
                self.s3.download_file(self.bucket, key, str(local_path))
                local_files.append(str(local_path))
                
                # Update progress
                progress_pct = 10 + (i + 1) / len(file_keys) * 10
                self.progress.update(int(progress_pct), f"Downloaded {i+1}/{len(file_keys)} files")
            except Exception as e:
                logger.error(f"Failed to download {key}: {str(e)}")
                raise
        
        logger.info(f"Downloaded {len(local_files)} files successfully")
        return local_files
    
    def download_library(self, library_s3_key):
        """Download sgRNA library file"""
        logger.info(f"Downloading library file: {library_s3_key}")
        local_path = self.work_dir / "library.txt"
        
        try:
            self.s3.download_file(self.bucket, library_s3_key, str(local_path))
            return str(local_path)
        except Exception as e:
            logger.error(f"Failed to download library: {str(e)}")
            raise
    
    def run_count(self, fastq_files, library_file, sample_labels):
        """Run MAGeCK count"""
        logger.info("Running MAGeCK count...")
        self.progress.update(25, "Running MAGeCK count")
        
        cmd = [
            'mageck', 'count',
            '-l', library_file,
            '-n', 'counts',
            '--sample-label', ','.join(sample_labels),
            '--fastq'] + fastq_files + [
            '--pdf-report',
            '--norm-method', 'median',
            '--output-prefix', str(self.work_dir / 'counts')
        ]
        
        logger.info(f"Command: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.work_dir,
                check=True
            )
            
            logger.info("MAGeCK count completed successfully")
            logger.debug(f"STDOUT: {result.stdout}")
            
            self.progress.update(50, "MAGeCK count complete")
            return self.work_dir / 'counts.count.txt'
            
        except subprocess.CalledProcessError as e:
            logger.error(f"MAGeCK count failed: {e.stderr}")
            raise Exception(f"MAGeCK count failed: {e.stderr}")
    
    def run_test(self, count_file, treatment_samples, control_samples):
        """Run MAGeCK test (RRA algorithm)"""
        logger.info("Running MAGeCK test (RRA)...")
        self.progress.update(55, "Running MAGeCK test")
        
        cmd = [
            'mageck', 'test',
            '-k', str(count_file),
            '-t', ','.join(treatment_samples),
            '-c', ','.join(control_samples),
            '-n', str(self.work_dir / 'results'),
            '--pdf-report',
            '--gene-test-fdr-threshold', '0.05'
        ]
        
        logger.info(f"Command: {' '.join(cmd)}")
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=self.work_dir,
                check=True
            )
            
            logger.info("MAGeCK test completed successfully")
            logger.debug(f"STDOUT: {result.stdout}")
            
            self.progress.update(75, "MAGeCK test complete")
            
            return {
                'gene_summary': self.work_dir / 'results.gene_summary.txt',
                'sgrna_summary': self.work_dir / 'results.sgrna_summary.txt'
            }
            
        except subprocess.CalledProcessError as e:
            logger.error(f"MAGeCK test failed: {e.stderr}")
            raise Exception(f"MAGeCK test failed: {e.stderr}")
    
    def generate_summary_stats(self):
        """Generate summary statistics"""
        logger.info("Generating summary statistics...")
        
        gene_summary_file = self.work_dir / 'results.gene_summary.txt'
        if not gene_summary_file.exists():
            logger.warning("Gene summary file not found")
            return {}
        
        df = pd.read_csv(gene_summary_file, sep='\t')
        
        stats = {
            'total_genes': len(df),
            'significant_genes_005': len(df[df['neg|fdr'] < 0.05]),
            'significant_genes_01': len(df[df['neg|fdr'] < 0.1]),
            'top_depleted': df.nsmallest(10, 'neg|score')['id'].tolist(),
            'top_enriched': df.nlargest(10, 'pos|score')['id'].tolist(),
        }
        
        # Save as JSON
        stats_file = self.work_dir / 'summary_stats.json'
        with open(stats_file, 'w') as f:
            json.dump(stats, f, indent=2)
        
        logger.info(f"Summary stats: {stats['total_genes']} genes, "
                   f"{stats['significant_genes_005']} significant (FDR<0.05)")
        
        return stats
    
    def upload_results(self):
        """Upload results to S3"""
        logger.info("Uploading results to S3...")
        self.progress.update(85, "Uploading results")
        
        results_prefix = f"results/{self.analysis_id}/mageck/"
        
        # Upload all result files
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
    parser = argparse.ArgumentParser(description='Run MAGeCK CRISPR screen analysis')
    parser.add_argument('--analysis-id', required=True, help='Analysis ID')
    parser.add_argument('--file-keys', required=True, help='Comma-separated S3 file keys')
    parser.add_argument('--library', required=True, help='S3 key for sgRNA library file')
    parser.add_argument('--s3-bucket', required=True, help='S3 bucket name')
    parser.add_argument('--treatment', required=True, help='Comma-separated treatment sample names')
    parser.add_argument('--control', required=True, help='Comma-separated control sample names')
    parser.add_argument('--region', default='us-east-1', help='AWS region')
    
    args = parser.parse_args()
    
    logger.info("="*60)
    logger.info("SplicR MAGeCK Analysis")
    logger.info("="*60)
    logger.info(f"Analysis ID: {args.analysis_id}")
    logger.info(f"S3 Bucket: {args.s3_bucket}")
    logger.info(f"Region: {args.region}")
    
    # Parse arguments
    file_keys = args.file_keys.split(',')
    treatment_samples = args.treatment.split(',')
    control_samples = args.control.split(',')
    sample_labels = treatment_samples + control_samples
    
    logger.info(f"Files: {len(file_keys)}")
    logger.info(f"Treatment samples: {treatment_samples}")
    logger.info(f"Control samples: {control_samples}")
    
    try:
        # Initialize analyzer
        analyzer = MAGeCKAnalysis(args.s3_bucket, args.analysis_id, args.region)
        
        # Run analysis pipeline
        logger.info("\nStep 1/5: Downloading files...")
        local_files = analyzer.download_files(file_keys)
        
        logger.info("\nStep 2/5: Downloading library...")
        library_file = analyzer.download_library(args.library)
        
        logger.info("\nStep 3/5: Running MAGeCK count...")
        count_file = analyzer.run_count(
            fastq_files=local_files,
            library_file=library_file,
            sample_labels=sample_labels
        )
        
        logger.info("\nStep 4/5: Running MAGeCK test...")
        results = analyzer.run_test(count_file, treatment_samples, control_samples)
        
        logger.info("\nStep 5/5: Generating summary and uploading...")
        stats = analyzer.generate_summary_stats()
        results_prefix = analyzer.upload_results()
        
        analyzer.progress.update(100, "Analysis complete")
        
        logger.info("\n" + "="*60)
        logger.info("✓ Analysis completed successfully!")
        logger.info(f"Results location: s3://{args.s3_bucket}/{results_prefix}")
        logger.info("="*60)
        
        return 0
        
    except Exception as e:
        logger.error(f"\n✗ Analysis failed: {str(e)}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
