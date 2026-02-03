import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

// GET all presets for current user (including shared ones)
export async function GET() {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('analysis_presets')
      .select('*')
      .or(`user_id.eq.${user.id},is_shared.eq.true`)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('Error fetching presets:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch presets' },
      { status: 500 }
    );
  }
}

// POST create a new preset
export async function POST(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, description, settings, is_shared, lab_id } = body;

    if (!name || !settings) {
      return NextResponse.json(
        { error: 'Name and settings are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('analysis_presets')
      .insert({
        user_id: user.id,
        name,
        description,
        settings,
        is_shared: is_shared || false,
        lab_id: lab_id || null,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data, { status: 201 });
  } catch (error: any) {
    console.error('Error creating preset:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create preset' },
      { status: 500 }
    );
  }
}

// DELETE a preset
export async function DELETE(request: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const presetId = searchParams.get('id');

    if (!presetId) {
      return NextResponse.json(
        { error: 'Preset ID is required' },
        { status: 400 }
      );
    }

    // Only allow deleting own presets
    const { error } = await supabase
      .from('analysis_presets')
      .delete()
      .eq('id', presetId)
      .eq('user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting preset:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete preset' },
      { status: 500 }
    );
  }
}
