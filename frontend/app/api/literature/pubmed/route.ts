import { NextRequest, NextResponse } from 'next/server';
import type { PubMedArticle } from '@/types/ai.types';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

/**
 * GET /api/literature/pubmed?gene=TP53&limit=10
 * or /api/literature/pubmed?pdb=5F9R&limit=10 (structure-related papers)
 * or /api/literature/pubmed?pmid=12345678 (single article)
 * Proxies to NCBI E-utilities for PubMed search.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gene = searchParams.get('gene')?.trim();
    const pdb = searchParams.get('pdb')?.trim().toUpperCase();
    const pmid = searchParams.get('pmid')?.trim();
    const limit = Math.min(20, Math.max(1, parseInt(searchParams.get('limit') ?? '10', 10) || 10));

    if (pmid) {
      const url = `${EUTILS}/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json`;
      const res = await fetch(url);
      if (!res.ok) {
        return NextResponse.json({ error: 'PubMed summary failed' }, { status: 502 });
      }
      const data = await res.json();
      const result = data.result?.[pmid];
      if (!result) {
        return NextResponse.json({ error: 'Article not found' }, { status: 404 });
      }
      const article: PubMedArticle = {
        pmid: String(result.uid ?? pmid),
        title: result.title ?? '',
        authors: result.authors?.map((a: any) => a.name).join(', '),
        journal: result.source,
        year: result.pubdate ? parseInt(result.pubdate.slice(0, 4), 10) : undefined,
        doi: result.elocationid?.startsWith('doi:') ? result.elocationid.slice(4) : undefined,
      };
      return NextResponse.json({ articles: [article] });
    }

    // Structure/PDB search: papers mentioning this PDB ID (e.g. structure papers)
    if (pdb && pdb.length >= 4 && pdb.length <= 10) {
      // Try multiple search strategies to find relevant papers
      // 1. Search in Title/Abstract
      // 2. Use structure database link [PDB]
      const terms = [
        `${pdb}[Title/Abstract]`,
        `${pdb}[All Fields]`,
      ];
      
      let idList: string[] = [];
      
      // Try each search strategy until we find results
      for (const term of terms) {
        const searchUrl = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${limit}&retmode=json`;
        console.log(`[PubMed] Searching for PDB ${pdb} with term: ${term}`);
        
        const searchRes = await fetch(searchUrl);
        if (!searchRes.ok) {
          console.error(`[PubMed] Search failed for term: ${term}`);
          continue;
        }
        
        const searchData = await searchRes.json();
        idList = searchData.esearchresult?.idlist ?? [];
        console.log(`[PubMed] Found ${idList.length} results for term: ${term}`);
        
        if (idList.length > 0) {
          break; // Found results, stop searching
        }
      }
      
      if (idList.length === 0) {
        console.log(`[PubMed] No papers found for PDB: ${pdb}`);
        return NextResponse.json({ articles: [] });
      }
      const summaryUrl = `${EUTILS}/esummary.fcgi?db=pubmed&id=${idList.join(',')}&retmode=json`;
      console.log(`[PubMed] Fetching summaries for ${idList.length} articles`);
      
      const summaryRes = await fetch(summaryUrl);
      if (!summaryRes.ok) {
        console.error(`[PubMed] Summary fetch failed: ${summaryRes.status}`);
        return NextResponse.json({ articles: [] });
      }
      
      const summaryData = await summaryRes.json();
      const articles: PubMedArticle[] = idList.map((id: string) => {
        const r = summaryData.result?.[id] ?? {};
        return {
          pmid: String(r.uid ?? id),
          title: r.title ?? '',
          authors: r.authors?.map((a: any) => a.name).join(', '),
          journal: r.source,
          year: r.pubdate ? parseInt(String(r.pubdate).slice(0, 4), 10) : undefined,
          doi: r.elocationid?.startsWith('doi:') ? r.elocationid.slice(4) : undefined,
        };
      });
      
      console.log(`[PubMed] Successfully fetched ${articles.length} articles for PDB: ${pdb}`);
      return NextResponse.json({ articles });
    }

    if (!gene || gene.length > 50) {
      return NextResponse.json(
        { error: 'Missing or invalid gene. Use ?gene=TP53, ?pdb=5F9R, or ?pmid=12345678' },
        { status: 400 }
      );
    }

    const term = `${gene}[Title/Abstract] AND CRISPR`;
    const searchUrl = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=${limit}&retmode=json`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) {
      return NextResponse.json({ error: 'PubMed search failed' }, { status: 502 });
    }
    const searchData = await searchRes.json();
    const idList = searchData.esearchresult?.idlist ?? [];
    if (idList.length === 0) {
      return NextResponse.json({ articles: [] });
    }

    const summaryUrl = `${EUTILS}/esummary.fcgi?db=pubmed&id=${idList.join(',')}&retmode=json`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) {
      return NextResponse.json({ articles: [] });
    }
    const summaryData = await summaryRes.json();
    const articles: PubMedArticle[] = idList.map((id: string) => {
      const r = summaryData.result?.[id] ?? {};
      return {
        pmid: String(r.uid ?? id),
        title: r.title ?? '',
        authors: r.authors?.map((a: any) => a.name).join(', '),
        journal: r.source,
        year: r.pubdate ? parseInt(String(r.pubdate).slice(0, 4), 10) : undefined,
        doi: r.elocationid?.startsWith('doi:') ? r.elocationid.slice(4) : undefined,
      };
    });

    return NextResponse.json({ articles });
  } catch (error) {
    console.error('PubMed API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch literature',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
