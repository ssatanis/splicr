import { NextRequest, NextResponse } from 'next/server';

/**
 * Literature API - Fetches papers from PubMed for a gene
 */

interface PubMedArticle {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string;
  abstract?: string;
  doi?: string;
  citationCount?: number;
  link: string;
}

function isValidGeneSymbol(s: string): boolean {
  return /^[A-Za-z0-9\-\.]+$/.test(s) && s.length >= 1 && s.length <= 30;
}

async function fetchPubMedArticles(gene: string, maxResults: number = 10): Promise<PubMedArticle[]> {
  try {
    // Search PubMed for gene-related articles
    const searchQuery = encodeURIComponent(`${gene}[Gene Symbol] AND human[Organism] AND (function OR pathway OR CRISPR)`);
    const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${searchQuery}&retmax=${maxResults}&retmode=json&sort=relevance`;
    
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error('PubMed search failed');
    
    const searchData = await searchRes.json();
    const pmids = searchData.esearchresult?.idlist || [];
    
    if (pmids.length === 0) {
      return [];
    }

    // Fetch article details
    const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids.join(',')}&retmode=json`;
    const fetchRes = await fetch(fetchUrl);
    if (!fetchRes.ok) throw new Error('PubMed fetch failed');
    
    const fetchData = await fetchRes.json();
    const articles: PubMedArticle[] = [];

    for (const pmid of pmids) {
      const article = fetchData.result?.[pmid];
      if (!article) continue;

      const authors = article.authors
        ?.slice(0, 3)
        .map((a: any) => a.name)
        .join(', ') || 'Unknown';
      
      const year = article.pubdate?.split(' ')[0] || '';
      const doi = article.elocationid?.startsWith('doi:') 
        ? article.elocationid.replace('doi: ', '')
        : article.articleids?.find((id: any) => id.idtype === 'doi')?.value;

      articles.push({
        pmid,
        title: article.title || 'No title',
        authors: authors + (article.authors?.length > 3 ? ' et al.' : ''),
        journal: article.fulljournalname || article.source || 'Unknown journal',
        year,
        doi,
        link: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
      });
    }

    return articles;
  } catch (error) {
    console.error('Error fetching PubMed articles:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gene = searchParams.get('gene')?.trim().toUpperCase();
    const maxResults = Math.min(parseInt(searchParams.get('limit') || '10'), 25);

    if (!gene || !isValidGeneSymbol(gene)) {
      return NextResponse.json(
        { error: 'Missing or invalid gene symbol', details: 'Use ?gene=TP53' },
        { status: 400 }
      );
    }

    const articles = await fetchPubMedArticles(gene, maxResults);

    return NextResponse.json({
      gene,
      count: articles.length,
      articles,
    });
  } catch (error) {
    console.error('Literature API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch literature data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
