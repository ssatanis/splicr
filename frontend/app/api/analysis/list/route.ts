import { NextResponse } from 'next/server';
import type { Analysis } from '@/lib/types';

// Access the shared global storage (same as create route)
const globalStore = globalThis as any;
if (!globalStore.analysesStore) globalStore.analysesStore = new Map();

const analyses = globalStore.analysesStore;

export async function GET() {
  try {
    // Return all analyses from the shared in-memory storage
    const analysesList = (Array.from(analyses.values()) as Analysis[])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json(analysesList);
  } catch (error) {
    console.error('Error fetching analyses:', error);
    return NextResponse.json([], { status: 500 });
  }
}
