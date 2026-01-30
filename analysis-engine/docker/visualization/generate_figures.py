#!/usr/bin/env python3
"""
Publication-Quality Figure Generation for SplicR
Creates scientific figures for CRISPR screen analysis
"""

import matplotlib.pyplot as plt
import matplotlib as mpl
import seaborn as sns
import pandas as pd
import numpy as np
from pathlib import Path
import boto3
import argparse
import sys
import logging
import json
from progress_reporter import ProgressReporter

# Configure matplotlib for publication quality
mpl.rcParams['pdf.fonttype'] = 42  # TrueType fonts in PDF
mpl.rcParams['ps.fonttype'] = 42
mpl.rcParams['font.family'] = 'sans-serif'
mpl.rcParams['font.sans-serif'] = ['Arial', 'DejaVu Sans', 'Liberation Sans']
mpl.rcParams['font.size'] = 12
mpl.rcParams['axes.linewidth'] = 1.5
mpl.rcParams['xtick.major.width'] = 1.5
mpl.rcParams['ytick.major.width'] = 1.5
mpl.rcParams['xtick.major.size'] = 5
mpl.rcParams['ytick.major.size'] = 5
mpl.rcParams['figure.dpi'] = 300
mpl.rcParams['savefig.dpi'] = 300
mpl.rcParams['savefig.bbox'] = 'tight'

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class FigureGenerator:
    """Generate publication-quality figures for CRISPR screens"""
    
    def __init__(self, s3_bucket, analysis_id, results_dir, output_dir, region='us-east-1'):
        self.s3 = boto3.client('s3', region_name=region)
        self.bucket = s3_bucket
        self.analysis_id = analysis_id
        self.results_dir = Path(results_dir)
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.progress = ProgressReporter(analysis_id)
        
        # SplicR color palette (minimal, editorial)
        self.colors = {
            'primary': '#1A1A1A',      # Near black
            'secondary': '#6B6B6B',    # Medium gray
            'accent': '#E8FF4E',       # Lime accent
            'positive': '#10B981',     # Green (enriched)
            'negative': '#EF4444',     # Red (depleted)
            'neutral': '#E5E5E5'       # Border gray
        }
    
    def download_results(self, algorithm='mageck'):
        """Download analysis results from S3"""
        logger.info(f"Downloading {algorithm} results from S3...")
        self.progress.update(10, f"Downloading {algorithm} results")
        
        prefix = f"results/{self.analysis_id}/{algorithm}/"
        
        try:
            response = self.s3.list_objects_v2(
                Bucket=self.bucket,
                Prefix=prefix
            )
            
            if 'Contents' not in response:
                raise Exception(f"No results found at {prefix}")
            
            for obj in response['Contents']:
                key = obj['Key']
                filename = Path(key).name
                local_path = self.results_dir / filename
                
                logger.info(f"Downloading {filename}")
                self.s3.download_file(self.bucket, key, str(local_path))
            
            logger.info(f"Downloaded {len(response['Contents'])} files")
            
        except Exception as e:
            logger.error(f"Failed to download results: {str(e)}")
            raise
    
    def generate_volcano_plot(self, gene_summary_file):
        """
        Generate publication-quality volcano plot
        X-axis: Log2 Fold Change
        Y-axis: -Log10 FDR
        """
        logger.info("Generating volcano plot...")
        self.progress.update(30, "Generating volcano plot")
        
        df = pd.read_csv(gene_summary_file, sep='\t')
        
        # Calculate -log10(FDR)
        df['-log10_fdr_neg'] = -np.log10(df['neg|fdr'].replace(0, 1e-300))
        df['-log10_fdr_pos'] = -np.log10(df['pos|fdr'].replace(0, 1e-300))
        
        fig, ax = plt.subplots(figsize=(10, 8))
        
        # Plot all genes (gray)
        ax.scatter(
            df['neg|lfc'],
            df['-log10_fdr_neg'],
            c=self.colors['neutral'],
            alpha=0.4,
            s=15,
            edgecolors='none',
            label='Not significant'
        )
        
        # Highlight significant depleted genes (red)
        sig_depleted = df[(df['neg|fdr'] < 0.05) & (df['neg|lfc'] < -0.5)]
        ax.scatter(
            sig_depleted['neg|lfc'],
            sig_depleted['-log10_fdr_neg'],
            c=self.colors['negative'],
            alpha=0.8,
            s=40,
            edgecolors=self.colors['primary'],
            linewidths=1,
            label=f'Depleted (n={len(sig_depleted)})'
        )
        
        # Highlight significant enriched genes (green)
        sig_enriched = df[(df['pos|fdr'] < 0.05) & (df['pos|lfc'] > 0.5)]
        ax.scatter(
            sig_enriched['neg|lfc'],
            sig_enriched['-log10_fdr_pos'],
            c=self.colors['positive'],
            alpha=0.8,
            s=40,
            edgecolors=self.colors['primary'],
            linewidths=1,
            label=f'Enriched (n={len(sig_enriched)})'
        )
        
        # Add threshold lines
        ax.axhline(y=-np.log10(0.05), color=self.colors['primary'], 
                   linestyle='--', linewidth=1.5, alpha=0.5)
        ax.axvline(x=-0.5, color=self.colors['primary'], 
                   linestyle='--', linewidth=1.5, alpha=0.5)
        ax.axvline(x=0.5, color=self.colors['primary'], 
                   linestyle='--', linewidth=1.5, alpha=0.5)
        
        # Styling
        ax.set_xlabel('Log₂ Fold Change', fontsize=14, fontweight='600')
        ax.set_ylabel('-Log₁₀ FDR', fontsize=14, fontweight='600')
        ax.set_title('Volcano Plot', fontsize=16, fontweight='600', pad=20)
        
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.spines['left'].set_linewidth(1.5)
        ax.spines['bottom'].set_linewidth(1.5)
        
        ax.grid(True, alpha=0.15, linestyle='-', linewidth=0.5)
        ax.legend(frameon=False, loc='upper right', fontsize=10)
        
        plt.tight_layout()
        
        # Save in multiple formats
        output_png = self.output_dir / 'volcano_plot.png'
        output_pdf = self.output_dir / 'volcano_plot.pdf'
        
        plt.savefig(output_png, dpi=300, bbox_inches='tight', facecolor='white')
        plt.savefig(output_pdf, bbox_inches='tight', facecolor='white')
        plt.close()
        
        logger.info(f"Volcano plot saved: {output_png.name}")
        return output_png
    
    def generate_waterfall_plot(self, gene_summary_file, top_n=50):
        """Generate waterfall plot (ranked genes)"""
        logger.info("Generating waterfall plot...")
        self.progress.update(45, "Generating waterfall plot")
        
        df = pd.read_csv(gene_summary_file, sep='\t')
        
        # Get top depleted and enriched
        top_depleted = df.nsmallest(top_n, 'neg|score')
        top_enriched = df.nlargest(top_n, 'pos|score')
        
        # Combine and sort by fold change
        combined = pd.concat([top_depleted, top_enriched])
        combined = combined.sort_values('neg|lfc')
        
        fig, ax = plt.subplots(figsize=(14, 10))
        
        # Color bars based on significance
        colors = [
            self.colors['negative'] if lfc < -0.5 else 
            self.colors['positive'] if lfc > 0.5 else 
            self.colors['secondary']
            for lfc in combined['neg|lfc']
        ]
        
        y_pos = np.arange(len(combined))
        bars = ax.barh(y_pos, combined['neg|lfc'], color=colors, alpha=0.8, 
                       edgecolor=self.colors['primary'], linewidth=0.5)
        
        ax.set_yticks(y_pos[::5])  # Show every 5th label
        ax.set_yticklabels(combined['id'].iloc[::5], fontsize=9)
        ax.set_xlabel('Log₂ Fold Change', fontsize=14, fontweight='600')
        ax.set_title(f'Top {top_n*2} Genes (Depleted ← → Enriched)', 
                     fontsize=16, fontweight='600', pad=20)
        
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.axvline(x=0, color=self.colors['primary'], linewidth=1.5)
        ax.grid(axis='x', alpha=0.15, linestyle='-', linewidth=0.5)
        
        plt.tight_layout()
        
        output_png = self.output_dir / 'waterfall_plot.png'
        output_pdf = self.output_dir / 'waterfall_plot.pdf'
        
        plt.savefig(output_png, dpi=300, bbox_inches='tight', facecolor='white')
        plt.savefig(output_pdf, bbox_inches='tight', facecolor='white')
        plt.close()
        
        logger.info(f"Waterfall plot saved: {output_png.name}")
        return output_png
    
    def generate_qc_plots(self, count_file):
        """Generate QC plots"""
        logger.info("Generating QC plots...")
        self.progress.update(60, "Generating QC plots")
        
        df = pd.read_csv(count_file, sep='\t')
        
        # Get sample columns (exclude Gene, sgRNA)
        sample_cols = [col for col in df.columns if col not in ['sgRNA', 'Gene']]
        
        fig, axes = plt.subplots(2, 2, figsize=(14, 12))
        fig.suptitle('Quality Control Metrics', fontsize=18, fontweight='600', y=0.995)
        
        # 1. Read count distribution
        counts = df[sample_cols].values.flatten()
        counts = counts[counts > 0]
        
        axes[0, 0].hist(np.log10(counts), bins=50, color=self.colors['primary'], 
                        alpha=0.7, edgecolor=self.colors['primary'], linewidth=1)
        axes[0, 0].set_xlabel('Log₁₀ Read Count', fontsize=12)
        axes[0, 0].set_ylabel('Frequency', fontsize=12)
        axes[0, 0].set_title('Read Count Distribution', fontsize=14, fontweight='600')
        axes[0, 0].spines['top'].set_visible(False)
        axes[0, 0].spines['right'].set_visible(False)
        axes[0, 0].grid(alpha=0.15)
        
        # 2. Sample correlation heatmap
        corr = df[sample_cols].corr()
        sns.heatmap(corr, annot=True, fmt='.2f', cmap='Greys', 
                    square=True, ax=axes[0, 1], cbar_kws={'shrink': 0.8},
                    linewidths=0.5, linecolor='white')
        axes[0, 1].set_title('Sample Correlation', fontsize=14, fontweight='600')
        
        # 3. Library coverage per sample
        total_counts = df[sample_cols].sum()
        axes[1, 0].bar(range(len(sample_cols)), total_counts,
                       color=self.colors['primary'], alpha=0.7, 
                       edgecolor=self.colors['primary'], linewidth=1)
        axes[1, 0].set_xticks(range(len(sample_cols)))
        axes[1, 0].set_xticklabels(sample_cols, rotation=45, ha='right', fontsize=10)
        axes[1, 0].set_ylabel('Total Read Count', fontsize=12)
        axes[1, 0].set_title('Library Coverage per Sample', fontsize=14, fontweight='600')
        axes[1, 0].spines['top'].set_visible(False)
        axes[1, 0].spines['right'].set_visible(False)
        axes[1, 0].grid(axis='y', alpha=0.15)
        axes[1, 0].ticklabel_format(style='scientific', axis='y', scilimits=(0, 0))
        
        # 4. Zero/low count analysis
        zero_counts = (df[sample_cols] == 0).sum()
        low_counts = (df[sample_cols] < 10).sum()
        
        x = np.arange(len(sample_cols))
        width = 0.35
        
        axes[1, 1].bar(x - width/2, zero_counts, width,
                       label='Zero counts', color=self.colors['negative'], 
                       alpha=0.7, edgecolor=self.colors['primary'], linewidth=1)
        axes[1, 1].bar(x + width/2, low_counts, width,
                       label='Low counts (<10)', color=self.colors['secondary'], 
                       alpha=0.7, edgecolor=self.colors['primary'], linewidth=1)
        
        axes[1, 1].set_xticks(x)
        axes[1, 1].set_xticklabels(sample_cols, rotation=45, ha='right', fontsize=10)
        axes[1, 1].set_ylabel('Number of sgRNAs', fontsize=12)
        axes[1, 1].set_title('sgRNA Coverage Analysis', fontsize=14, fontweight='600')
        axes[1, 1].spines['top'].set_visible(False)
        axes[1, 1].spines['right'].set_visible(False)
        axes[1, 1].grid(axis='y', alpha=0.15)
        axes[1, 1].legend(frameon=False, fontsize=10)
        
        plt.tight_layout()
        
        output_png = self.output_dir / 'qc_plots.png'
        output_pdf = self.output_dir / 'qc_plots.pdf'
        
        plt.savefig(output_png, dpi=300, bbox_inches='tight', facecolor='white')
        plt.savefig(output_pdf, bbox_inches='tight', facecolor='white')
        plt.close()
        
        logger.info(f"QC plots saved: {output_png.name}")
        return output_png
    
    def generate_top_hits_barplot(self, gene_summary_file, top_n=20):
        """Generate top hits horizontal bar plot"""
        logger.info("Generating top hits plot...")
        self.progress.update(75, "Generating top hits plot")
        
        df = pd.read_csv(gene_summary_file, sep='\t')
        
        # Get top depleted and enriched
        top_depleted = df.nsmallest(top_n, 'neg|score')
        top_enriched = df.nlargest(top_n, 'pos|score')
        
        fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(16, 10), sharey=False)
        fig.suptitle(f'Top {top_n} Genes', fontsize=18, fontweight='600', y=0.995)
        
        # Depleted genes (left panel)
        y_pos = np.arange(len(top_depleted))
        ax1.barh(y_pos, top_depleted['neg|lfc'].abs(), 
                 color=self.colors['negative'], alpha=0.8,
                 edgecolor=self.colors['primary'], linewidth=1)
        ax1.set_yticks(y_pos)
        ax1.set_yticklabels(top_depleted['id'], fontsize=10)
        ax1.invert_xaxis()
        ax1.invert_yaxis()
        ax1.set_xlabel('|Log₂ Fold Change|', fontsize=12, fontweight='600')
        ax1.set_title('Depleted Genes', fontsize=14, fontweight='600', pad=15)
        ax1.spines['top'].set_visible(False)
        ax1.spines['right'].set_visible(False)
        ax1.grid(axis='x', alpha=0.15)
        
        # Enriched genes (right panel)
        y_pos = np.arange(len(top_enriched))
        ax2.barh(y_pos, top_enriched['pos|lfc'], 
                 color=self.colors['positive'], alpha=0.8,
                 edgecolor=self.colors['primary'], linewidth=1)
        ax2.set_yticks(y_pos)
        ax2.set_yticklabels(top_enriched['id'], fontsize=10)
        ax2.invert_yaxis()
        ax2.set_xlabel('Log₂ Fold Change', fontsize=12, fontweight='600')
        ax2.set_title('Enriched Genes', fontsize=14, fontweight='600', pad=15)
        ax2.spines['top'].set_visible(False)
        ax2.spines['left'].set_visible(False)
        ax2.yaxis.tick_right()
        ax2.grid(axis='x', alpha=0.15)
        
        plt.tight_layout()
        
        output_png = self.output_dir / 'top_hits.png'
        output_pdf = self.output_dir / 'top_hits.pdf'
        
        plt.savefig(output_png, dpi=300, bbox_inches='tight', facecolor='white')
        plt.savefig(output_pdf, bbox_inches='tight', facecolor='white')
        plt.close()
        
        logger.info(f"Top hits plot saved: {output_png.name}")
        return output_png
    
    def generate_rank_plot(self, gene_summary_file):
        """Generate gene rank plot"""
        logger.info("Generating rank plot...")
        
        df = pd.read_csv(gene_summary_file, sep='\t')
        df = df.sort_values('neg|score')
        df['rank'] = range(1, len(df) + 1)
        
        fig, ax = plt.subplots(figsize=(12, 7))
        
        ax.plot(df['rank'], df['neg|lfc'], 
                color=self.colors['primary'], linewidth=2, alpha=0.8)
        
        # Highlight significant genes
        sig = df[df['neg|fdr'] < 0.05]
        ax.scatter(sig['rank'], sig['neg|lfc'], 
                   c=self.colors['accent'], s=20, alpha=0.6, 
                   edgecolors=self.colors['primary'], linewidths=0.5,
                   label=f'Significant (FDR < 0.05, n={len(sig)})')
        
        ax.set_xlabel('Gene Rank', fontsize=14, fontweight='600')
        ax.set_ylabel('Log₂ Fold Change', fontsize=14, fontweight='600')
        ax.set_title('Gene Rank Plot', fontsize=16, fontweight='600', pad=20)
        
        ax.spines['top'].set_visible(False)
        ax.spines['right'].set_visible(False)
        ax.grid(alpha=0.15)
        ax.legend(frameon=False)
        
        plt.tight_layout()
        
        output_png = self.output_dir / 'rank_plot.png'
        output_pdf = self.output_dir / 'rank_plot.pdf'
        
        plt.savefig(output_png, dpi=300, bbox_inches='tight', facecolor='white')
        plt.savefig(output_pdf, bbox_inches='tight', facecolor='white')
        plt.close()
        
        logger.info(f"Rank plot saved: {output_png.name}")
        return output_png
    
    def calculate_qc_metrics(self, count_file):
        """Calculate QC metrics"""
        logger.info("Calculating QC metrics...")
        
        df = pd.read_csv(count_file, sep='\t')
        sample_cols = [col for col in df.columns if col not in ['sgRNA', 'Gene']]
        
        metrics = {}
        
        for col in sample_cols:
            total_reads = df[col].sum()
            zero_count = (df[col] == 0).sum()
            low_count = (df[col] < 10).sum()
            median_count = df[col].median()
            
            metrics[col] = {
                'total_reads': int(total_reads),
                'median_count': float(median_count),
                'zero_sgrnas': int(zero_count),
                'low_count_sgrnas': int(low_count),
                'coverage': round((1 - zero_count / len(df)) * 100, 2)
            }
        
        # Save metrics
        metrics_file = self.output_dir / 'qc_metrics.json'
        with open(metrics_file, 'w') as f:
            json.dump(metrics, f, indent=2)
        
        logger.info("QC metrics calculated")
        return metrics
    
    def upload_figures(self):
        """Upload all figures to S3"""
        logger.info("Uploading figures to S3...")
        self.progress.update(90, "Uploading figures")
        
        figures_prefix = f"results/{self.analysis_id}/figures/"
        
        uploaded_urls = {}
        for figure_path in self.output_dir.glob('*'):
            if figure_path.is_file():
                s3_key = f"{figures_prefix}{figure_path.name}"
                
                logger.info(f"Uploading {figure_path.name}")
                
                try:
                    self.s3.upload_file(
                        str(figure_path),
                        self.bucket,
                        s3_key,
                        ExtraArgs={'ContentType': self._get_content_type(figure_path)}
                    )
                    uploaded_urls[figure_path.stem] = s3_key
                except Exception as e:
                    logger.error(f"Failed to upload {figure_path.name}: {str(e)}")
        
        logger.info(f"Uploaded {len(uploaded_urls)} figures")
        return uploaded_urls
    
    def _get_content_type(self, file_path):
        """Get content type based on file extension"""
        ext = file_path.suffix.lower()
        return {
            '.png': 'image/png',
            '.pdf': 'application/pdf',
            '.json': 'application/json'
        }.get(ext, 'application/octet-stream')


