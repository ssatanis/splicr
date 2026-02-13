
import { NextRequest, NextResponse } from 'next/server';
import { smartIngestScreenFile } from '@/lib/smartIngest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

export const config = {
    api: {
        bodyParser: false, // Handle multipart uploads manually? Next.js App Router handles FormData naturally.
    },
};

export async function POST(req: NextRequest) {
    try {
        const formData = await req.formData();
        const file = formData.get('file') as File | null;
        const libraryId = formData.get('libraryId') as string | null;

        if (!file || !libraryId) {
            return NextResponse.json(
                { error: 'Missing file or libraryId' },
                { status: 400 }
            );
        }

        // Save file to temp location
        const tempDir = os.tmpdir();
        // Sanitize filename
        const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const tempFilePath = path.join(tempDir, `splicr_upload_${Date.now()}_${safeFilename}`);

        // Convert Web Stream to Node Stream and save
        const fileStream = file.stream() as unknown as Readable; // Cast for compatibility
        // Actually, distinct stream types. Readable.fromWeb? 
        // Quickest way for App Router File: arrayBuffer()
        const buffer = Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(tempFilePath, buffer);

        try {
            // Run auto-detection pipeline
            const result = await smartIngestScreenFile(tempFilePath, file.name, libraryId);

            // Clean up temp file
            fs.unlinkSync(tempFilePath);

            return NextResponse.json(result);
        } catch (error) {
            // Clean up on error too
            if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
            throw error;
        }

    } catch (error) {
        console.error('[Ingest API] Error:', error);
        return NextResponse.json(
            { error: (error as Error).message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
