#!/usr/bin/env python3
"""
Download all required databases for CRISPR Confidence Score and upload to R2
Run: python data/scripts/download_databases.py
"""
import os
import requests
import json
import gzip
import shutil
import boto3
from pathlib import Path
from tqdm import tqdm
from botocore.exceptions import ClientError
from botocore.config import Config

# --- Configuration ---
BASE_DIR = Path(__file__).parent.parent.resolve() # Points to data/
RAW_DIR = BASE_DIR / "raw"
PROCESSED_DIR = BASE_DIR / "processed"

# R2 Configuration from Environment Variables
R2_ENDPOINT_URL = os.environ.get("R2_ENDPOINT_URL")
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY")
S3_BUCKET_NAME = os.environ.get("S3_BUCKET_NAME")
AWS_REGION = os.environ.get("AWS_REGION", "auto")

# Initialize S3 client for R2
s3_client = None
if all([R2_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME]):
    try:
        config = Config(
            region_name=AWS_REGION,
            retries={'max_attempts': 3, 'mode': 'adaptive'},
            connect_timeout=5,
            read_timeout=60
        )
        s3_client = boto3.client(
            's3',
            endpoint_url=R2_ENDPOINT_URL,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
            config=config
        )
        print("✓ R2 Client Initialized")
    except Exception as e:
        print(f"⚠ Failed to initialize R2 client: {e}")
else:
    print("⚠ R2 credentials not found in environment. Skipping uploads.")

def setup_directories():
    """Create necessary directories"""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    print(f"✓ Directories set up:\n  {RAW_DIR}\n  {PROCESSED_DIR}")

def upload_to_r2(file_path, s3_key=None):
    """Upload a file to R2 bucket"""
    if not s3_client:
        return
    
    if s3_key is None:
        # Default key structure: data/type/filename
        # e.g. data/raw/file.txt or data/processed/file.json
        rel_path = file_path.relative_to(BASE_DIR)
        s3_key = f"data/{rel_path}"
    
    print(f"Uploading {file_path.name} to R2 ({s3_key})...")
    try:
        file_size = file_path.stat().st_size
        with tqdm(total=file_size, unit='B', unit_scale=True, desc="Upload") as pbar:
            s3_client.upload_file(
                str(file_path),
                S3_BUCKET_NAME,
                s3_key,
                Callback=pbar.update
            )
        print(f"✓ Uploaded {s3_key}")
    except ClientError as e:
        print(f"✗ Failed to upload {file_path.name}: {e}")

def check_r2_file_exists(s3_key):
    """Check if file exists in R2"""
    if not s3_client:
        return False
    try:
        s3_client.head_object(Bucket=S3_BUCKET_NAME, Key=s3_key)
        return True
    except ClientError:
        return False

def download_file(url, output_path, decompress=False):
    """Download file with progress bar"""
    if output_path.exists():
        print(f"File already exists: {output_path.name}")
        return output_path

    print(f"Downloading: {url}")
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        total_size = int(response.headers.get('content-length', 0))
        
        with open(output_path, 'wb') as f, tqdm(
            total=total_size,
            unit='B',
            unit_scale=True,
            desc=output_path.name
        ) as pbar:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
                pbar.update(len(chunk))
        
        print(f"✓ Downloaded: {output_path.name}")

        # Decompress if needed
        if decompress and str(output_path).endswith('.gz'):
            print(f"Decompressing {output_path.name}...")
            decompressed_path = output_path.with_suffix('')
            with gzip.open(output_path, 'rb') as f_in:
                with open(decompressed_path, 'wb') as f_out:
                    shutil.copyfileobj(f_in, f_out)
            
            os.remove(output_path) # Remove .gz file
            print(f"✓ Decompressed to {decompressed_path.name}")
            return decompressed_path
            
        return output_path
    except Exception as e:
        print(f"✗ Failed to download {url}: {e}")
        if output_path.exists():
            os.remove(output_path)
        return None

