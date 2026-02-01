import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

const CACHE_DAYS = 7;
const GENE_INFO_CACHE_MS = CACHE_DAYS * 24 * 60 * 60 * 1000;

function isValidGeneSymbol(s: string): boolean {
  return /^[A-Za-z0-9\-\.]+$/.test(s) && s.length >= 1 && s.length <= 30;
}

function formatGeneInfo(raw: any): Record<string, unknown> {
  const entrezId = raw.entrezgene ?? raw._id;
  const ensembl = raw.ensembl ?? {};
  const ensemblId = Array.isArray(ensembl.gene)
    ? ensembl.gene[0]
    : typeof ensembl.gene === 'string'
      ? ensembl.gene
      : raw.ensembl?.gene;

  const uniprot = raw.uniprot ?? {};
  const uniprotId = typeof uniprot === 'string' ? uniprot : uniprot['Swiss-Prot'] ?? Object.values(uniprot)[0];

  const genomicPos = raw.genomic_pos ?? raw.genomic_pos_hg19 ?? {};
  const loc = Array.isArray(genomicPos) ? genomicPos[0] : genomicPos;

  const pathway = raw.pathway ?? {};
  const pathways: { source: string; name: string; id: string }[] = [];
  if (pathway.kegg) {
    const k = pathway.kegg;
    (Array.isArray(k) ? k : [k]).forEach((p: any) => {
      if (p.name && p.id) pathways.push({ source: 'KEGG', name: p.name, id: p.id });
    });
  }
  if (pathway.reactome) {
    const r = pathway.reactome;
    (Array.isArray(r) ? r : [r]).forEach((p: any) => {
      if (p.name && p.id) pathways.push({ source: 'Reactome', name: typeof p === 'string' ? p : p.name, id: typeof p === 'string' ? p : p.id });
    });
  }

  const go = raw.go ?? {};
  const goTerms: { BP: { id: string; term: string }[]; MF: { id: string; term: string }[]; CC: { id: string; term: string }[] } = {
    BP: [],
    MF: [],
    CC: [],
  };
  const bp = go.BP?.term ?? go['GO:0008150'] ?? [];
  (Array.isArray(bp) ? bp : [bp]).forEach((t: any) => {
    const id = t.id ?? t;
    const term = typeof t === 'string' ? t : t.term ?? t;
    if (id && term) goTerms.BP.push({ id: String(id), term: String(term) });
  });
  const mf = go.MF?.term ?? go['GO:0003674'] ?? [];
  (Array.isArray(mf) ? mf : [mf]).forEach((t: any) => {
    const id = t.id ?? t;
    const term = typeof t === 'string' ? t : t.term ?? t;
    if (id && term) goTerms.MF.push({ id: String(id), term: String(term) });
  });
  const cc = go.CC?.term ?? go['GO:0005575'] ?? [];
  (Array.isArray(cc) ? cc : [cc]).forEach((t: any) => {
    const id = t.id ?? t;
    const term = typeof t === 'string' ? t : t.term ?? t;
    if (id && term) goTerms.CC.push({ id: String(id), term: String(term) });
  });

  const interpro = raw.interpro ?? [];
  const proteinDomains: { source: string; id: string; name: string }[] = (Array.isArray(interpro) ? interpro : [interpro])
    .filter(Boolean)
    .map((d: any) => ({
      source: 'InterPro',
      id: d.id ?? d,
      name: typeof d === 'string' ? d : d.short ?? d.desc ?? d.id ?? '',
    }));

  const pfam = raw.pfam ?? [];
  (Array.isArray(pfam) ? pfam : [pfam]).filter(Boolean).forEach((d: any) => {
    proteinDomains.push({
      source: 'Pfam',
      id: d.interpro ?? d.id ?? '',
      name: typeof d === 'string' ? d : d.name ?? d.desc ?? '',
    });
  });

  const aliases = [
    ...(Array.isArray(raw.alias) ? raw.alias : raw.alias ? [raw.alias] : []),
    ...(Array.isArray(raw.other_names) ? raw.other_names : raw.other_names ? [raw.other_names] : []),
  ].filter(Boolean);

  const ncbiId = entrezId ? String(entrezId) : '';
  const symbol = raw.symbol ?? raw._id ?? '';

  return {
    symbol: symbol,
    name: raw.name ?? '',
    entrezId: entrezId ? Number(entrezId) : null,
    ensemblId: ensemblId ?? null,
    uniprotId: uniprotId ?? null,
    summary: raw.summary ?? raw.generif?.[0]?.text ?? null,
    aliases: [...new Set(aliases)].slice(0, 20),
    location: loc
      ? {
          chromosome: loc.chr ?? null,
          start: loc.start ?? null,
          end: loc.end ?? null,
          strand: loc.strand ?? null,
        }
      : null,
    pathways: pathways.length ? pathways : null,
    goTerms,
    proteinDomains: proteinDomains.length ? proteinDomains : null,
    links: {
      ncbi: ncbiId ? `https://www.ncbi.nlm.nih.gov/gene/${ncbiId}` : null,
      ensembl: ensemblId ? `https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=${ensemblId}` : null,
      uniprot: uniprotId ? `https://www.uniprot.org/uniprot/${uniprotId}` : null,
      genecards: symbol ? `https://www.genecards.org/cgi-bin/carddisp.pl?gene=${encodeURIComponent(symbol)}` : null,
    },
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol')?.trim().toUpperCase();
    if (!symbol || !isValidGeneSymbol(symbol)) {
      return NextResponse.json(
        { error: 'Missing or invalid gene symbol', details: 'Use ?symbol=TP53' },
        { status: 400 }
      );
    }

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Server configuration error', details: 'Supabase not configured' },
        { status: 500 }
      );
    }

    const { data: cachedRow } = await supabaseAdmin
      .from('gene_info_cache')
      .select('data, cached_at')
      .eq('gene_symbol', symbol)
      .maybeSingle();
    const cached = cachedRow as { data: unknown; cached_at: string } | null;
    const cachedAt = cached?.cached_at ? new Date(cached.cached_at).getTime() : 0;
    if (cached && Date.now() - cachedAt < GENE_INFO_CACHE_MS) {
      return NextResponse.json(cached.data as Record<string, unknown>);
    }

    const queryRes = await fetch(
      `https://mygene.info/v3/query?q=symbol:${encodeURIComponent(symbol)}&species=human&size=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (!queryRes.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch gene from MyGene.info', details: queryRes.statusText },
        { status: 502 }
      );
    }
    const queryData = await queryRes.json();
    const hit = queryData?.hits?.[0];
    if (!hit) {
      return NextResponse.json(
        { error: 'Gene not found', details: `No human gene found for symbol: ${symbol}` },
        { status: 404 }
      );
    }

    const geneId = hit._id ?? hit.entrezgene;
    const geneRes = await fetch(`https://mygene.info/v3/gene/${geneId}?fields=all`, {
      headers: { Accept: 'application/json' },
    });
    const geneData = geneRes.ok ? await geneRes.json() : hit;
    const formatted = formatGeneInfo(geneData) as Record<string, unknown>;

    const table = supabaseAdmin.from('gene_info_cache');
    const { data: existing } = await table.select('id').eq('gene_symbol', symbol).maybeSingle();
    const row = { data: formatted, cached_at: new Date().toISOString() };
    if (existing) {
      await (table as any).update(row).eq('gene_symbol', symbol);
    } else {
      await (table as any).insert({ gene_symbol: symbol, ...row });
    }

    return NextResponse.json(formatted);
  } catch (error) {
    console.error('Gene info API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch gene data',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
