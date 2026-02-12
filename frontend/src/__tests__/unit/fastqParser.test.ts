import { describe, it, expect } from 'vitest';
import { FASTQParser } from '@/lib/fastqParser';
import pako from 'pako';

describe('FASTQParser', () => {
    it('parses a valid plain text FASTQ file', async () => {
        const content = [
            '@SEQ_ID_1',
            'ATCG',
            '+',
            '!!!!',
            '@SEQ_ID_2',
            'GGCC',
            '+',
            '????'
        ].join('\n');

        const file = new File([content], 'test.fastq', { type: 'text/plain' });
        const result = await FASTQParser.parseFASTQ(file);

        expect(result.reads).toHaveLength(2);
        expect(result.reads[0]).toEqual({
            id: 'SEQ_ID_1',
            sequence: 'ATCG',
            quality: '!!!!'
        });
        expect(result.stats.totalReads).toBe(2);
        expect(result.stats.avgReadLength).toBe(4);
        expect(result.stats.gcContent).toBe(75);
    });

    it('parses a gzipped FASTQ file', async () => {
        const content = '@SEQ_ID_1\nATCG\n+\n!!!!\n';
        const compressed = pako.gzip(content);
        const file = new File([compressed], 'test.fastq.gz', { type: 'application/gzip' });

        const result = await FASTQParser.parseFASTQ(file);

        expect(result.reads).toHaveLength(1);
        expect(result.reads[0].sequence).toBe('ATCG');
    });

    it('handles empty files gracefully', async () => {
        const file = new File([], 'empty.fastq');
        await expect(FASTQParser.parseFASTQ(file)).rejects.toThrow('FASTQ file is empty');
    });

    it('correctly extracts sgRNAs using adapter trimming', () => {
        const adapter = 'AAACACC'; // Simplified adapter end
        const reads = [
            { id: '1', sequence: 'NNNNNNAAACACCGGGGGGGGGGGGGGGGGGGGTTTT', quality: '' }, // Match
            { id: '2', sequence: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', quality: '' }, // No match
        ];

        // Mock extractSgRNAs behavior
        const counts = FASTQParser.extractSgRNAs(reads as any, adapter);

        // Read 1: ...AAACACC [GGGGGGGGGGGGGGGGGGGG] (20 Gs)
        expect(counts.has('GGGGGGGGGGGGGGGGGGGG')).toBe(true);
        expect(counts.get('GGGGGGGGGGGGGGGGGGGG')).toBe(1);

        // Read 2: No adapter, falls back to first 20bp if valid?
        // "Fallback: use first 20bp if valid DNA"
        const first20 = 'AAAAAAAAAAAAAAAAAAAA';
        expect(counts.get(first20)).toBe(1);
    });

    it('calculates average quality scores correctly', async () => {
        // Quality encoding: '!' = 33 -> score 0. '?' = 63 -> score 30.
        const content = [
            '@R1', 'A', '+', '!', // score 0
            '@R2', 'A', '+', '?'  // score 30
        ].join('\n');
        const file = new File([content], 'qual.fastq');
        const result = await FASTQParser.parseFASTQ(file);

        // Total quality = 0 + 30 = 30. Total bases = 2. Avg = 15.
        expect(result.stats.avgQuality).toBe(15);
    });
});
