
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
    try {
        const supabase = await createClient();

        // Check auth
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Get saved targets joined with gene info
        const { data, error } = await supabase
            .from('user_saved_targets')
            .select(`
        *,
        gene:tx_genes_master (
          gene_id,
          gene_symbol,
          gene_name
        )
      `)
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Error fetching saved targets:', error);
        return NextResponse.json(
            { error: 'Failed to fetch saved targets', details: error.message },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();

        // Check auth
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { gene_id, list_name } = await request.json();

        if (!gene_id) {
            return NextResponse.json({ error: 'Missing gene_id' }, { status: 400 });
        }

        // Insert
        const { data, error } = await (supabase
            .from('user_saved_targets' as any) as any)
            .insert({
                user_id: user.id,
                gene_id,
                list_name: list_name || 'Default'
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique violation
                return NextResponse.json({ error: 'Target already saved to this list' }, { status: 409 });
            }
            throw error;
        }

        return NextResponse.json(data);

    } catch (error: any) {
        console.error('Error saving target:', error);
        return NextResponse.json(
            { error: 'Failed to save target', details: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const supabase = await createClient();

        // Check auth
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const searchParams = request.nextUrl.searchParams;
        const gene_id = searchParams.get('gene_id');
        const list_name = searchParams.get('list_name') || 'Default';
        const id = searchParams.get('id');

        let query = supabase.from('user_saved_targets').delete().eq('user_id', user.id);

        if (id) {
            query = query.eq('id', id);
        } else if (gene_id) {
            query = query.eq('gene_id', gene_id).eq('list_name', list_name);
        } else {
            return NextResponse.json({ error: 'Missing id or gene_id' }, { status: 400 });
        }

        const { error } = await query;

        if (error) throw error;

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('Error deleting saved target:', error);
        return NextResponse.json(
            { error: 'Failed to delete saved target', details: error.message },
            { status: 500 }
        );
    }
}
