import { NextRequest, NextResponse } from 'next/server';

const RCSB_PDB = 'https://files.rcsb.org/download';
const ALPHAFOLD_PDB = 'https://alphafold.ebi.ac.uk/files';

/**
 * GET /api/structure/download?type=pdb&id=5F9R
 * GET /api/structure/download?type=alphafold&id=Q99ZW2
 *
 * Proxies PDB/AlphaFold file fetch server-side to bypass CORS and any
 * client-side restrictions. Returns the raw structure file.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type')?.toLowerCase();
    const id = searchParams.get('id')?.trim().toUpperCase();

    if (!type || !id) {
      return NextResponse.json(
        { error: 'Missing type or id. Use ?type=pdb&id=5F9R or ?type=alphafold&id=Q99ZW2' },
        { status: 400 }
      );
    }

    let url: string;
    if (type === 'pdb') {
      if (id.length < 4 || id.length > 10) {
        return NextResponse.json({ error: 'Invalid PDB ID' }, { status: 400 });
      }
      url = `${RCSB_PDB}/${id}.pdb`;
    } else if (type === 'alphafold') {
      if (id.length < 6 || id.length > 20) {
        return NextResponse.json({ error: 'Invalid UniProt ID' }, { status: 400 });
      }
      url = `${ALPHAFOLD_PDB}/AF-${id}-F1-model_v4.pdb`;
    } else {
      return NextResponse.json(
        { error: 'Invalid type. Use pdb or alphafold' },
        { status: 400 }
      );
    }

    const res = await fetch(url, {
      headers: { Accept: 'text/plain, application/octet-stream' },
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: res.status === 404 ? 'Structure not found' : `Upstream error: ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }

    const contentType = res.headers.get('content-type') || 'text/plain';
    const body = await res.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('Structure download proxy error:', err);
    return NextResponse.json(
      {
        error: 'Failed to fetch structure',
        details: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
