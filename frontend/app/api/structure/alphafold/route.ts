import { NextRequest, NextResponse } from 'next/server';

const UNIPROT_SEARCH = 'https://rest.uniprot.org/uniprotkb/search';
const ALPHAFOLD_PDB_PREFIX = 'https://alphafold.ebi.ac.uk/files/AF-';
const ALPHAFOLD_PDB_SUFFIX = '-F1-model_v4.pdb';

/**
 * GET /api/structure/alphafold?gene=TP53
 * Resolves gene symbol to UniProt ID (human) and checks AlphaFold DB availability.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const gene = searchParams.get('gene')?.trim().toUpperCase();
    if (!gene || gene.length > 30) {
      return NextResponse.json(
        { error: 'Missing or invalid gene. Use ?gene=TP53' },
        { status: 400 }
      );
    }

    const query = `query=gene:${encodeURIComponent(gene)}+AND+organism_id:9606&format=json&size=1&fields=primary_accession,gene_names`;
    const uniprotRes = await fetch(`${UNIPROT_SEARCH}?${query}`, {
      headers: { Accept: 'application/json' },
    });

    if (!uniprotRes.ok) {
      return NextResponse.json(
        { error: 'UniProt lookup failed', details: await uniprotRes.text().then((t) => t.slice(0, 200)) },
        { status: 502 }
      );
    }

    const uniprotData = await uniprotRes.json();
    const results = uniprotData?.results ?? [];
    const first = results[0];
    const uniprotId = first?.primaryAccession ?? first?.uniProtkbId;
    if (!uniprotId) {
      return NextResponse.json({ available: false, gene, uniprotId: null, url: null });
    }

    const afUrl = `${ALPHAFOLD_PDB_PREFIX}${uniprotId}${ALPHAFOLD_PDB_SUFFIX}`;
    const headRes = await fetch(afUrl, { method: 'HEAD' });
    const available = headRes.ok;

    return NextResponse.json({
      available,
      gene,
      uniprotId,
      url: available ? afUrl : null,
    });
  } catch (error) {
    console.error('AlphaFold API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check AlphaFold',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
