import { NextRequest, NextResponse } from 'next/server';

const ORCID_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

function normalizeOrcid(id: string): string {
  const digits = id.replace(/-/g, '').trim().toUpperCase();
  if (digits.length !== 16) return '';
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}`;
}

/**
 * GET /api/orcid/verify?orcid=0000-0000-0000-0000
 * Verifies that an ORCID iD exists by calling the public ORCID API.
 * Returns { valid: boolean, orcid?: string }.
 */
export async function GET(request: NextRequest) {
  try {
    const orcidParam = request.nextUrl.searchParams.get('orcid')?.trim();
    if (!orcidParam) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const orcid = normalizeOrcid(orcidParam);
    if (!orcid || !ORCID_REGEX.test(orcid)) {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    const res = await fetch(`https://pub.orcid.org/v3.0/${orcid}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });

    if (res.status === 200) {
      return NextResponse.json({ valid: true, orcid });
    }
    if (res.status === 404) {
      return NextResponse.json({ valid: false });
    }
    return NextResponse.json({ valid: false });
  } catch {
    return NextResponse.json({ valid: false });
  }
}
