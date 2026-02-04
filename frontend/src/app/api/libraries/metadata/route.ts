import { NextResponse } from 'next/server';
import bundledLibraries from '@/data/libraries-metadata.json';

export const dynamic = 'force-dynamic';

/**
 * GET /api/libraries/metadata
 *
 * Returns metadata for all available CRISPR libraries.
 * Uses bundled JSON so it works in all environments (dev, build, production).
 */
export async function GET() {
  const libraries = Array.isArray(bundledLibraries.libraries)
    ? bundledLibraries.libraries
    : [];

  return NextResponse.json(
    {
      success: true,
      libraries,
      count: libraries.length,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}
