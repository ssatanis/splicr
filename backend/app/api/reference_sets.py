"""
Reference Gene Sets API Endpoints

Provides access to reference gene sets for CRISPR screen analysis,
including essential genes, non-essential genes, cancer drivers, etc.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List, Optional
from pydantic import BaseModel, Field
from uuid import UUID
import logging

from ..database import get_db
from sqlalchemy.orm import Session
from sqlalchemy import text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reference-sets", tags=["Reference Gene Sets"])


# ============================================================================
# PYDANTIC MODELS
# ============================================================================

class GeneInfo(BaseModel):
    """Individual gene in a reference set."""
    id: UUID
    gene_symbol: str
    gene_id: Optional[str] = None
    ensembl_id: Optional[str] = None
    score: Optional[float] = None
    rank: Optional[int] = None
    metadata: Optional[dict] = None

    class Config:
        from_attributes = True


class ReferenceGeneSetSummary(BaseModel):
    """Summary info for a reference gene set."""
    id: UUID
    name: str
    description: Optional[str] = None
    source: Optional[str] = None
    organism: str
    gene_count: int
    publication_year: Optional[int] = None
    pubmed_id: Optional[str] = None
    is_active: bool
    category_name: Optional[str] = None
    category_description: Optional[str] = None
    metadata: Optional[dict] = None

    class Config:
        from_attributes = True


class ReferenceGeneSetDetail(ReferenceGeneSetSummary):
    """Detailed info including all genes."""
    genes: List[GeneInfo] = Field(default_factory=list)


class CategorySummary(BaseModel):
    """Reference gene set category."""
    id: UUID
    name: str
    description: Optional[str] = None
    gene_set_count: int = 0

    class Config:
        from_attributes = True


class GeneSetCheckResult(BaseModel):
    """Result of checking if genes are in a reference set."""
    gene_set_id: UUID
    gene_set_name: str
    total_genes_in_set: int
    matched_genes: List[str]
    matched_count: int
    unmatched_genes: List[str]
    unmatched_count: int
    overlap_percentage: float


# ============================================================================
# API ENDPOINTS
# ============================================================================

@router.get("/categories", response_model=List[CategorySummary])
async def get_categories(
    db: Session = Depends(get_db)
):
    """
    Get all reference gene set categories.

    Returns:
        List of categories with gene set counts
    """
    try:
        query = text("""
            SELECT
                c.id,
                c.name,
                c.description,
                COUNT(rgs.id) as gene_set_count
            FROM public.reference_gene_set_categories c
            LEFT JOIN public.reference_gene_sets rgs ON c.id = rgs.category_id
            GROUP BY c.id, c.name, c.description
            ORDER BY c.name
        """)

        result = db.execute(query)
        categories = [
            CategorySummary(
                id=row.id,
                name=row.name,
                description=row.description,
                gene_set_count=row.gene_set_count
            )
            for row in result
        ]

        return categories

    except Exception as e:
        logger.error(f"Error fetching categories: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gene-sets", response_model=List[ReferenceGeneSetSummary])
async def list_gene_sets(
    category: Optional[str] = Query(None, description="Filter by category name"),
    organism: str = Query("Homo sapiens", description="Filter by organism"),
    active_only: bool = Query(True, description="Only return active gene sets"),
    db: Session = Depends(get_db)
):
    """
    List all reference gene sets with optional filtering.

    Args:
        category: Filter by category name (Essential, Non-Essential, etc.)
        organism: Filter by organism (default: Homo sapiens)
        active_only: Only return active gene sets (default: True)

    Returns:
        List of reference gene sets
    """
    try:
        # Build query with filters
        query_str = """
            SELECT *
            FROM public.reference_gene_sets_with_category
            WHERE 1=1
        """
        params = {}

        if organism:
            query_str += " AND organism = :organism"
            params['organism'] = organism

        if category:
            query_str += " AND category_name = :category"
            params['category'] = category

        if active_only:
            query_str += " AND is_active = true"

        query_str += " ORDER BY category_name, name"

        result = db.execute(text(query_str), params)

        gene_sets = [
            ReferenceGeneSetSummary(
                id=row.id,
                name=row.name,
                description=row.description,
                source=row.source,
                organism=row.organism,
                gene_count=row.gene_count or 0,
                publication_year=row.publication_year,
                pubmed_id=row.pubmed_id,
                is_active=row.is_active,
                category_name=row.category_name,
                category_description=row.category_description,
                metadata=row.metadata
            )
            for row in result
        ]

        return gene_sets

    except Exception as e:
        logger.error(f"Error listing gene sets: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gene-sets/{gene_set_id}", response_model=ReferenceGeneSetDetail)
async def get_gene_set(
    gene_set_id: UUID,
    include_genes: bool = Query(True, description="Include full gene list"),
    limit: Optional[int] = Query(None, description="Limit number of genes returned"),
    db: Session = Depends(get_db)
):
    """
    Get detailed information about a specific gene set.

    Args:
        gene_set_id: UUID of the gene set
        include_genes: Whether to include full gene list (default: True)
        limit: Maximum number of genes to return (default: all)

    Returns:
        Detailed gene set information with genes
    """
    try:
        # Get gene set info
        set_query = text("""
            SELECT *
            FROM public.reference_gene_sets_with_category
            WHERE id = :gene_set_id
        """)

        set_result = db.execute(set_query, {"gene_set_id": str(gene_set_id)}).fetchone()

        if not set_result:
            raise HTTPException(status_code=404, detail="Gene set not found")

        gene_set = ReferenceGeneSetDetail(
            id=set_result.id,
            name=set_result.name,
            description=set_result.description,
            source=set_result.source,
            organism=set_result.organism,
            gene_count=set_result.gene_count or 0,
            publication_year=set_result.publication_year,
            pubmed_id=set_result.pubmed_id,
            is_active=set_result.is_active,
            category_name=set_result.category_name,
            category_description=set_result.category_description,
            metadata=set_result.metadata,
            genes=[]
        )

        # Get genes if requested
        if include_genes:
            genes_query = """
                SELECT id, gene_symbol, gene_id, ensembl_id, score, rank, metadata
                FROM public.reference_genes
                WHERE gene_set_id = :gene_set_id
                ORDER BY rank NULLS LAST, gene_symbol
            """

            if limit:
                genes_query += f" LIMIT {limit}"

            genes_result = db.execute(
                text(genes_query),
                {"gene_set_id": str(gene_set_id)}
            )

            gene_set.genes = [
                GeneInfo(
                    id=row.id,
                    gene_symbol=row.gene_symbol,
                    gene_id=row.gene_id,
                    ensembl_id=row.ensembl_id,
                    score=float(row.score) if row.score else None,
                    rank=row.rank,
                    metadata=row.metadata
                )
                for row in genes_result
            ]

        return gene_set

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching gene set {gene_set_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/gene-sets/by-name/{name}", response_model=ReferenceGeneSetDetail)
async def get_gene_set_by_name(
    name: str,
    organism: str = Query("Homo sapiens", description="Organism"),
    include_genes: bool = Query(True, description="Include full gene list"),
    db: Session = Depends(get_db)
):
    """
    Get gene set by name and organism.

    Args:
        name: Name of the gene set (e.g., "Hart Core Essential 2015")
        organism: Organism (default: Homo sapiens)
        include_genes: Whether to include full gene list (default: True)

    Returns:
        Detailed gene set information
    """
    try:
        # Get gene set ID by name
        query = text("""
            SELECT id
            FROM public.reference_gene_sets
            WHERE name = :name AND organism = :organism
        """)

        result = db.execute(query, {"name": name, "organism": organism}).fetchone()

        if not result:
            raise HTTPException(
                status_code=404,
                detail=f"Gene set '{name}' not found for {organism}"
            )

        # Use the existing get_gene_set endpoint
        return await get_gene_set(
            gene_set_id=result.id,
            include_genes=include_genes,
            db=db
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching gene set by name '{name}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gene-sets/{gene_set_id}/check", response_model=GeneSetCheckResult)
async def check_genes_in_set(
    gene_set_id: UUID,
    genes: List[str],
    db: Session = Depends(get_db)
):
    """
    Check which genes from a list are in a reference gene set.

    Useful for checking overlap with essential genes, cancer drivers, etc.

    Args:
        gene_set_id: UUID of the gene set to check against
        genes: List of gene symbols to check

    Returns:
        Overlap analysis with matched and unmatched genes
    """
    try:
        if not genes:
            raise HTTPException(status_code=400, detail="Gene list cannot be empty")

        # Get gene set info
        set_query = text("""
            SELECT name, gene_count
            FROM public.reference_gene_sets
            WHERE id = :gene_set_id
        """)

        set_result = db.execute(set_query, {"gene_set_id": str(gene_set_id)}).fetchone()

        if not set_result:
            raise HTTPException(status_code=404, detail="Gene set not found")

        # Check which genes are in the set
        check_query = text("""
            SELECT gene_symbol
            FROM public.reference_genes
            WHERE gene_set_id = :gene_set_id
              AND gene_symbol = ANY(:genes)
        """)

        matched_result = db.execute(
            check_query,
            {"gene_set_id": str(gene_set_id), "genes": genes}
        )

        matched_genes = [row.gene_symbol for row in matched_result]
        unmatched_genes = [g for g in genes if g not in matched_genes]

        overlap_percentage = (len(matched_genes) / len(genes) * 100) if genes else 0

        return GeneSetCheckResult(
            gene_set_id=gene_set_id,
            gene_set_name=set_result.name,
            total_genes_in_set=set_result.gene_count or 0,
            matched_genes=matched_genes,
            matched_count=len(matched_genes),
            unmatched_genes=unmatched_genes,
            unmatched_count=len(unmatched_genes),
            overlap_percentage=round(overlap_percentage, 2)
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking genes in set {gene_set_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/genes/search", response_model=List[GeneInfo])
async def search_genes(
    query: str = Query(..., min_length=1, description="Gene symbol to search"),
    gene_set_id: Optional[UUID] = Query(None, description="Filter by gene set"),
    limit: int = Query(50, le=1000, description="Max results to return"),
    db: Session = Depends(get_db)
):
    """
    Search for genes across all reference sets.

    Args:
        query: Gene symbol or partial match (case-insensitive)
        gene_set_id: Optional filter by specific gene set
        limit: Maximum number of results (default: 50, max: 1000)

    Returns:
        List of matching genes
    """
    try:
        search_query = """
            SELECT DISTINCT ON (gene_symbol)
                id, gene_symbol, gene_id, ensembl_id, score, rank, metadata
            FROM public.reference_genes
            WHERE gene_symbol ILIKE :query
        """
        params = {"query": f"%{query}%"}

        if gene_set_id:
            search_query += " AND gene_set_id = :gene_set_id"
            params["gene_set_id"] = str(gene_set_id)

        search_query += f" ORDER BY gene_symbol LIMIT {limit}"

        result = db.execute(text(search_query), params)

        genes = [
            GeneInfo(
                id=row.id,
                gene_symbol=row.gene_symbol,
                gene_id=row.gene_id,
                ensembl_id=row.ensembl_id,
                score=float(row.score) if row.score else None,
                rank=row.rank,
                metadata=row.metadata
            )
            for row in result
        ]

        return genes

    except Exception as e:
        logger.error(f"Error searching genes with query '{query}': {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=dict)
async def get_stats(db: Session = Depends(get_db)):
    """
    Get overall statistics about reference gene sets.

    Returns:
        Statistics including counts of categories, gene sets, and genes
    """
    try:
        stats_query = text("""
            SELECT
                (SELECT COUNT(*) FROM public.reference_gene_set_categories) as total_categories,
                (SELECT COUNT(*) FROM public.reference_gene_sets WHERE is_active = true) as active_gene_sets,
                (SELECT COUNT(*) FROM public.reference_gene_sets) as total_gene_sets,
                (SELECT COUNT(*) FROM public.reference_genes) as total_genes,
                (SELECT COUNT(DISTINCT gene_symbol) FROM public.reference_genes) as unique_genes
        """)

        result = db.execute(stats_query).fetchone()

        return {
            "total_categories": result.total_categories,
            "active_gene_sets": result.active_gene_sets,
            "total_gene_sets": result.total_gene_sets,
            "total_genes": result.total_genes,
            "unique_genes": result.unique_genes
        }

    except Exception as e:
        logger.error(f"Error fetching stats: {e}")
        raise HTTPException(status_code=500, detail=str(e))
