import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { CreateTEAAnalysisRequest, CreateTEAAnalysisResponse } from '@/lib/types/analyses';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body: CreateTEAAnalysisRequest = await request.json();

    if (!body.name || !body.sequence) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const analysisId = `TEA-${Date.now()}`;

    const { data: analysis, error: createError } = await (supabase as any)
      .from('tea_analyses')
      .insert({
        id: analysisId,
        user_id: user.id,
        name: body.name,
        sequence: body.sequence,
        status: 'created'
      })
      .select()
      .single();

    if (createError) {
      console.error('Failed to create analysis:', createError);
      return NextResponse.json({ error: 'Failed to create analysis' }, { status: 500 });
    }

    return NextResponse.json({ analysis, url: `/tea/results/${analysisId}` }, { status: 201 });
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: analyses, error } = await (supabase as any)
      .from('tea_analyses')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: 'Failed to fetch analyses' }, { status: 500 });
    }

    return NextResponse.json({ analyses: analyses || [] });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
