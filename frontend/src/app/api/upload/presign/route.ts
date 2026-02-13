import { NextRequest, NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createServerR2Client, R2_BUCKET_NAME } from '@/lib/storage/r2-client';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        const supabase = await createClient();
        const { user, error: authError } = await (await import("@/lib/supabase/server")).getApiUser();

        if (authError || !user) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }

        const { filename, contentType, fileHash } = await request.json();

        if (!filename) {
            return NextResponse.json({ error: 'filename is required' }, { status: 400 });
        }

        // Generate R2 key: userId/timestamp-sanitizedFileName
        const timestamp = Date.now();
        const sanitizedName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `${user.id}/${timestamp}-${sanitizedName}`;

        const client = createServerR2Client();
        const command = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            ContentType: contentType || 'application/octet-stream',
            Metadata: {
                userId: user.id,
                originalName: filename,
                fileHash: fileHash || '',
            },
        });

        const presignedUrl = await getSignedUrl(client, command, {
            expiresIn: 3600,
        });

        return NextResponse.json({ presignedUrl, key });
    } catch (error) {
        console.error('Presign upload error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: `Failed to generate upload URL: ${message}` },
            { status: 500 }
        );
    }
}
