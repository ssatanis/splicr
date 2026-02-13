
import pandas as pd
from pathlib import Path
import logging
import os

logger = logging.getLogger(__name__)

class BrunelloParser:
    def __init__(self, raw_file_path: str, processed_file_path: str):
        self.raw_path = Path(raw_file_path)
        self.processed_path = Path(processed_file_path)
        
    def process(self) -> pd.DataFrame:
        """
        Parses the raw Brunello library file and returns a clean DataFrame.
        """
        if not self.raw_path.exists():
            raise FileNotFoundError(f"Raw Brunello library file not found at {self.raw_path}")
            
        logger.info(f"Parsing Brunello library from {self.raw_path}...")
        
        try:
            # Load raw data - it's tab-separated
            # Expected columns: "Target Gene Symbol", "Target Gene ID", "Target Gene Entrez ID", "sgRNA Target Sequence", ...
            # We need to inspect the file to be sure of column names, but based on typical Broad GPP format:
            # "Target Gene Symbol" -> gene
            # "sgRNA Target Sequence" -> sequence
            # "sgRNA ID" or construct one (e.g. gene_seq)
            
            # Read first few lines to check header if needed, but we'll try standard read_csv
            df = pd.read_csv(self.raw_path, sep='\t')
            
            # Standardize columns
            # Column mapping based on Addgene/Broad format
            # We need: sgRNA_id, sequence, gene, is_nontargeting
            
            # Identify columns
            col_map = {
                'Target Gene Symbol': 'gene',
                'sgRNA Target Sequence': 'sequence',
                'sgRNA ID': 'sgRNA_id' # Ideally present, if not we create
            }
            
            # variable column names handling
            valid_cols = {}
            for file_col, std_col in col_map.items():
                if file_col in df.columns:
                    valid_cols[file_col] = std_col
            
            if 'sequence' not in valid_cols.values():
                 # Fallback for different headers
                 if 'Sequence' in df.columns: valid_cols['Sequence'] = 'sequence'
                 if 'sgRNA Sequence' in df.columns: valid_cols['sgRNA Sequence'] = 'sequence'
            
            if 'gene' not in valid_cols.values():
                if 'Gene Symbol' in df.columns: valid_cols['Gene Symbol'] = 'gene'
                if 'Gene' in df.columns: valid_cols['Gene'] = 'gene'

            df = df.rename(columns=valid_cols)
            
            # Required columns check
            required = ['sequence', 'gene']
            missing = [c for c in required if c not in df.columns]
            if missing:
                raise ValueError(f"Missing required columns in Brunello file: {missing}. Found: {df.columns.tolist()}")

            # Create sgRNA_id if missing
            if 'sgRNA_id' not in df.columns:
                # Create ID: gene_sequence
                df['sgRNA_id'] = df['gene'] + '_' + df['sequence']
                
            # Non-targeting
            # Check for "Non-Targeting Control" in gene name or similar
            if 'is_nontargeting' not in df.columns:
                 df['is_nontargeting'] = df['gene'].str.contains('Non-Targeting', case=False, na=False) | \
                                         df['gene'].str.contains('NO_TARGET', case=False, na=False)

            # Select and order final columns
            final_cols = ['sgRNA_id', 'sequence', 'gene', 'is_nontargeting']
            # Add any other useful metadata if available (e.g. rule set score)
            
            df_clean = df[final_cols].copy()
            
            # Drop duplicates
            df_clean = df_clean.drop_duplicates(subset=['sequence'])
            
            # Save processed
            self.processed_path.parent.mkdir(parents=True, exist_ok=True)
            df_clean.to_parquet(self.processed_path)
            
            logger.info(f"Saved processed Brunello library to {self.processed_path} ({len(df_clean)} sgRNAs)")
            
            return df_clean
            
        except Exception as e:
            logger.error(f"Failed to parse Brunello library: {e}")
            raise

def load_processed_brunello(processed_path: str) -> pd.DataFrame:
    if not os.path.exists(processed_path):
        raise FileNotFoundError(f"Processed file not found at {processed_path}")
    return pd.read_parquet(processed_path)

if __name__ == "__main__":
    # Setup basic logging
    logging.basicConfig(level=logging.INFO)
    
    # Paths (relative to project root usually, but script is in src/...)
    # Assuming running from project root
    raw_path = "data/raw/brunello/broadgpp-brunello-library-contents.txt"
    processed_path = "data/processed/brunello/brunello_library.parquet"
    
    parser = BrunelloParser(raw_path, processed_path)
    try:
        df = parser.process()
        print(f"Successfully processed {len(df)} sgRNAs.")
        print(df.head())
    except Exception as e:
        print(f"Error: {e}")