def download_kegg_pathways():
    """Download and parse KEGG pathways"""
    print("=" * 60)
    print("DOWNLOADING KEGG PATHWAYS")
    print("=" * 60)
    
    output_file = PROCESSED_DIR / 'kegg_pathways.json'
    
    # Check if already done
    if output_file.exists():
         print(f"✓ KEGG pathways already exist: {output_file}")
         upload_to_r2(output_file)
         return

    # Get list of human pathways
    print("Fetching human pathway list...")
    try:
        pathways_response = requests.get('https://rest.kegg.jp/list/pathway/hsa')
        pathways_response.raise_for_status()
        pathways = pathways_response.text.strip().split('\n')
        
        pathway_data = {}
        for line in tqdm(pathways, desc="Downloading pathway genes"):
            try:
                parts = line.split('\t')
                pathway_id = parts[0]
                pathway_name = parts[1] if len(parts) > 1 else "Unknown"
                
                # Get genes for this pathway
                genes_response = requests.get(f'https://rest.kegg.jp/link/genes/{pathway_id}')
                if genes_response.status_code == 200 and genes_response.text.strip():
                    genes = [g.split('\t')[1] for g in genes_response.text.strip().split('\n')]
                    pathway_data[pathway_id] = {
                        'name': pathway_name,
                        'genes': genes
                    }
            except Exception as e:
                print(f"Warning: Could not fetch genes for {pathway_id}: {e}")
                continue
        
        # Save as JSON
        with open(output_file, 'w') as f:
            json.dump(pathway_data, f, indent=2)
        
        print(f"✓ Saved {len(pathway_data)} pathways to {output_file}")
        upload_to_r2(output_file)
        
    except Exception as e:
        print(f"✗ Failed to download KEGG pathways: {e}")

def download_reactome():
    """Download Reactome pathways"""
    print("=" * 60)
    print("DOWNLOADING REACTOME PATHWAYS")
    print("=" * 60)
    
    url = 'https://reactome.org/download/current/UniProt2Reactome.txt'
    output_path = RAW_DIR / 'UniProt2Reactome.txt'
    processed_output_file = PROCESSED_DIR / 'reactome_pathways.json'

    # Download raw file
    downloaded_file = download_file(url, output_path)
    if downloaded_file:
        upload_to_r2(downloaded_file)

    # Process to JSON format
    if processed_output_file.exists():
        print(f"✓ Reactome processed data already exists: {processed_output_file}")
        upload_to_r2(processed_output_file)
        return

    print("Processing Reactome data...")
    try:
        import pandas as pd
        reactome = pd.read_csv(
            output_path,
            sep='\t',
            header=None,
            names=['uniprot', 'reactome_id', 'url', 'name', 'evidence', 'species']
        )
        
        # Filter human
        reactome_human = reactome[reactome['species'] == 'Homo sapiens']
        
        # Group by pathway
        pathway_data = {}
        for pathway_id, group in reactome_human.groupby('reactome_id'):
            pathway_data[pathway_id] = {
                'name': group['name'].iloc[0],
                'genes': group['uniprot'].tolist()
            }
            
        # Save as JSON
        with open(processed_output_file, 'w') as f:
            json.dump(pathway_data, f, indent=2)
            
        print(f"✓ Processed {len(pathway_data)} pathways to {processed_output_file}")
        upload_to_r2(processed_output_file)

    except ImportError:
        print("⚠ pandas not installed, skipping Reactome processing")
    except Exception as e:
        print(f"✗ Failed to process Reactome data: {e}")

def download_string():
    """Download STRING database"""
    print("=" * 60)
    print("DOWNLOADING STRING DATABASE (WARNING: ~2.1 GB Compressed)")
    print("=" * 60)
    
    # Using specific version v12.0 for human (9606)
    url = 'https://stringdb-downloads.org/download/protein.links.v12.0/9606.protein.links.v12.0.txt.gz'
    output_path = RAW_DIR / '9606.protein.links.v12.0.txt.gz'
    final_path = RAW_DIR / '9606.protein.links.v12.0.txt'
    
    if final_path.exists():
        print(f"✓ STRING database already exists: {final_path}")
        # Note: skipping upload check for very large files unless necessary to avoid heavy bandwidth usage on re-runs
        # check_r2_file_exists would be better here
        return

    downloaded = download_file(url, output_path, decompress=True)
    if downloaded:
        upload_to_r2(downloaded)