def main():
    parser = argparse.ArgumentParser(description='Generate publication-quality figures')
    parser.add_argument('--analysis-id', required=True)
    parser.add_argument('--s3-bucket', required=True)
    parser.add_argument('--algorithm', default='mageck', choices=['mageck', 'bagel2', 'drugz'])
    parser.add_argument('--results-dir', default='/analysis/results')
    parser.add_argument('--output-dir', default='/analysis/figures')
    parser.add_argument('--region', default='us-east-1')
    
    args = parser.parse_args()
    
    logger.info("="*60)
    logger.info("SplicR Figure Generation")
    logger.info("="*60)
    logger.info(f"Analysis ID: {args.analysis_id}")
    logger.info(f"Algorithm: {args.algorithm}")
    
    try:
        generator = FigureGenerator(
            s3_bucket=args.s3_bucket,
            analysis_id=args.analysis_id,
            results_dir=args.results_dir,
            output_dir=args.output_dir,
            region=args.region
        )
        
        # Download results
        logger.info("\nStep 1/6: Downloading results...")
        generator.download_results(args.algorithm)
        
        # Find result files
        gene_summary = generator.results_dir / 'results.gene_summary.txt'
        count_file = generator.results_dir / 'counts.count.txt'
        
        if not gene_summary.exists():
            raise Exception("Gene summary file not found")
        
        # Generate figures
        logger.info("\nStep 2/6: Generating volcano plot...")
        generator.generate_volcano_plot(gene_summary)
        
        logger.info("\nStep 3/6: Generating waterfall plot...")
        generator.generate_waterfall_plot(gene_summary)
        
        logger.info("\nStep 4/6: Generating rank plot...")
        generator.generate_rank_plot(gene_summary)
        
        if count_file.exists():
            logger.info("\nStep 5/6: Generating QC plots...")
            generator.generate_qc_plots(count_file)
            generator.calculate_qc_metrics(count_file)
        
        logger.info("\nStep 6/6: Uploading figures...")
        uploaded = generator.upload_figures()
        
        generator.progress.update(100, "Figure generation complete")
        
        logger.info("\n" + "="*60)
        logger.info("✓ Figure generation completed!")
        logger.info(f"Generated {len(uploaded)} figures")
        logger.info("="*60)
        
        return 0
        
    except Exception as e:
        logger.error(f"\n✗ Figure generation failed: {str(e)}")
        return 1


if __name__ == '__main__':
    sys.exit(main())
