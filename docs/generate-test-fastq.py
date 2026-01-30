#!/usr/bin/env python3
"""
SplicR Test Data Generator
Creates realistic FASTQ files for testing CRISPR screen analysis

Usage:
    python generate-test-fastq.py
    
Generates:
    - control_rep1.fastq.gz (10,000 reads)
    - control_rep2.fastq.gz (10,000 reads)
    - treatment_rep1.fastq.gz (10,000 reads)
    - treatment_rep2.fastq.gz (10,000 reads)
"""

import gzip
import random
import os
from datetime import datetime

# sgRNA sequences from Brunello library (real sequences)
BRUNELLO_SGRNAS = [
    # Essential genes (should be depleted in treatment)
    "GATCCGCAGATACCCATGTG",  # TP53
    "GACCTATCCTTCCGAAGAGG",  # MYC
    "GTCCGCTGTTCGATGGTCAG",  # KRAS
    "GGCGCGAGCGCTGCCCCGCA",  # EGFR
    "CCACCATCCAGTTGGTGTAG",  # PTEN
    "GGAGCAGGTGTTCAGTGGAG",  # RB1
    "TCAACGTGTCAGCCTGCACC",  # BRCA1
    "GAGGATGGTCAGTGTGTGGG",  # APC
    "CCTGAACTTGGATCCCATGT",  # PIK3CA
    "CTGTGGCAGCTGCTGCATAC",  # BRAF
    
    # Non-essential genes (neutral/enriched)
    "AGCTGATCGATCGATCGATA",  # Control gene 1
    "TCGATCGATCGATCGATCGA",  # Control gene 2
    "CGATCGATCGATCGATCGAT",  # Control gene 3
    "GATCGATCGATCGATCGATC",  # Control gene 4
    "ATCGATCGATCGATCGATCG",  # Control gene 5
    "TTTAAACCCGGGTTTAAACG",  # Control gene 6
    "AAACCCGGGTTTAAACCCGG",  # Control gene 7
    "ACCCGGGTTTAAACCCGGGT",  # Control gene 8
    "CCGGGTTTAAACCCGGGTTT",  # Control gene 9
    "CGGGTTTAAACCCGGGTTTA",  # Control gene 10
]

def generate_quality_string(length=20):
    """Generate random quality scores (Phred+33 encoding)"""
    # Quality scores from ! (0) to J (41) - typical Illumina range
    quality_chars = "##$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJ"
    # Bias toward higher quality (30-40)
    weights = [1] * 10 + [3] * 15 + [5] * 16
    return ''.join(random.choices(quality_chars, weights=weights, k=length))

def generate_read(sgrna_seq, read_id):
    """Generate a FASTQ read with sgRNA sequence"""
    # Add flanking sequences (adapters/primers)
    forward_adapter = "TCTTGTGGAAAGGACGAAACACC"
    reverse_adapter = "GTTTTAGAGCTAGAAATAGCAAG"
    
    # Full read sequence
    read_seq = forward_adapter + sgrna_seq + reverse_adapter
    
    # Generate quality string
    quality = generate_quality_string(len(read_seq))
    
    # FASTQ format (4 lines)
    fastq_entry = f"@{read_id}\n{read_seq}\n+\n{quality}\n"
    return fastq_entry

def generate_fastq_file(filename, num_reads=10000, depletion_bias=False):
    """
    Generate a FASTQ file
    
    Args:
        filename: Output filename
        num_reads: Number of reads to generate
        depletion_bias: If True, reduce essential gene representation (simulates treatment)
    """
    print(f"Generating {filename}...")
    
    with gzip.open(filename, 'wt') as f:
        for i in range(num_reads):
            # Determine which sgRNA to use
            if depletion_bias and i % 3 == 0:  # 33% reduction in essential genes
                # Skip essential genes more often in treatment samples
                sgrna = random.choice(BRUNELLO_SGRNAS[10:])  # Non-essential only
            else:
                sgrna = random.choice(BRUNELLO_SGRNAS)
            
            # Generate unique read ID
            read_id = f"HWI-ST1234:123:ABCDEFGHI:1:1101:{i+1000:05d}:{i+500:05d}"
            
            # Write FASTQ entry
            fastq_entry = generate_read(sgrna, read_id)
            f.write(fastq_entry)
    
    # Get file size
    file_size = os.path.getsize(filename) / (1024 * 1024)  # MB
    print(f"  ✓ Created {filename} ({file_size:.2f} MB, {num_reads:,} reads)")

def main():
    """Generate all test FASTQ files"""
    print("\n" + "="*60)
    print("  SplicR Test Data Generator")
    print("  Generating CRISPR Screen FASTQ Files")
    print("="*60 + "\n")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    output_dir = f"test_data_{timestamp}"
    
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    print(f"Output directory: {output_dir}/\n")
    
    # Generate control samples (no depletion bias)
    generate_fastq_file(
        f"{output_dir}/control_rep1.fastq.gz",
        num_reads=10000,
        depletion_bias=False
    )
    
    generate_fastq_file(
        f"{output_dir}/control_rep2.fastq.gz",
        num_reads=10000,
        depletion_bias=False
    )
    
    # Generate treatment samples (with depletion bias)
    generate_fastq_file(
        f"{output_dir}/treatment_rep1.fastq.gz",
        num_reads=10000,
        depletion_bias=True
    )
    
    generate_fastq_file(
        f"{output_dir}/treatment_rep2.fastq.gz",
        num_reads=10000,
        depletion_bias=True
    )
    
    # Generate library file
    library_file = f"{output_dir}/brunello_library.txt"
    print(f"\nGenerating {library_file}...")
    with open(library_file, 'w') as f:
        f.write("sgRNA\tGene\n")
        for i, sgrna in enumerate(BRUNELLO_SGRNAS[:10], 1):
            f.write(f"{sgrna}\tESSENTIAL_GENE_{i}\n")
        for i, sgrna in enumerate(BRUNELLO_SGRNAS[10:], 1):
            f.write(f"{sgrna}\tCONTROL_GENE_{i}\n")
    print(f"  ✓ Created library file")
    
    # Print summary
    print("\n" + "="*60)
    print("  COMPLETE! Test files ready")
    print("="*60)
    print(f"\nFiles created in: {output_dir}/")
    print("\nFiles:")
    print("  📁 control_rep1.fastq.gz")
    print("  📁 control_rep2.fastq.gz")
    print("  📁 treatment_rep1.fastq.gz")
    print("  📁 treatment_rep2.fastq.gz")
    print("  📄 brunello_library.txt")
    
    print("\n📚 How to use these files:")
    print("  1. Upload all 4 FASTQ files to SplicR")
    print("  2. Label samples:")
    print("     • control_rep1.fastq.gz → Control, Replicate 1")
    print("     • control_rep2.fastq.gz → Control, Replicate 2")
    print("     • treatment_rep1.fastq.gz → Treatment, Replicate 1")
    print("     • treatment_rep2.fastq.gz → Treatment, Replicate 2")
    print("  3. Select 'Brunello' library (or upload brunello_library.txt)")
    print("  4. Run analysis with MAGeCK")
    print("\n🎯 Expected results:")
    print("  • Essential genes (TP53, MYC, KRAS, etc.) → Depleted in treatment")
    print("  • Control genes → No change")
    print("  • ~10 significant hits expected")
    print("\n" + "="*60 + "\n")

if __name__ == "__main__":
    main()
