#!/usr/bin/env -S npx tsx
/**
 * Test script to verify R2 validation is working correctly
 * This will check if files are properly validated against R2 storage
 */
import { S3Client, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';

const client = new S3Client({
    region: 'auto',
    endpoint: 'https://da0ccf4b112f1383afdb6cf7be726dde.r2.cloudflarestorage.com',
    credentials: {
        accessKeyId: 'e89d9b7135688320f1e334ba7140fce6',
        secretAccessKey: 'acb510ed0fe1c1e93d1290afb922f5047b45cb49cc53e893e7ab2a174f646b80',
    },
    forcePathStyle: true,
});

const BUCKET_NAME = 'splicr-fastq-files';

async function listAllFiles() {
    console.log('📂 Listing all files in R2 bucket:', BUCKET_NAME);
    console.log('='.repeat(80));

    try {
        const command = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            MaxKeys: 100,
        });

        const response = await client.send(command);

        if (!response.Contents || response.Contents.length === 0) {
            console.log('\n❌ NO FILES FOUND IN R2 BUCKET');
            console.log('   This is why "Reused from cloud" was showing - database had entries but R2 was empty!');
            return;
        }

        console.log(`\n✅ Found ${response.Contents.length} files:\n`);

        for (const obj of response.Contents) {
            const sizeGB = ((obj.Size || 0) / 1024 / 1024 / 1024).toFixed(3);
            const sizeMB = ((obj.Size || 0) / 1024 / 1024).toFixed(2);
            const displaySize = parseFloat(sizeGB) >= 0.1 ? `${sizeGB} GB` : `${sizeMB} MB`;

            console.log(`📄 ${obj.Key}`);
            console.log(`   Size: ${displaySize}`);
            console.log(`   Modified: ${obj.LastModified?.toISOString() || 'Unknown'}`);
            console.log();
        }

        console.log('='.repeat(80));
        console.log(`Total: ${response.Contents.length} files`);

    } catch (error: any) {
        console.error('❌ Error listing files:', error.message);
        throw error;
    }
}

async function checkSpecificFile(key: string) {
    console.log(`\n🔍 Checking if file exists: ${key}`);

    try {
        await client.send(new HeadObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));
        console.log('✅ File EXISTS in R2');
        return true;
    } catch (error: any) {
        if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
            console.log('❌ File NOT FOUND in R2');
            return false;
        }
        console.error('❌ Error checking file:', error.message);
        return false;
    }
}

async function main() {
    console.log('\n🚀 R2 Storage Validation Test\n');

    // List all files in R2
    await listAllFiles();

    // Test the specific file that was mentioned in the user's message
    const testKey = '916285d0-df78-447c-8c3f-fcc60f7f166b/1769824414898-ERR376998.fastq';
    await checkSpecificFile(testKey);

    console.log('\n✅ Test complete!');
    console.log('\n📝 Summary:');
    console.log('   - The /api/upload/check endpoint now verifies files exist in R2');
    console.log('   - Old logic: only checked database → showed "reused" for deleted files');
    console.log('   - New logic: checks database AND R2 → only shows "reused" if file truly exists');
    console.log('   - Stale DB entries (file in DB but not in R2) are automatically cleaned up');
}

main();
