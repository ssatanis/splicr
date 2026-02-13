import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FastqStreamParser } from '@/lib/analysis/fastqStreamParser';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('FastqStreamParser - Variable Guide Length', () => {
    let tmpDir: string;
    let tmpFile: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fastq-var-test-'));
        tmpFile = path.join(tmpDir, 'test_var.fastq');
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('supports 21bp guides with auto-detection', async () => {
        // 21bp guide
        const guide = 'AAAAAAAAAAAAAAAAAAAAA'; // 21 As
        const library = { has: (seq: string) => seq === guide };

        // Construct read: NNNNN (5 offset) + GUIDE (21) + ADAPTER...
        const prefix = 'NNNNN';
        const adapter = 'TCTTGTGG';
        const readSeq = `${prefix}${guide}${adapter}`;
        // Length: 5 + 21 + 8 = 34

        const quality = 'I'.repeat(readSeq.length);
        const read = `@seq1\n${readSeq}\n+\n${quality}\n`;

        // Write enough reads to trigger detection
        fs.writeFileSync(tmpFile, read.repeat(300));

        const result = await FastqStreamParser.processStreamWithOrientation(
            tmpFile,
            library,
            adapter,
            undefined, // no manual offset
            21 // guideLength
        );

        expect(result.detectedOffset).toBe(5);
        expect(result.sgRNACounts.get(guide)).toBe(300);
        expect(result.mappedReads).toBe(300);
    });

    it('fails to match 21bp guide if guideLength is default (20)', async () => {
        const guide = 'AAAAAAAAAAAAAAAAAAAAA'; // 21 As
        const library = { has: (seq: string) => seq === guide };

        const prefix = 'NNNNN';
        const adapter = 'TCTTGTGG';
        const readSeq = `${prefix}${guide}${adapter}`;
        const quality = 'I'.repeat(readSeq.length);
        fs.writeFileSync(tmpFile, `@seq1\n${readSeq}\n+\n${quality}\n`.repeat(100));

        // Default guideLength is 20
        const result = await FastqStreamParser.processStreamWithOrientation(
            tmpFile,
            library,
            adapter
            // guideLength defaults to 20
        );

        // It should look for 20bp strings.
        // It might find AAAAAAAAAAAAAAAAAAAA (20 As) at offset 5.
        // But library check: has("AAAAAAAAAAAAAAAAAAAA") -> false (library has 21 As)

        expect(result.mappedReads).toBe(0);
    });
});
