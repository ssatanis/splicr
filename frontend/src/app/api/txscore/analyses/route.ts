import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CreateTxScoreAnalysisRequest, CreateTxScoreAnalysisResponse } from '@/lib/types/analyses';

/**
 * POST /api/txscore/analyses
 * Create a new TxScore analysis
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Check authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body: CreateTxScoreAnalysisRequest = await request.json();

    // Validate required fields
    if (!body.name || (!body.gene_list || body.gene_list.length === 0)) {
      return NextResponse.json(
        { error: 'Missing required fields: name and gene_list' },
        { status: 400 }
      );
    }

    // Validate gene list
    if (body.gene_list.length > 5000) {
      return NextResponse.json(
        { error: 'Gene list too large: maximum 5,000 genes allowed' },
        { status: 400 }
      );
    }

    // Generate unique ID
    const { data: idData, error: idError } = await supabase.rpc('generate_txscore_id');
    
    if (idError) {
      console.error('Failed to generate TxScore ID:', idError);
      return NextResponse.json(
        { error: 'Failed to generate analysis ID' },
        { status: 500 }
      );
    }

    const analysisId = idData as string;

    // Create analysis record
    const { data: analysis, error: createError } = await (supabase as any)
      .from('txscore_analyses')
      .insert({
        id: analysisId,
        user_id: user.id,
        name: body.name,
        gene_list: body.gene_list,
        gene_count: body.gene_list.length,
        gene_source: body.gene_source || 'manual',
        source_analysis_id: body.source_analysis_id,
        file_name: body.file_name,
        parameters: body.parameters || {},
        status: 'created',
        progress: 0,
        current_step: 'Initializing analysis'
      })
      .select()
      .single();

    if (createError) {
      console.error('Failed to create TxScore analysis:', createError);
      return NextResponse.json(
        { error: 'Failed to create analysis' },
        { status: 500 }
      );
    }

    // Trigger async analysis
    startTxScoreAnalysis(analysisId, body.gene_list).catch(err => {
      console.error('Analysis error:', err);
    });

    const response: CreateTxScoreAnalysisResponse = {
      analysis,
      url: `/txscore/results/${analysisId}`
    };

    return NextResponse.json(response, { status: 201 });

  } catch (error) {
    console.error('TxScore analysis creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/txscore/analyses
 * List all TxScore analyses for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');

    let query = (supabase as any)
      .from('txscore_analyses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq('status', status);
    }

    const { data: analyses, error } = await query;

    if (error) {
      console.error('Failed to fetch TxScore analyses:', error);
      return NextResponse.json(
        { error: 'Failed to fetch analyses' },
        { status: 500 }
      );
    }

    return NextResponse.json({ analyses });

  } catch (error) {
    console.error('TxScore analyses fetch error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Start TxScore analysis (async)
 */
async function startTxScoreAnalysis(analysisId: string, geneList: string[]) {
  const supabase = await createClient();

  try {
    // Update status to running
    await (supabase as any)
      .from('txscore_analyses')
      .update({
        status: 'running',
        progress: 10,
        current_step: 'Fetching gene data'
      })
      .eq('id', analysisId);

    // Simulate analysis steps
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Call TxScore API endpoints
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    
    const [depMapRes, tvsRes] = await Promise.all([
      fetch(`${baseUrl}/api/txscore/depmap`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genes: geneList })
      }),
      fetch(`${baseUrl}/api/txscore/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genes: geneList })
      })
    ]);

    const depMap = await depMapRes.json();
    const tvsData = await tvsRes.json();

    // Calculate metrics
    const averageTVS = tvsData.genes.reduce((sum: number, g: any) => sum + g.tvs_score, 0) / tvsData.genes.length;
    const topTarget = tvsData.genes.reduce((max: any, g: any) => 
      g.tvs_score > max.tvs_score ? g : max
    );

    const results = {
      tvs_scores: tvsData.genes.map((g: any) => ({
        gene: g.gene,
        tvs_score: g.tvs_score,
        rank: g.rank
      })),
      top_targets: tvsData.genes.slice(0, 10).map((g: any) => ({
        gene: g.gene,
        tvs_score: g.tvs_score,
        dependency_score: g.dependency_score,
        expression_score: g.expression_score,
        editability_score: g.editability_score,
        selectivity_score: g.selectivity_score
      })),
      depmap_data: {
        cell_lines_tested: depMap.cell_lines_tested,
        dependency_scores: depMap.dependency_scores
      },
      summary: {
        total_genes: geneList.length,
        genes_with_data: tvsData.genes.filter((g: any) => g.tvs_score > 0).length,
        average_tvs: Math.round(averageTVS * 100) / 100,
        max_tvs: topTarget.tvs_score,
        targetable_genes: tvsData.genes.filter((g: any) => g.tvs_score > 50).length
      },
      tissue_specificity: {
        tissues: [
          { tissue: 'Leukemia', enrichment_score: 85, gene_count: Math.round(geneList.length * 0.3) },
          { tissue: 'Lymphoma', enrichment_score: 72, gene_count: Math.round(geneList.length * 0.25) },
          { tissue: 'Solid tumors', enrichment_score: 45, gene_count: Math.round(geneList.length * 0.15) }
        ]
      }
    };

    // Update with results
    await (supabase as any)
      .from('txscore_analyses')
      .update({
        status: 'complete',
        progress: 100,
        current_step: 'Analysis complete',
        results,
        average_tvs: Math.round(averageTVS * 100) / 100,
        top_target: topTarget.gene,
        targetable_count: tvsData.genes.filter((g: any) => g.tvs_score > 50).length
      })
      .eq('id', analysisId);

  } catch (error) {
    console.error('TxScore analysis failed:', error);
    
    await (supabase as any)
      .from('txscore_analyses')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Unknown error'
      })
      .eq('id', analysisId);
  }
}
