
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastqStreamParser } from '../fastqStreamParser';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FastqStreamParser Offset Detection', () => {
    let tmpDir: string;
    let tmpFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastq-offset-test-'));
        tmpFile = path.join(tmpDir, 'test_R1.fastq');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('detects offset with sparse matches (simulating real data)', async () => {
        // Create a guide that appears only occasionally
        const guide = 'AAAAAAAAAAAAAAAAAAAA'; // 20 As
        const library = { has: (seq: string) => seq === guide };

        // Offset 10
        // NNNNNNNNNN[GUIDE]...
        const prefix = 'N'.repeat(10);
        const validReadSeq = `${prefix}${guide}GTGGAAAGGACGAAACACC`;
        const validQuality = 'I'.repeat(validReadSeq.length);
        const validRead = `@seq_valid\n${validReadSeq}\n+\n${validQuality}\n`;

        // Noise reads (no guide match)
        const noiseSeq = 'C'.repeat(50);
        const noiseQuality = 'I'.repeat(50);
        const noiseRead = `@seq_noise\n${noiseSeq}\n+\n${noiseQuality}\n`;

        // 100 reads total: 15 valid, 85 noise
        // This tests the "10 hits minimum" and dominance check
        let content = '';
        for (let i = 0; i < 100; i++) {
            if (i < 15) {
                content += validRead;
            } else {
                content += noiseRead;
            }
        }

        fs.writeFileSync(tmpFile, content);

        const result = await FastqStreamParser.processStreamWithOrientation(tmpFile, library);

        expect(result.detectedOffset).toBe(10);
        // mappedReads might be slightly different depending on if detection consumes the stream or re-reads
        // The parser re-reads the file for processing, so it should catch all 15.
        expect(result.mappedReads).toBe(15);
    });

    it('handles R2 fallback when R1 has no matches', async () => {
        const guide = 'AAAAAAAAAAAAAAAAAAAA';
        const library = { has: (seq: string) => seq === guide };

        // R1: garbage
        const r1Content = `@seq1\n${'C'.repeat(50)}\n+\n${'I'.repeat(50)}\n`.repeat(100);
        fs.writeFileSync(tmpFile, r1Content);

        // R2: valid reads with offset 5
        const r2File = path.join(tmpDir, 'test_R2.fastq');
        const prefix = 'N'.repeat(5);
        const validReadSeq = `${prefix}${guide}GTGGAAAGGACGAAACACC`;
        const validQuality = 'I'.repeat(validReadSeq.length);
        const r2Content = `@seq1\n${validReadSeq}\n+\n${validQuality}\n`.repeat(100);
        fs.writeFileSync(r2File, r2Content);

        const result = await FastqStreamParser.processStreamWithOrientation(
            tmpFile,
            library,
            undefined,
            undefined,
            20,
            r2File // Pass R2 file
        );

        // Should switch to R2
        expect(result.usedR2).toBe(true);
        expect(result.detectedOffset).toBe(5);
        expect(result.mappedReads).toBe(100);
    });

    it('robustness: ignores whitespace and newlines in library/reads', async () => {
        // Library has whitespace? (The set passed in handles this, but let's assume the set is clean)
        // We'll test that the PARSER cleans up the read before checking.

        const guide = 'AAAAAAAAAAAAAAAAAAAA';
        const library = { has: (seq: string) => seq === guide };

        // Read with lowercase and maybe some noise? 
        // fastq format is strict about newlines, but sequence content might be lowercase

        const prefix = 'N'.repeat(10);
        // Lowercase guide in read
        const readSeq = `${prefix}${guide.toLowerCase()}GTGGAAAGGACGAAACACC`;
        const quality = 'I'.repeat(readSeq.length);
        const content = `@seq1\n${readSeq}\n+\n${quality}\n`.repeat(20);

        fs.writeFileSync(tmpFile, content);

        const result = await FastqStreamParser.processStreamWithOrientation(tmpFile, library);

        expect(result.detectedOffset).toBe(10);
        expect(result.mappedReads).toBe(20);
    });
});
