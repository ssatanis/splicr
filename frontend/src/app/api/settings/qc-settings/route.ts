import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('qc_settings')
      .select('*')
      .eq('user_id', user.id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw error;
    }

    // Return defaults if no custom settings exist
    if (!data) {
      return NextResponse.json({
        min_read_depth_per_sample: 1000000,
        max_low_quality_guides_pct: 10.0,
        min_guide_representation: 100,
        max_gini_coefficient: 0.2,
        auto_flag_low_quality: true,
        warn_before_analyzing_flagged: true,
        include_qc_report_in_exports: true,
        min_replicate_correlation: 0.7,
        replicate_correlation_action: 'warn',
        verify_essential_gene_depletion: true,
        expected_essential_gene_lfc: -2.0,
        check_nontargeting_distribution: true,
        expected_nt_guide_lfc_range: 0.5,
        validate_positive_controls: true,
        generate_qc_report_always: true,
        include_fastqc_metrics: true,
        flag_outliers_automatically: true,
        compare_to_historical_qc: true,
        qc_report_format: 'pdf',
      });
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error fetching QC settings:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch QC settings' },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data, error } = await supabase
      .from('qc_settings')
      .upsert({
        user_id: user.id,
        ...body,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error updating QC settings:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update QC settings' },
      { status: 500 }
    );
  }
}
