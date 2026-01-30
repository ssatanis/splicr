import { NextResponse } from 'next/server';

const OPENALEX_AUTOCOMPLETE = 'https://api.openalex.org/autocomplete/institutions';
const OPENALEX_INSTITUTIONS_SEARCH = 'https://api.openalex.org/institutions';

export interface OpenAlexInstitutionResult {
  id: string;
  display_name: string;
  hint?: string;
  cited_by_count?: number;
  works_count?: number;
  entity_type?: string;
  external_id?: string;
}

function mapResult(r: OpenAlexInstitutionResult) {
  return { id: r.id, display_name: r.display_name, hint: r.hint };
}

/**
 * Proxy OpenAlex institution autocomplete (no API key required).
 * Tries autocomplete first, then search endpoint as fallback.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  if (!q || q.length < 1) {
    return NextResponse.json({ results: [] });
  }

  try {
    const autocompleteUrl = new URL(OPENALEX_AUTOCOMPLETE);
    autocompleteUrl.searchParams.set('q', q);
    autocompleteUrl.searchParams.set('per-page', '15');

    const autocompleteRes = await fetch(autocompleteUrl.toString(), {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });

    if (autocompleteRes.ok) {
      const data = (await autocompleteRes.json()) as { results?: OpenAlexInstitutionResult[] };
      const results = (data.results ?? []).map(mapResult);
      if (results.length > 0) {
        return NextResponse.json({ results });
      }
    }

    const searchUrl = new URL(OPENALEX_INSTITUTIONS_SEARCH);
    searchUrl.searchParams.set('search', q);
    searchUrl.searchParams.set('per-page', '15');

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 },
    });

    if (!searchRes.ok) {
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    const searchData = (await searchRes.json()) as { results?: OpenAlexInstitutionResult[] };
    const results = (searchData.results ?? []).map(mapResult);
    return NextResponse.json({ results });
  } catch (err) {
    console.error('Institutions autocomplete error:', err);
    return NextResponse.json({ results: [] }, { status: 200 });
  }
}
