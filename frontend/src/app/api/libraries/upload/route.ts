import { NextResponse } from 'next/server';
import { CustomLibraryParser } from '@/lib/customLibraryParser';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const content = buffer.toString('utf-8');

        // Parse
        const library = CustomLibraryParser.parse(content, file.name);

        // Save to temp storage for retrieval during analysis
        // We use a specific prefix to easily find it later
        const tempDir = path.join(os.tmpdir(), 'splicr-custom-libs');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const filePath = path.join(tempDir, `${library.id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(library));

        return NextResponse.json({
            success: true,
            library: {
                id: library.id,
                name: file.name,
                count: library.count,
                guideLength: library.guideLength,
                preview: library.preview
            }
        });

    } catch (error) {
        console.error('Upload error:', error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : 'Failed to process library file' },
            { status: 500 }
        );
    }
}