def download_depmap():
    """Download DepMap data"""
    print("=" * 60)
    print("DOWNLOADING DEPMAP (Public 24Q2)")
    print("=" * 60)
    
    base_url = 'https://depmap.org/portal/download/api/download/external'
    files = {
        'Achilles_gene_effect.csv': '?file_name=public.24Q2.1%2FAchilles_gene_effect.csv',
        'sample_info.csv': '?file_name=public.24Q2.1%2Fsample_info.csv'
    }
    
    for filename, endpoint in files.items():
        print(f"\nDownloading {filename}...")
        url = f"{base_url}{endpoint}"
        output_path = RAW_DIR / filename
        
        if output_path.exists():
            print(f"✓ {filename} already exists")
            upload_to_r2(output_path)
            continue
            
        try:
            downloaded = download_file(url, output_path)
            if downloaded:
                upload_to_r2(downloaded)
        except Exception as e:
            print(f"⚠ Could not download {filename}: {e}")
            print(f"Please download manually from: https://depmap.org/portal/download/")

def download_bagel_essential_genes():
    """Download core essential genes from BAGEL2"""
    print("=" * 60)
    print("DOWNLOADING CORE ESSENTIAL GENES")
    print("=" * 60)
    
    url = 'https://raw.githubusercontent.com/hart-lab/bagel/master/CEGv2/CEG2_essentials.txt'
    output_path = RAW_DIR / 'CEG2_essentials.txt'
    
    if output_path.exists():
        print(f"✓ CEG2 essentials already exists")
        upload_to_r2(output_path)
        return

    downloaded = download_file(url, output_path)
    if downloaded:
        upload_to_r2(downloaded)

def download_human_genome_info():
    """Instructions for human genome (too large for auto-download often)"""
    print("=" * 60)
    print("HUMAN GENOME (hg38) - MANUAL DOWNLOAD REQUIRED/RECOMMENDED")
    print("=" * 60)
    
    genome_file = RAW_DIR / 'hg38.fa'
    if genome_file.exists():
        print(f"✓ Human genome found: {genome_file}")
        return

    print("""
    The human genome is ~3 GB and best downloaded manually or via robust tools.
    
    Option 1: Download directly
    wget http://hgdownload.soe.ucsc.edu/goldenPath/hg38/bigZips/hg38.fa.gz
    gunzip hg38.fa.gz
    mv hg38.fa data/raw/
    
    Option 2: Use existing genome
    ln -s /path/to/your/hg38.fa data/raw/hg38.fa
    
    Then index with Bowtie2:
    bowtie2-build data/raw/hg38.fa data/raw/hg38_index
    """)

def main():
    """Download all databases"""
    print("\n" + "=" * 60)
    print("CRISPR CONFIDENCE SCORE - DATABASE SETUP")
    print("=" * 60 + "\n")
    
    # Check dependencies
    try:
        import pandas
        import tqdm
    except ImportError:
        print("⚠ Missing dependencies. Install with:")
        print("pip install pandas tqdm requests boto3")
        return

    setup_directories()
    
    # Download each database
    download_kegg_pathways()
    download_reactome()
    download_string()
    download_bagel_essential_genes()
    download_depmap()
    download_human_genome_info()
    
    print("\n" + "=" * 60)
    print("DOWNLOAD COMPLETE!")
    print("=" * 60)
    print(f"\nRaw files: {RAW_DIR}")
    print(f"Processed files: {PROCESSED_DIR}")
    print("\nNext steps:")
    print("1. Download human genome manually if needed")
    print("2. Verify all files with: python data/scripts/verify_downloads.py")

if __name__ == '__main__':
    main()
