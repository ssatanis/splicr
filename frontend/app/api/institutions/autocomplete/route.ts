import { NextResponse } from 'next/server';

const OPENALEX_AUTOCOMPLETE = 'https://api.openalex.org/autocomplete/institutions';

export interface OpenAlexInstitutionResult {
  id: string;
  display_name: string;
  hint?: string;
  cited_by_count?: number;
  works_count?: number;
  entity_type: string;
  external_id?: string;
}

export interface AutocompleteResponse {
  results: { id: string; display_name: string; hint?: string }[];
}

/**
 * Proxy OpenAlex institution autocomplete (no API key required).
 * Used for sign-up institution field type-ahead.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    const url = new URL(OPENALEX_AUTOCOMPLETE);
    url.searchParams.set('q', q);
    url.searchParams.set('per-page', '15');

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      next: { revalidate: 300 }, // cache 5 min
    });

    if (!res.ok) {
      console.error('OpenAlex autocomplete error:', res.status, await res.text());
      return NextResponse.json({ results: [] }, { status: 200 });
    }

    const data = (await res.json()) as {
      results?: OpenAlexInstitutionResult[];
    };
    const results = (data.results ?? []).map((r) => ({
      id: r.id,
      display_name: r.display_name,
      hint: r.hint,
    }));

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Institutions autocomplete error:', err);
    return NextResponse.json({ results: [] }, { status: 200 });
  }
}
