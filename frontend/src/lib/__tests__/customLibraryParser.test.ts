import { describe, it, expect } from 'vitest';
import { CustomLibraryParser } from '@/lib/customLibraryParser';

describe('CustomLibraryParser', () => {
    it('parses a valid CSV with correct headers', () => {
        const content = `id,gene,sequence
        sg1,GENE1,ACGTACGTACGTACGTACGT
        sg2,GENE2,AAAAAAAAAAAAAAAAAAAA`;

        const result = CustomLibraryParser.parse(content, 'test.csv');
        expect(result.count).toBe(2);
        expect(result.guideLength).toBe(20);
        expect(result.entries[0]).toEqual({ id: 'sg1', gene: 'GENE1', sequence: 'ACGTACGTACGTACGTACGT' });
    });

    it('parses a valid TSV', () => {
        const content = `ID\tSymbol\tSequence
        sg1\tGENE1\tACGTACGTACGTACGTACGT
        sg2\tGENE2\tAAAAAAAAAAAAAAAAAAAA`;

        const result = CustomLibraryParser.parse(content, 'test.tsv');
        expect(result.count).toBe(2);
    });

    it('handles case-insensitive headers and sequences', () => {
        const content = `my_id,Gene_Symbol,Guide_Seq
        sg1,gene1,acgtacgtacgtacgtacgt`;

        const result = CustomLibraryParser.parse(content, 'test.csv');
        expect(result.count).toBe(1);
        expect(result.entries[0].sequence).toBe('ACGTACGTACGTACGTACGT');
    });

    it('throws error on missing sequence column', () => {
        const content = `id,gene
        sg1,GENE1`;
        expect(() => CustomLibraryParser.parse(content, 'test.csv')).toThrow("Could not identify a 'Sequence' column");
    });

    it('throws error on inconsistent lengths', () => {
        const content = `id,sequence
        sg1,AAAAA
        sg2,AAAAAAAAAA`; // Mixed length

        // First entry sets expectation. 5bp is invalid (10-30 expected).
        expect(() => CustomLibraryParser.parse(content, 'test.csv')).toThrow("Invalid guide length");
    });

    it('validates guide length range (10-30)', () => {
        const content = `id,sequence
        sg1,ACTG`; // 4bp
        expect(() => CustomLibraryParser.parse(content, 'test.csv')).toThrow("Invalid guide length");
    });

    it('skips invalid DNA characters', () => {
        const content = `id,sequence
         sg1,ACGTACGTACGTACGTACGT
         sg2,ZZZZZZZZZZZZZZZZZZZZ`; // Invalid

        const result = CustomLibraryParser.parse(content, 'test.csv');
        expect(result.count).toBe(1);
        expect(result.entries[0].id).toBe('sg1');
    });
});
