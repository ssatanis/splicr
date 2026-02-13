"""
Logic to infer screen layout (controls vs treatments) from sample metadata.
"""
from typing import List, Optional
from .models import ScreenSample, CONTROL_EXPERIMENT, TREATMENT_EXPERIMENT

def infer_screen_layout(samples: List[ScreenSample], library_name: str, config: dict) -> str:
    """
    Infers the role of each sample and returns the analysis mode.
    
    Modes:
    - 'paired': Multiple files, at least one control found.
    - 'single_vs_reference': One treatment file, using stored reference control.
    - 'single_control_qc_only': One control file, QC only.
    - 'single_qc_only': Ambiguous single file, QC only.
    """
    if not samples:
        return "single_qc_only"

    # Case A: Multiple files
    if len(samples) > 1:
        # 1. Search for SRR26183442 (canonical)
        found_canonical_control = False
        for s in samples:
            if "SRR26183442" in s.name.upper() or "SRR26183442" in s.fastq_path.upper():
                s.sample_type = CONTROL_EXPERIMENT
                found_canonical_control = True
        
        if found_canonical_control:
            # Mark others as treatment if not already control
            for s in samples:
                if s.sample_type != CONTROL_EXPERIMENT:
                    s.sample_type = TREATMENT_EXPERIMENT
            return "paired"

        # 2. Heuristic: Highest mapping rate, lowest Gini is likely control
        # For now, let's just pick one with "CTL" in name if exists, else lowest Gini if QC available
        has_named_control = False
        for s in samples:
            if any(x in s.name.upper() for x in ["CTL", "CONTROL", "PDNA", "DAY0"]):
                s.sample_type = CONTROL_EXPERIMENT
                has_named_control = True
        
        if has_named_control:
            for s in samples:
                if s.sample_type != CONTROL_EXPERIMENT:
                    s.sample_type = TREATMENT_EXPERIMENT
            return "paired"

        # Fallback pick by Gini index if provided (>0)
        valid_ginis = [s.gini_index for s in samples if s.gini_index > 0]
        if valid_ginis:
            min_gini = min(valid_ginis)
            for s in samples:
                if s.gini_index == min_gini:
                    s.sample_type = CONTROL_EXPERIMENT
                else:
                    s.sample_type = TREATMENT_EXPERIMENT
            return "paired"
        
        # If all else fails, first is control
        samples[0].sample_type = CONTROL_EXPERIMENT
        for s in samples[1:]:
            s.sample_type = TREATMENT_EXPERIMENT
        return "paired"

    # Case B: Single file
    sample = samples[0]
    name_upper = sample.name.upper()
    path_upper = sample.fastq_path.upper()

    # Is it the canonical treatment?
    if "SRR26183437" in name_upper or "SRR26183437" in path_upper or "INK" in name_upper:
        sample.sample_type = TREATMENT_EXPERIMENT
        return "single_vs_reference"
    
    # Is it a control?
    if any(x in name_upper for x in ["CTL", "CONTROL", "PDNA", "DAY0"]) or "SRR26183442" in name_upper:
        sample.sample_type = CONTROL_EXPERIMENT
        return "single_control_qc_only"

    # Ambiguous
    if sample.gini_index > 0 and sample.gini_index < 0.15: # Very low Gini often means plasmid
        sample.sample_type = CONTROL_EXPERIMENT
        return "single_control_qc_only"
    
    return "single_qc_only"
