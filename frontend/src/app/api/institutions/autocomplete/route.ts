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

    // 1. Local Search (institutions.json)
    // We try to find this file during build or runtime. 
    // Since we are in an API route, we can read it from the filesystem if we know the path.
    // However, in Vercel/Next.js properly importing it is safer.
    // We'll trust the user has placed it in `src/data/institutions.json`.

    let localResults: InstitutionOption[] = [];
    try {
      // Dynamic import to avoid build errors if file is missing
      const localData = await import('@/data/institutions.json');
      const allInstitutions = Array.isArray((localData as any).default) ? (localData as any).default : [];

      const lowerQ = q.toLowerCase();
      localResults = allInstitutions
        .filter((inst: any) => {
          const name = (inst.name || inst.display_name || '').toLowerCase();
          return name.includes(lowerQ);
        })
        .slice(0, 5) // Take top 5 local matches
        .map((inst: any) => ({
          id: inst.name || inst.display_name,
          display_name: inst.name || inst.display_name,
          hint: inst.country || inst.location || 'Local',
        }));
    } catch (e) {
      // Ignore if file not found
    }

    // 2. OpenAlex API
    const url = `https://api.openalex.org/institutions?search=${encodeURIComponent(q)}&per-page=${MAX_RESULTS}`;

    let apiResults: InstitutionOption[] = [];
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json();
        const items = data.results || [];
        apiResults = items.map((org: any) => {
          const displayName = org.display_name || 'Unknown';
          const country = org.geo?.country || org.country_code || '';
          const city = org.geo?.city || '';
          const hint = [city, country].filter(Boolean).join(', ');

          return {
            id: displayName,
            display_name: displayName,
            hint: hint,
          };
        });
      }
    } catch (e) {
      console.warn('OpenAlex API error:', e);
    }

    // Combine: Local first, then API (deduplicated by display_name)
    const combined = [...localResults];
    const localNames = new Set(localResults.map(r => r.display_name.toLowerCase()));

    for (const res of apiResults) {
      if (!localNames.has(res.display_name.toLowerCase())) {
        combined.push(res);
      }
    }

    return NextResponse.json({ results: combined.slice(0, MAX_RESULTS) });
  } catch (err) {
    console.error('Institutions autocomplete error:', err);
    return NextResponse.json({ results: [] });
  }
}
