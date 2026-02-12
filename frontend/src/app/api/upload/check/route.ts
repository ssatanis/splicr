import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hasAllowedExtension } from '@/lib/upload/constants';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

export const dynamic = 'force-dynamic';

// Initialize R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME || 'splicr-fastq-files';

/**
 * Check if a file already exists in R2 by content hash (global dedup).
 * Verifies BOTH database entry AND actual R2 file existence.
 */
export async function POST(request: NextRequest) {
  try {
    const { getApiUser } = await import('@/lib/supabase/server');
    const { user } = await getApiUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { hash, fileName, size, contentType } = body as {
      hash?: string;
      fileName?: string;
      size?: number;
      contentType?: string;
    };

    if (!hash || typeof hash !== 'string' || hash.length < 32) {
      return NextResponse.json(
        { error: 'hash (SHA-256 hex) is required' },
        { status: 400 }
      );
    }
    if (!fileName || typeof fileName !== 'string') {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }

    if (!hasAllowedExtension(fileName)) {
      return NextResponse.json(
        { error: 'File type not allowed. Check allowed extensions.' },
        { status: 400 }
      );
    }

    // Step 1: Check database for existing file with this hash
    const { data: row, error: dbError } = await (supabaseAdmin as any)
      .from('sequencing_files')
      .select('r2_key')
      .eq('file_hash', hash)
      .limit(1)
      .maybeSingle();

    if (dbError) {
      if (dbError.code === 'PGRST205') {
        return NextResponse.json({ exists: false });
      }
      console.error('Dedup check error:', dbError);
      return NextResponse.json(
        { error: 'Failed to check existing file' },
        { status: 500 }
      );
    }

    // Step 2: If found in DB, verify it actually exists in R2
    if (row?.r2_key) {
      const r2Key = row.r2_key as string;

      try {
        // Verify file exists in R2 storage
        await r2Client.send(new HeadObjectCommand({
          Bucket: BUCKET_NAME,
          Key: r2Key,
        }));

        console.log(`✓ Dedup success: File exists in both DB and R2 (hash: ${hash.substring(0, 8)}..., key: ${r2Key})`);

        return NextResponse.json({
          exists: true,
          key: r2Key,
        });
      } catch (r2Error: any) {
        // File exists in DB but not in R2 - clean up stale entry
        if (r2Error.name === 'NotFound' || r2Error.$metadata?.httpStatusCode === 404) {
          console.warn(`⚠ Stale DB entry detected: File hash ${hash.substring(0, 8)}... exists in DB but not in R2 (key: ${r2Key})`);

          // Delete stale database entry
          try {
            await (supabaseAdmin as any)
              .from('sequencing_files')
              .delete()
              .eq('file_hash', hash);

            console.log(`✓ Cleaned up stale DB entry for hash ${hash.substring(0, 8)}...`);
          } catch (deleteError) {
            console.error('Failed to delete stale DB entry:', deleteError);
            // Continue anyway - file will be re-uploaded
          }

          return NextResponse.json({ exists: false });
        }

        // Other R2 errors - log but don't fail (allow re-upload)
        console.error('R2 verification error:', r2Error);
        return NextResponse.json({ exists: false });
      }
    }

    return NextResponse.json({ exists: false });
  } catch (e) {
    console.error('Upload check error:', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload check failed' },
      { status: 500 }
    );
  }
}
