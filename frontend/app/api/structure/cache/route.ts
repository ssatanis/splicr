import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const CACHE_DAYS = 30;
const CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

/**
 * GET /api/structure/cache?gene=TP53
 * Returns cached PDB matches and AlphaFold ID for a gene if fresh.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gene = searchParams.get('gene')?.trim().toUpperCase();
    if (!gene || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ cached: false });
    }

    const { data: row, error } = await (supabaseAdmin as any)
      .from('structure_cache')
      .select('pdb_matches, alphafold_id, last_updated')
      .eq('gene_name', gene)
      .maybeSingle();

    if (error || !row) {
      return NextResponse.json({ cached: false });
    }

    const lastUpdated = row.last_updated ? new Date(row.last_updated).getTime() : 0;
    if (Date.now() - lastUpdated > CACHE_MS) {
      return NextResponse.json({ cached: false, stale: true });
    }

    return NextResponse.json({
      cached: true,
      gene_name: gene,
      pdb_matches: row.pdb_matches ?? [],
      alphafold_id: row.alphafold_id ?? null,
      last_updated: row.last_updated,
    });
  } catch (error) {
    return NextResponse.json({ cached: false });
  }
}

/**
 * POST /api/structure/cache
 * Body: { gene_name: string, pdb_matches: string[], alphafold_id?: string }
 * Upserts structure cache for a gene.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: 'Cache not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const geneName = (body.gene_name ?? body.gene ?? '').trim().toUpperCase();
    if (!geneName || geneName.length > 30) {
      return NextResponse.json({ error: 'Invalid gene_name' }, { status: 400 });
    }

    const pdbMatches = Array.isArray(body.pdb_matches) ? body.pdb_matches : [];
    const alphafoldId = body.alphafold_id ?? null;
    const now = new Date().toISOString();

    const { error } = await (supabaseAdmin as any)
      .from('structure_cache')
      .upsert(
        {
          gene_name: geneName,
          pdb_matches: pdbMatches,
          alphafold_id: alphafoldId,
          last_updated: now,
          cache_version: 1,
        },
        { onConflict: 'gene_name' }
      );

    if (error) {
      console.error('Structure cache upsert error:', error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, gene_name: geneName });
  } catch (error) {
    console.error('Structure cache API error:', error);
    return NextResponse.json(
      { ok: false, details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
