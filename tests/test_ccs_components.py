"""
Unit Tests for CRISPR Confidence Score Components
"""
import pytest
import pandas as pd
import numpy as np
from unittest.mock import MagicMock, patch
from src.crispr_confidence.components import (
    compute_s_sgrna,
    compute_s_offtarget,
    compute_s_repro,
    ScreenReplicate,
    compute_s_pathway,
    compute_s_ml_heuristic,
    ReferenceDataManager
)

# --- S_sgRNA Tests ---
def test_s_sgrna_high_concordance():
    """Test S_sgRNA with highly consistent guides"""
    gene = "GENE1"
    guides = pd.DataFrame({
        'sgrna': ['g1', 'g2', 'g3', 'g4'],
        'gene': ['GENE1'] * 4,
        'sequence': ['A']*4
    })
    effects = pd.DataFrame({
        'sgrna': ['g1', 'g2', 'g3', 'g4'],
        'lfc': [-2.0, -2.1, -1.9, -2.05], # Very tight cluster
        'activity_score': [1.0] * 4
    })
    
    score = compute_s_sgrna(gene, guides, effects)
    # CV should be very low -> score ~ 1.0 * penalty(1.0) = 1.0
    assert score > 0.9

def test_s_sgrna_low_concordance():
    """Test S_sgRNA with noisy guides"""
    gene = "GENE1"
    guides = pd.DataFrame({
        'sgrna': ['g1', 'g2', 'g3', 'g4'],
        'gene': ['GENE1'] * 4,
        'sequence': ['A']*4
    })
    effects = pd.DataFrame({
        'sgrna': ['g1', 'g2', 'g3', 'g4'],
        'lfc': [-2.0, 0.5, -5.0, 1.0], # Huge spread
        'activity_score': [1.0] * 4
    })
    
    score = compute_s_sgrna(gene, guides, effects)
    # CV should be high -> score near 0
    assert score < 0.2

def test_s_sgrna_low_guide_count():
    """Test penalty for insufficient guides"""
    gene = "GENE1"
    guides = pd.DataFrame({
        'sgrna': ['g1', 'g2'], # Only 2 guides
        'gene': ['GENE1'] * 2,
        'sequence': ['A']*2
    })
    effects = pd.DataFrame({
        'sgrna': ['g1', 'g2'],
        'lfc': [-2.0, -2.0], # Perfect agreement
        'activity_score': [1.0] * 2
    })
    
    score = compute_s_sgrna(gene, guides, effects)
    # Perfect concordance (1.0) * Penalty (2/4 = 0.5) = 0.5
    assert score == 0.5


# --- S_offtarget Tests ---
def test_s_offtarget_clean():
    """Test gene with clean guides (no off-targets)"""
    gene = "GENE1"
    guides_data = [
        {'sequence': 'AAA', 'off_targets': []},
        {'sequence': 'BBB', 'off_targets': []}
    ]
    hit_genes = ["GENE2", "GENE3"]
    
    score = compute_s_offtarget(gene, guides_data, hit_genes)
    assert score == 0.0

def test_s_offtarget_risky():
    """Test gene with high-risk off-target"""
    gene = "GENE1"
    # Create an OT dict that mimics a high CFD score
    # We aren't testing calculate_cfd logic deeply here, just the aggregation
    # But calculate_cfd is called inside.
    # Let's mock a perfect match OT: same seq, NGG pam
    guides_data = [
        {
            'sequence': 'AAAAAAAAAAAAAAAAAAAA', # 20 A's
            'off_targets': [
                {'seq': 'AAAAAAAAAAAAAAAAAAAA', 'pam': 'CGG', 'gene': 'GENE2'} # Perfect match to GENE2
            ]
        }
    ]
    hit_genes = ["GENE2"] # GENE2 is a hit! Synergistic penalty.
    
    # This should trigger high risk
    # CFD ~ 1.0 (perfect match except PAM 'C' vs 'N'? 'CGG' is PAM, 'NGG' is canonical)
    # 'CGG' penalty is 0.26 in our map? Or we didn't add it?
    # Let's adjust mock to be NGG compatible if we want max score
    guides_data[0]['off_targets'][0]['pam'] = 'AGG' # 0.26 penalty
    # Wait, simple implementation:
    # spacer='A...A', proto='A...A' -> mismatch score 1.0
    # PAM 'AGG' -> 0.26
    # CFD = 0.26
    # Overlap penalty = 1.5 (since GENE2 is hit)
    # Total = 1.76
    # Max risk 1.76
    # Score = (1.76 - 0.5) / 2.0 = 0.63
    
    score = compute_s_offtarget(gene, guides_data, hit_genes)
    assert score > 0.5


# --- S_repro Tests ---
def test_s_repro_consistent():
    """Test consistent replicates"""
    gene = "GENE1"
    # LFCs: -2.0, -2.1 (diff 0.1) -> excellent
    rep1 = ScreenReplicate({"GENE1": -2.0})
    rep2 = ScreenReplicate({"GENE1": -2.1})
    
    score = compute_s_repro(gene, [rep1, rep2], [])
    assert score > 0.9

def test_s_repro_noisy():
    """Test noisy replicates"""
    gene = "GENE1"
    # LFCs: -2.0, 0.5 (diff 2.5) -> poor -> score 0
    rep1 = ScreenReplicate({"GENE1": -2.0})
    rep2 = ScreenReplicate({"GENE1": 0.5})
    
    score = compute_s_repro(gene, [rep1, rep2], [])
    assert score == 0.0


# --- S_pathway Tests ---
@patch('src.crispr_confidence.components.pathways.hypergeom')
def test_s_pathway_enriched(mock_hypergeom):
    """Test pathway Enrichment logic"""
    # Mock ReferenceDataManager
    mock_data = MagicMock()
    # Mock pathways: P1 contains GENE1
    mock_data.get_all_pathways_combined.return_value = {
        'P1': {'genes': ['GENE1', 'G2', 'G3']} 
    }
    
    # Mock p-value to be significant
    mock_hypergeom.sf.return_value = 1e-5 # -log10 = 5.0
    
    hit_genes = ['GENE1', 'G2', 'G3'] # All pathway genes are hits
    
    score = compute_s_pathway('GENE1', hit_genes, mock_data)
    
    # Pathway score: min(5.0 / 3.0, 1.0) = 1.0
    # PPI score: default mock returns None graph?
    # We should mock load_string_network to return empty graph to isolate pathway score
    mock_graph = MagicMock()
    mock_graph.__contains__.return_value = False
    mock_data.load_string_network.return_value = mock_graph
    
    # Weights: 0.5 * 1.0 (pathway) + 0 + 0 = 0.5
    assert score >= 0.5


# --- S_ML Tests ---
def test_s_ml_heuristic_high():
    """Test heuristic with strong features"""
    features = {
        'beta_score': -3.0, # +0.15
        'fdr': 0.001,       # +0.10
        'guide_cv': 0.2,    # +0.10
        'max_cfd': 0.1,     # +0.10
        'n_enriched_pathways': 1 # +0.05
    }
    # Base 0.5 + 0.5 = 1.0
    score = compute_s_ml_heuristic('any', features)
    assert score == 1.0

def test_s_ml_heuristic_low():
    """Test heuristic with weak features"""
    features = {
        'beta_score': -0.5,
        'fdr': 0.5,
        'guide_cv': 1.0,
        'max_cfd': 0.8
    }
    # Base 0.5
    score = compute_s_ml_heuristic('any', features)
    assert score == 0.5
