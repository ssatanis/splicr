"""
Seed Reference Gene Sets into Database

This script reads reference gene set JSON files and populates the database
with gene sets and their genes. Run this after applying the migration.

Usage:
    python scripts/seed_reference_genes.py

Environment Variables:
    DATABASE_URL or SUPABASE_DATABASE_URL: PostgreSQL connection string
"""

import json
import os
import sys
from pathlib import Path
import psycopg2
from psycopg2.extras import execute_values
from typing import Dict, List, Any
import logging

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Add parent directory to path to import app modules
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Reference sets directory
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "reference_sets"

# Mapping of file names to reference set names and categories
REFERENCE_SETS = {
    "hart_essential_2015.json": {
        "category": "Essential",
        "name": "Hart Core Essential 2015"
    },
    "hart_non_essential_2014.json": {
        "category": "Non-Essential",
        "name": "Hart Non-Essential 2014"
    },
    "ribosomal_proteins.json": {
        "category": "Control",
        "name": "Ribosomal Proteins"
    },
    "dna_repair_genes.json": {
        "category": "Pathway",
        "name": "DNA Repair Genes"
    },
    "cancer_drivers.json": {
        "category": "Cancer Drivers",
        "name": "Cancer Driver Genes"
    }
}


def get_database_url() -> str:
    """Get database URL from environment variables."""
    db_url = os.getenv("DATABASE_URL") or os.getenv("SUPABASE_DATABASE_URL")

    if not db_url:
        raise ValueError(
            "DATABASE_URL or SUPABASE_DATABASE_URL environment variable not set. "
            "Please set one of these variables with your PostgreSQL connection string."
        )

    # Handle Supabase format: postgres:// -> postgresql://
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)

    return db_url


def load_json_file(filepath: Path) -> Dict[str, Any]:
    """Load and parse JSON file."""
    logger.info(f"Loading {filepath.name}...")
    with open(filepath, 'r') as f:
        return json.load(f)


def get_category_id(cursor, category_name: str) -> str:
    """Get category ID by name."""
    cursor.execute(
        "SELECT id FROM public.reference_gene_set_categories WHERE name = %s",
        (category_name,)
    )
    result = cursor.fetchone()
    if not result:
        raise ValueError(f"Category '{category_name}' not found in database")
    return result[0]


def get_or_create_gene_set(
    cursor,
    name: str,
    category_id: str,
    metadata: Dict[str, Any]
) -> str:
    """Get existing gene set ID or create new one."""
    # Check if gene set already exists
    cursor.execute(
        """
        SELECT id FROM public.reference_gene_sets
        WHERE name = %s AND organism = %s
        """,
        (name, metadata.get('organism', 'Homo sapiens'))
    )
    result = cursor.fetchone()

    if result:
        gene_set_id = result[0]
        logger.info(f"  Gene set '{name}' already exists (ID: {gene_set_id})")

        # Update metadata
        cursor.execute(
            """
            UPDATE public.reference_gene_sets
            SET description = %s,
                source = %s,
                publication_year = %s,
                pubmed_id = %s,
                metadata = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                metadata.get('description'),
                metadata.get('source'),
                metadata.get('publication_year'),
                metadata.get('pubmed_id'),
                json.dumps(metadata),
                gene_set_id
            )
        )

        # Delete existing genes (will be re-inserted)
        cursor.execute(
            "DELETE FROM public.reference_genes WHERE gene_set_id = %s",
            (gene_set_id,)
        )
        logger.info(f"  Cleared existing genes for re-insertion")

    else:
        # Create new gene set
        cursor.execute(
            """
            INSERT INTO public.reference_gene_sets (
                name, category_id, description, source, organism,
                publication_year, pubmed_id, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                name,
                category_id,
                metadata.get('description'),
                metadata.get('source'),
                metadata.get('organism', 'Homo sapiens'),
                metadata.get('publication_year'),
                metadata.get('pubmed_id'),
                json.dumps(metadata)
            )
        )
        gene_set_id = cursor.fetchone()[0]
        logger.info(f"  Created gene set '{name}' (ID: {gene_set_id})")

    return gene_set_id


