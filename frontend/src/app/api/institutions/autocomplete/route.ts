import { NextRequest, NextResponse } from 'next/server';

const ROR_API = 'https://api.ror.org/v2/organizations';
const MAX_RESULTS = 15;

export interface InstitutionOption {
  id: string;
  display_name: string;
  hint?: string;
}

/**
 * GET /api/institutions/autocomplete?q=...
 * Proxies to ROR (Research Organization Registry) for institution search.
 * Returns { results: InstitutionOption[] } for typeahead.
 */
export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q')?.trim();
    if (!q || q.length < 1) {
      return NextResponse.json({ results: [] });
    }

    const url = `${ROR_API}?query=${encodeURIComponent(q)}&page=1&items_per_page=${MAX_RESULTS}`;
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn('ROR API error:', res.status);
      return NextResponse.json({ results: [] });
    }

    const data = await res.json();
    let items = [];
    if (Array.isArray(data.items)) {
      items = data.items;
    } else if (data._embedded && Array.isArray(data._embedded.organizations)) {
      items = data._embedded.organizations;
    } else if (Array.isArray(data)) {
      items = data;
    }

    const results: InstitutionOption[] = items.slice(0, MAX_RESULTS).map((org: any) => {
      const names = org.names ?? [];
      const displayNameObj = names.find((n: any) => n.type === 'ror_display' || n.type === 'label') || names[0];
      const name = displayNameObj?.value ?? org.name ?? org.legal_name ?? '';
      const country = org.locations?.[0]?.geonames_details?.country_name ?? org.locations?.[0]?.country?.country_name ?? org.country?.country_name;
      const hint = country ? `${country}` : undefined;
      return {
        id: org.id || name,
        display_name: name,
        hint,
      };
    });

    return NextResponse.json({ results });
  } catch (err) {
    console.error('Institutions autocomplete error:', err);
    return NextResponse.json({ results: [] });
  }
}
