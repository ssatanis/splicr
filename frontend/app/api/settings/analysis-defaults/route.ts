import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('analysis_defaults')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // Return defaults if no custom settings exist
    if (!data) {
      return NextResponse.json({
        fdr_cutoff: 0.05,
        log2_fold_change: 1.0,
        p_value_threshold: 0.05,
        normalization_method: 'deseq2',
        default_library: 'brunello_v2',
        organism: 'human',
        guides_per_gene: 4,
        gene_annotation: 'ensembl_110',
        chart_type: 'volcano',
        color_scheme: 'viridis',
        show_gene_labels: true,
        label_top_n: 20,
        point_size: 'medium',
      });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching analysis defaults:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch analysis defaults' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    // Validate required fields
    const validFields = [
      'fdr_cutoff',
      'log2_fold_change',
      'p_value_threshold',
      'normalization_method',
      'default_library',
      'organism',
      'guides_per_gene',
      'gene_annotation',
      'chart_type',
      'color_scheme',
      'show_gene_labels',
      'label_top_n',
      'point_size',
    ];

    const settings: any = {};
    for (const field of validFields) {
      if (body[field] !== undefined) {
        settings[field] = body[field];
      }
    }

    const { data, error } = await supabase
      .from('analysis_defaults')
      .upsert({
        user_id: user.id,
        ...settings,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error updating analysis defaults:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update analysis defaults' },
      { status: 500 }
    );
  }
}
