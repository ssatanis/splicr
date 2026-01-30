import { NextRequest, NextResponse } from 'next/server';

const globalStore = globalThis as any;
if (!globalStore.notesStore) globalStore.notesStore = new Map();

const notes = globalStore.notesStore;

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;
    const note = notes.get(id) || '';

    return NextResponse.json({ note });
  } catch (error) {
    return NextResponse.json({ note: '' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const params = await context.params;
    const id = params.id;
    const { note } = await request.json();

    notes.set(id, note);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: 'Failed to save note' },
      { status: 500 }
    );
  }
}
