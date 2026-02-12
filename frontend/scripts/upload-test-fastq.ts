#!/usr/bin/env -S npx tsx
/**
 * Upload test FASTQ file to R2
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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

async function uploadFile() {
    // Use one of the existing test data files
    const sourcePath = path.join(process.cwd(), '../test_data/control_rep1.fastq');
    const targetKey = '916285d0-df78-447c-8c3f-fcc60f7f166b/1769824414898-ERR376998.fastq';

    console.log(`Reading file: ${sourcePath}`);

    if (!fs.existsSync(sourcePath)) {
        console.error(`File not found: ${sourcePath}`);
        process.exit(1);
    }

    const fileContent = fs.readFileSync(sourcePath);
    const fileSize = (fileContent.length / 1024 / 1024).toFixed(2);
    console.log(`File size: ${fileSize} MB`);
    console.log(`Uploading to R2: ${targetKey}`);

    const command = new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: targetKey,
        Body: fileContent,
        ContentType: 'text/plain',
    });

    try {
        await client.send(command);
        console.log('✓ Upload successful!');
        console.log('\nFile available at:');
        console.log(`  Bucket: ${BUCKET_NAME}`);
        console.log(`  Key: ${targetKey}`);
    } catch (error: any) {
        console.error('Upload failed:', error.message);
        throw error;
    }
}

uploadFile();
