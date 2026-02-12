import { describe, it, expect } from 'vitest';
import { matchSequences, LibraryData } from '@/lib/libraryLoader';

describe('LibraryLoader', () => {
    const mockLibrary: LibraryData = {
        metadata: {
            id: 'test-lib',
            name: 'Test Library',
            organism: 'Human',
            library_type: 'knockout',
            description: 'Test',
            total_sgrnas: 3,
            genes_targeted: 3,
            sgrnas_per_gene: 1,
            addgene_id: '',
            addgene_url: '',
            files: [],
            file_format: 'csv',
            columns: {}
        },
        sgRNAMap: new Map([
            ['AAAAA', { sequence: 'AAAAA', gene_symbol: 'GeneA', library_id: 'test-lib' }],
            ['CCCCC', { sequence: 'CCCCC', gene_symbol: 'GeneB', library_id: 'test-lib' }],
            ['GGGGG', { sequence: 'GGGGG', gene_symbol: 'GeneC', library_id: 'test-lib' }]
        ]),
        totalLoaded: 3
    };

    it('correctly matches sequences against the library', () => {
        const sequenceCounts = new Map([
            ['AAAAA', 10], // Match GeneA
            ['CCCCC', 5],  // Match GeneB
            ['TTTTT', 100] // No match
        ]);

        const result = matchSequences(sequenceCounts, mockLibrary);

        expect(result.matches).toHaveLength(2);

        // Check GeneA
        const geneA = result.matches.find(m => m.gene_symbol === 'GeneA');
        expect(geneA).toBeDefined();
        expect(geneA?.count).toBe(10);

        // Check GeneB
        const geneB = result.matches.find(m => m.gene_symbol === 'GeneB');
        expect(geneB?.count).toBe(5);

        // Check unmatched
        expect(result.unmatched).toHaveLength(1);
        expect(result.unmatched[0].sequence).toBe('TTTTT');
        expect(result.unmatched[0].count).toBe(100);
    });

    it('calculates correct statistics', () => {
        const sequenceCounts = new Map([
            ['AAAAA', 10],
            ['CCCCC', 5],
            ['TTTTT', 5] // Unmatched
        ]);

        const result = matchSequences(sequenceCounts, mockLibrary);

        expect(result.stats.totalReads).toBe(20);
        expect(result.stats.matchedReads).toBe(15);
        expect(result.stats.unmatchedReads).toBe(5);
        expect(result.stats.matchRate).toBe(0.75); // 15/20
        expect(result.stats.uniqueSgRNAs).toBe(2);
        expect(result.stats.genesDetected).toBe(2);
        expect(result.stats.libraryCoverage).toBeCloseTo(0.67, 1); // 2 out of 3 total sgRNAs
    });
});
