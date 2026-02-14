import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateTEAReportId } from '@/lib/tea/sequence-utils';
import {
  fetchDepMapData,
  fetchChromatinAccessibility,
  fetchRelatedPapers,
  fetchGTExExpression
} from '@/lib/tea/external-apis';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface TEARequest {
  sequence: string;
  variantId?: string;
  geneSymbol: string;
  tissue: string;
  genomeBuild?: string;
  chromosome?: string;
  position?: number;
  refAllele?: string;
  altAllele?: string;
  hgvsNotation?: string;
  patientVcfUrl?: string;
}

interface BackendTEAPrediction {
  efficiency: number;
  therapeuticWindow: number;
  offTargets: Array<{
    sequence: string;
    chromosome: string;
    position: number;
    mismatches: number;
    cfdScore: number;
  }>;
  editScore: number;
  optimalStrategy: string;
  optimalEditor: string;
  componentScores: {
    baseEditability: number;
    primeEditability: number;
    therapeuticWindow: number;
    cellTypeSpecificity: number;
    offTargetSafety: number;
    deliverability: number;
  };
  pamAnalysis: {
    pamSites: Array<{
      sequence: string;
      position: number;
      distance: number;
      strand: string;
      type: string;
    }>;
    bestPam?: {
      sequence: string;
      position: number;
      score: number;
    };
  };
  sequenceFeatures: {
    gcContent: number;
    length: number;
    homopolymers: string[];
    secondaryStructures: Array<{
      position: number;
      deltaG: number;
      structure: string;
    }>;
  };
}

