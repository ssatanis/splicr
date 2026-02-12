#!/usr/bin/env -S npx tsx
/**
 * R2 Bucket Management Script
 * Lists bucket contents and uploads test FASTQ file if needed
 */
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

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

async function listBucket() {
    console.log('Listing R2 Bucket Contents...');
    console.log('==============================\n');

    const command = new ListObjectsV2Command({
        Bucket: BUCKET_NAME,
    });

    try {
        const response = await client.send(command);
        if (response.Contents && response.Contents.length > 0) {
            response.Contents.forEach((obj, idx) => {
                console.log(`[${idx + 1}] ${obj.Key}`);
                console.log(`    Size: ${(obj.Size! / 1024 / 1024).toFixed(2)} MB`);
                console.log(`    Last Modified: ${obj.LastModified}`);
            });
            console.log(`\nTotal: ${response.Contents.length} files\n`);
            return response.Contents.map(c => c.Key!);
        } else {
            console.log('No files found in bucket\n');
            return [];
        }
    } catch (error: any) {
        console.error('Error listing bucket:', error.message);
        throw error;
    }
}

async function uploadTestFASTQ(targetKey: string) {
    console.log(`\nUploading test FASTQ file to: ${targetKey}...`);

    // Check if ERR376998.fastq.gz exists in test data
    const testDataPath = path.join(process.cwd(), '../test_data/ERR376998.fastq.gz');
    const demoPath = path.join(process.cwd(), '../demo/ERR376998.fastq.gz');

    let filePath: string | null = null;
    if (fs.existsSync(testDataPath)) {
        filePath = testDataPath;
    } else if (fs.existsSync(demoPath)) {
        filePath = demoPath;
    }

    if (!filePath) {
        console.error('Test FASTQ file not found in ../test_data or ../demo');
        console.error('Please download ERR376998.fastq.gz first');
        return false;
    }

    console.log(`Reading from: ${filePath}`);
    const fileContent = fs.readFileSync(filePath);
    const fileSize = (fileContent.length / 1024 / 1024).toFixed(2);
    console.log(`File size: ${fileSize} MB`);

    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: targetKey,
        Body: fileContent,
        ContentType: 'application/gzip',
    });

    try {
        await client.send(command);
        console.log('✓ Upload successful!');
        return true;
    } catch (error: any) {
        console.error('Upload failed:', error.message);
        throw error;
    }
}

async function main() {
    try {
        const files = await listBucket();

        // Check if the missing file exists
        const missingKey = '916285d0-df78-447c-8c3f-fcc60f7f166b/1769824414898-ERR376998.fastq';
        const exists = files.includes(missingKey);

        if (exists) {
            console.log(`✓ File ${missingKey} EXISTS in bucket`);
        } else {
            console.log(`✗ File ${missingKey} NOT FOUND in bucket`);
            console.log('\nAttempting to upload...');
            await uploadTestFASTQ(missingKey);
            console.log('\nVerifying upload...');
            await listBucket();
        }
    } catch (error: any) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

main();
