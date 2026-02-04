import { NextRequest, NextResponse } from 'next/server';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function extractTag(xml: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = xml.indexOf(open);
  if (start === -1) return '';
  const from = start + open.length;
  const end = xml.indexOf(close, from);
  if (end === -1) return '';
  return xml.slice(from, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractAllTags(xml: string, tag: string): string[] {
  const results: string[] = [];
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let pos = 0;
  while (true) {
    const start = xml.indexOf(open, pos);
    if (start === -1) break;
    const from = start + open.length;
    const end = xml.indexOf(close, from);
    if (end === -1) break;
    results.push(xml.slice(from, end).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    pos = end + close.length;
  }
  return results;
}

function extractArticleId(xml: string, idType: string): string {
  const re = new RegExp(`<ArticleId IdType="${idType}">([^<]+)</ArticleId>`);
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

/**
 * GET /api/literature/pubmed/article?pmid=12345678
 * Fetches full article details including abstract from PubMed (efetch).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pmid = searchParams.get('pmid')?.trim();
    if (!pmid || !/^\d+$/.test(pmid)) {
      return NextResponse.json(
        { error: 'Missing or invalid pmid. Use ?pmid=12345678' },
        { status: 400 }
      );
    }

    const url = `${EUTILS}/efetch.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=xml`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return NextResponse.json({ error: 'PubMed efetch failed' }, { status: 502 });
    }
    const xmlText = await res.text();
    if (!xmlText.includes('<PubmedArticle>')) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const title = extractTag(xmlText, 'ArticleTitle');
    const abstractParts = extractAllTags(xmlText, 'AbstractText');
    const abstract = abstractParts.length > 0 ? abstractParts.join(' ') : '';
    const lastNames = extractAllTags(xmlText, 'LastName');
    const initialList = extractAllTags(xmlText, 'Initials');
    const authors = lastNames.map((last, i) => `${last} ${initialList[i] ?? ''}`.trim()).filter(Boolean);
    const journal = extractTag(xmlText, 'Title');
    const pubDate = extractTag(xmlText, 'PubDate');
    const year = pubDate ? parseInt(pubDate.slice(0, 4), 10) : undefined;
    const doi = extractArticleId(xmlText, 'doi');

    return NextResponse.json({
      pmid,
      title,
      abstract: abstract || null,
      authors,
      journal,
      year,
      doi: doi || null,
    });
  } catch (error) {
    console.error('PubMed article API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch article',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
