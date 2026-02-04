import { NextResponse } from 'next/server';
import { getLibraryMetadata } from '@/lib/libraryLoader';

export const dynamic = 'force-dynamic';

/**
 * GET /api/libraries/metadata
 *
 * Returns metadata for all available CRISPR libraries
 */
export async function GET() {
  try {
    const libraries = getLibraryMetadata();

    return NextResponse.json(
      {
        success: true,
        libraries,
        count: libraries.length,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      }
    );
  } catch (error) {
    console.error('[API] Error loading library metadata:', error);

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to load library metadata',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