export async function POST(request: NextRequest) {
  try {
    // Get user session
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    // Parse request body
    const body: TEARequest = await request.json();
    const {
      sequence,
      variantId = '',
      geneSymbol,
      tissue,
      genomeBuild = 'hg38',
      chromosome = '',
      position,
      refAllele = '',
      altAllele = '',
      hgvsNotation = '',
      patientVcfUrl
    } = body;

    // Validate required fields
    if (!sequence || !geneSymbol || !tissue) {
      return NextResponse.json(
        { error: 'Missing required fields: sequence, geneSymbol, tissue' },
        { status: 400 }
      );
    }

    // Generate unique report ID
    const reportId = generateTEAReportId();

    // Call backend TEA service
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    const backendResponse = await fetch(`${backendUrl}/api/tea/predict`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sequence,
        variant_id: variantId,
        gene_symbol: geneSymbol,
        tissue
      })
    });

    if (!backendResponse.ok) {
      throw new Error(`Backend error: ${backendResponse.statusText}`);
    }

    const prediction: BackendTEAPrediction = await backendResponse.json();

    // Fetch external data in parallel
    const [depmap, chromatin, papers, expression] = await Promise.allSettled([
      fetchDepMapData(geneSymbol),
      chromosome && position 
        ? fetchChromatinAccessibility(chromosome, position, tissue)
        : Promise.resolve(null),
      fetchRelatedPapers(geneSymbol, prediction.optimalStrategy as any, 5),
      fetchGTExExpression(geneSymbol, tissue)
    ]);

    // Build external links
    const externalLinks = {
      depmap: `https://depmap.org/portal/gene/${geneSymbol}`,
      gtex: `https://gtexportal.org/home/gene/${geneSymbol}`,
      clinvar: variantId.match(/^\d+$/) 
        ? `https://www.ncbi.nlm.nih.gov/clinvar/variation/${variantId}/`
        : undefined,
      encode: chromosome && position
        ? `https://genome.ucsc.edu/cgi-bin/hgTracks?db=${genomeBuild}&position=${chromosome}:${position - 500}-${position + 500}`
        : undefined
    };

    // Generate intelligent explanations
    const explanations = {
      efficiency: `${prediction.efficiency >= 70 ? 'High' : prediction.efficiency >= 50 ? 'Moderate' : 'Low'} editing efficiency predicted (${prediction.efficiency.toFixed(1)}%) based on sequence context, GC content (${prediction.sequenceFeatures.gcContent.toFixed(1)}%), and PAM accessibility.`,
      
      window: `Therapeutic window of ${prediction.therapeuticWindow.toFixed(1)} indicates ${
        prediction.therapeuticWindow >= 10 ? 'excellent specificity' : 
        prediction.therapeuticWindow >= 5 ? 'good specificity' : 
        'moderate specificity'
      } - the ratio between on-target editing and off-target effects.`,
      
      offTarget: `${prediction.offTargets.length} predicted off-target sites with ${
        prediction.componentScores.offTargetSafety >= 80 ? 'minimal' :
        prediction.componentScores.offTargetSafety >= 60 ? 'low' :
        'moderate'
      } risk (safety score: ${prediction.componentScores.offTargetSafety.toFixed(1)}/100).`,
      
      recommendation: `${prediction.optimalStrategy === 'base_editing' ? 'Base editing' : 
        prediction.optimalStrategy === 'prime_editing' ? 'Prime editing' : 
        'CRISPR nuclease'} with ${prediction.optimalEditor} is recommended based on ${
          prediction.optimalStrategy === 'base_editing' ? 'C-to-T or A-to-G transition' :
          prediction.optimalStrategy === 'prime_editing' ? 'transversion or indel requirement' :
          'deletion or large modification needs'
        }.`,
      
      tissue: expression.status === 'fulfilled' && expression.value.is_highly_expressed
        ? `Gene is highly expressed in ${tissue} (${expression.value.median_tpm.toFixed(1)} TPM), favorable for therapeutic editing.`
        : `Gene expression in ${tissue} should be verified for optimal editing outcomes.`,
      
      chromatin: chromatin.status === 'fulfilled' && chromatin.value
        ? `Chromatin accessibility score of ${(chromatin.value.accessibility_score * 100).toFixed(0)}% suggests ${
            chromatin.value.accessibility_score >= 0.7 ? 'good' : 'moderate'
          } editor access to target site.`
        : 'Chromatin accessibility data not available for this locus.'
    };

    // Store analysis in database
    const { data: analysis, error: insertError } = await supabase
      .from('tea_analyses')
      .insert({
        user_id: user.id,
        report_id: reportId,
        variant_id: variantId,
        gene_symbol: geneSymbol,
        chromosome,
        position,
        ref_allele: refAllele,
        alt_allele: altAllele,
        hgvs_notation: hgvsNotation,
        target_sequence: sequence,
        sequence_context: {
          gc_content: prediction.sequenceFeatures.gcContent,
          length: prediction.sequenceFeatures.length,
          pam_sites: prediction.pamAnalysis.pamSites,
          secondary_structures: prediction.sequenceFeatures.secondaryStructures,
          homopolymers: prediction.sequenceFeatures.homopolymers
        },
        tissue,
        genome_build: genomeBuild,
        patient_vcf_url: patientVcfUrl,
        edit_score: prediction.editScore,
        base_editability: prediction.componentScores.baseEditability,
        prime_editability: prediction.componentScores.primeEditability,
        therapeutic_window: prediction.componentScores.therapeuticWindow,
        cell_type_specificity: prediction.componentScores.cellTypeSpecificity,
        off_target_safety: prediction.componentScores.offTargetSafety,
        deliverability: prediction.componentScores.deliverability,
        optimal_strategy: prediction.optimalStrategy,
        optimal_editor: prediction.optimalEditor,
        predicted_efficiency: prediction.efficiency,
        off_target_count: prediction.offTargets.length,
        results: prediction,
        external_links: externalLinks,
        explanations,
        related_papers: papers.status === 'fulfilled' ? papers.value : [],
        chromatin_data: chromatin.status === 'fulfilled' && chromatin.value ? {
          accessibility_score: chromatin.value.accessibility_score,
          tissue: chromatin.value.tissue,
          source: chromatin.value.source,
          dnase_signal: chromatin.value.dnase_signal
        } : null,
        status: 'completed'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      throw new Error('Failed to save analysis');
    }

    return NextResponse.json({
      reportId,
      analysisId: analysis.id,
      url: `/tea/report/${reportId}`,
      editScore: prediction.editScore,
      optimalStrategy: prediction.optimalStrategy,
      optimalEditor: prediction.optimalEditor
    });

  } catch (error) {
    console.error('TEA analysis error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Analysis failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // List user's analyses
  try {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    
    if (!token) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Invalid token' },
        { status: 401 }
      );
    }

    const { data: analyses, error } = await supabase
      .from('tea_analyses')
      .select('report_id, gene_symbol, variant_id, tissue, edit_score, optimal_strategy, created_at, status')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error('Failed to fetch analyses');
    }

    return NextResponse.json({ analyses });

  } catch (error) {
    console.error('List analyses error:', error);
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
