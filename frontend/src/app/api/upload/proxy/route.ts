import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { createServerR2Client, R2_BUCKET_NAME } from '@/lib/storage/r2-client';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hasAllowedExtension } from '@/lib/upload/constants';

export const dynamic = 'force-dynamic';

/**
 * Proxy upload for small files (<100MB).
 * Receives file via FormData, uploads to R2, and saves metadata for deduplication.
 */
export async function POST(request: NextRequest) {
    try {
        const { getApiUser } = await import('@/lib/supabase/server');
        const { user, error: authError } = await getApiUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const userId = formData.get('userId') as string | null;
        const fileHash = formData.get('hash') as string | null;

        if (!file) {
            return NextResponse.json({ error: 'File is required' }, { status: 400 });
        }

        if (!userId || userId !== user.id) {
            return NextResponse.json({ error: 'Invalid user ID' }, { status: 403 });
        }

        if (!hasAllowedExtension(file.name)) {
            return NextResponse.json(
                { error: 'File type not allowed. Allowed: .fastq, .fq, .fastq.gz, .fq.gz, .bam, .cram, .sam, .txt' },
                { status: 400 }
            );
        }

        // Generate R2 key: userId/timestamp-sanitizedFileName
        const timestamp = Date.now();
        const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${user.id}/${timestamp}-${sanitizedName}`;

        // Upload to R2
        const client = createServerR2Client();
        const buffer = await file.arrayBuffer();

        const command = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: Buffer.from(buffer),
            ContentType: file.type || 'application/octet-stream',
            Metadata: {
                userId: user.id,
                originalName: file.name,
                uploadedAt: new Date().toISOString(),
                fileSize: file.size.toString(),
            },
        });

        await client.send(command);

        // Save metadata to database for deduplication (if hash provided)
        if (fileHash) {
            try {
                const table = (supabaseAdmin as any).from('sequencing_files');
                await table.upsert(
                    {
                        file_hash: fileHash,
                        r2_key: key,
                        file_name: file.name,
                        size_bytes: file.size,
                        content_type: file.type || 'application/octet-stream',
                        user_id: user.id,
                    },
                    { onConflict: 'file_hash', ignoreDuplicates: true }
                );
            } catch (dbError) {
                // Non-fatal: file uploaded successfully, just dedup won't work
                console.warn('Failed to save file metadata for deduplication:', dbError);
            }
        }

        return NextResponse.json({
            key,
            bucket: R2_BUCKET_NAME,
        });
    } catch (error) {
        console.error('Proxy upload error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: `Failed to upload file: ${message}` },
            { status: 500 }
        );
    }
}