def insert_genes(cursor, gene_set_id: str, genes: List[str]):
    """Bulk insert genes for a gene set."""
    if not genes:
        logger.warning("  No genes to insert")
        return

    # Prepare data for bulk insert
    gene_data = [(gene_set_id, gene) for gene in genes]

    # Bulk insert using execute_values for better performance
    execute_values(
        cursor,
        """
        INSERT INTO public.reference_genes (gene_set_id, gene_symbol)
        VALUES %s
        ON CONFLICT (gene_set_id, gene_symbol) DO NOTHING
        """,
        gene_data,
        template="(%s, %s)"
    )

    logger.info(f"  Inserted {len(genes)} genes")


def seed_reference_set(cursor, filename: str, config: Dict[str, str]):
    """Seed a single reference gene set."""
    filepath = DATA_DIR / filename

    if not filepath.exists():
        logger.warning(f"File not found: {filepath}")
        return

    # Load JSON data
    data = load_json_file(filepath)
    metadata = data.get('metadata', {})
    genes = data.get('genes', [])

    logger.info(f"Processing {config['name']}...")
    logger.info(f"  Category: {config['category']}")
    logger.info(f"  Genes: {len(genes)}")

    # Get category ID
    category_id = get_category_id(cursor, config['category'])

    # Create or update gene set
    gene_set_id = get_or_create_gene_set(
        cursor,
        config['name'],
        category_id,
        metadata
    )

    # Insert genes
    insert_genes(cursor, gene_set_id, genes)

    logger.info(f"✓ Completed {config['name']}\n")


def verify_data(cursor):
    """Verify the seeded data."""
    logger.info("Verifying seeded data...")

    # Count categories
    cursor.execute("SELECT COUNT(*) FROM public.reference_gene_set_categories")
    category_count = cursor.fetchone()[0]
    logger.info(f"  Categories: {category_count}")

    # Count gene sets
    cursor.execute("SELECT COUNT(*) FROM public.reference_gene_sets")
    gene_set_count = cursor.fetchone()[0]
    logger.info(f"  Gene Sets: {gene_set_count}")

    # Count genes
    cursor.execute("SELECT COUNT(*) FROM public.reference_genes")
    gene_count = cursor.fetchone()[0]
    logger.info(f"  Total Genes: {gene_count}")

    # Show details per gene set
    cursor.execute(
        """
        SELECT
            rgs.name,
            rgsc.name as category,
            rgs.gene_count,
            COUNT(rg.id) as actual_count
        FROM public.reference_gene_sets rgs
        LEFT JOIN public.reference_gene_set_categories rgsc ON rgs.category_id = rgsc.id
        LEFT JOIN public.reference_genes rg ON rgs.id = rg.gene_set_id
        GROUP BY rgs.id, rgs.name, rgsc.name, rgs.gene_count
        ORDER BY rgsc.name, rgs.name
        """
    )

    logger.info("\n  Gene Set Details:")
    for row in cursor.fetchall():
        name, category, stored_count, actual_count = row
        status = "✓" if stored_count == actual_count else "⚠"
        logger.info(f"    {status} {name} ({category}): {actual_count} genes (stored: {stored_count})")

    logger.info("")


def main():
    """Main seeding function."""
    logger.info("=" * 70)
    logger.info("REFERENCE GENE SETS SEEDING SCRIPT")
    logger.info("=" * 70 + "\n")

    try:
        # Get database connection
        db_url = get_database_url()
        logger.info(f"Connecting to database...")

        # Connect to database
        conn = psycopg2.connect(db_url)
        conn.autocommit = False  # Use transactions
        cursor = conn.cursor()

        logger.info("✓ Connected successfully\n")

        # Seed each reference set
        for filename, config in REFERENCE_SETS.items():
            try:
                seed_reference_set(cursor, filename, config)
            except Exception as e:
                logger.error(f"✗ Error processing {filename}: {e}")
                logger.exception(e)
                conn.rollback()
                continue

        # Commit transaction
        logger.info("Committing changes...")
        conn.commit()
        logger.info("✓ Changes committed\n")

        # Verify data
        verify_data(cursor)

        # Close connection
        cursor.close()
        conn.close()

        logger.info("=" * 70)
        logger.info("✓ SEEDING COMPLETED SUCCESSFULLY!")
        logger.info("=" * 70)

    except Exception as e:
        logger.error(f"✗ Fatal error: {e}")
        logger.exception(e)
        sys.exit(1)


if __name__ == "__main__":
    main()
