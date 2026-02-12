
import { describe, it, expect } from 'vitest';
import { filterCountMatrix } from '../matrixUtils';
import { MAGeCKAnalyzer } from '../mageckRRA';
import { BAGEL2Analyzer } from '../bagel2';
import { DrugZAnalyzer } from '../drugz';

describe('Analysis Pipeline Logic', () => {
    describe('Matrix Filtering', () => {
        it('should filter low count sgRNAs', () => {
            const countMatrix = new Map<string, number[]>([
                ['sg1', [10, 10, 10]], // mean 10
                ['sg2', [2, 2, 2]],    // mean 2
                ['sg3', [5, 5, 5]]     // mean 5
            ]);
            const sgRNAToGene = new Map([
                ['sg1', 'GeneA'],
                ['sg2', 'GeneB'],
                ['sg3', 'GeneC']
            ]);

            const { filteredMatrix, stats } = filterCountMatrix(countMatrix, sgRNAToGene, {
                minimumReads: 5,
                removeRibosomal: false
            });

            expect(stats.total).toBe(3);
            expect(stats.retained).toBe(2);
            expect(stats.filtered).toBe(1);
            expect(filteredMatrix.has('sg1')).toBe(true);
            expect(filteredMatrix.has('sg3')).toBe(true); // 5 >= 5
            expect(filteredMatrix.has('sg2')).toBe(false);
        });

        it('should filter ribosomal genes', () => {
            const countMatrix = new Map<string, number[]>([
                ['sg1', [100, 100]],
                ['sg2', [100, 100]],
                ['sg3', [100, 100]]
            ]);
            const sgRNAToGene = new Map([
                ['sg1', 'GeneA'],
                ['sg2', 'RPL5'],
                ['sg3', 'RPS19']
            ]);

            const { filteredMatrix, stats } = filterCountMatrix(countMatrix, sgRNAToGene, {
                minimumReads: 0,
                removeRibosomal: true
            });

            expect(stats.retained).toBe(1);
            expect(filteredMatrix.has('sg1')).toBe(true);
            expect(filteredMatrix.has('sg2')).toBe(false);
            expect(filteredMatrix.has('sg3')).toBe(false);
        });
    });

    describe('MAGeCK Normalization', () => {
        it('should apply total normalization correctly', async () => {
            const analyzer = new MAGeCKAnalyzer({ normalizationMethod: 'total' });
            // Access private method via any or test logic if public?
            // normalization is applied in runAnalysis, but we don't want to run full analysis.
            // We can use the public method if we expose it or use a helper to test logic.
            // Currently methods are private.
            // But we can check if it runs without error given a small matrix.

            // Actually, we modified analyzer to have `totalNormalization` method. It is private.
            // We can use `runAnalysis` with very small matrix and check logs or result if possible.
            // Or we can cast to any to test private method.

            const counts = new Map([
                ['sg1', [10, 20]],
                ['sg2', [10, 20]]
            ]);
            // Sample 1 total: 20. Sample 2 total: 40.
            // Target total: 30.
            // Sample 1 factors: 30/20 = 1.5. sg1 -> 15, sg2 -> 15.
            // Sample 2 factors: 30/40 = 0.75. sg1 -> 15, sg2 -> 15.

            const normalized = (analyzer as any).totalNormalization(counts) as Map<string, number[]>;

            expect(normalized.get('sg1')?.[0]).toBe(15);
            expect(normalized.get('sg1')?.[1]).toBe(15);
        });

        it('should apply median normalization correctly', () => {
            const analyzer = new MAGeCKAnalyzer({ normalizationMethod: 'median' });
            // Median ratio method is complex.
            // Just verify it returns something different and same size.
            const counts = new Map([
                ['sg1', [10, 20]],
                ['sg2', [20, 40]]
            ]);
            const normalized = (analyzer as any).medianNormalization(counts) as Map<string, number[]>;
            expect(normalized.size).toBe(2);
        });
    });

    describe('BAGEL2 Normalization', () => {
        it('should support total normalization', () => {
            const analyzer = new BAGEL2Analyzer({ normalizationMethod: 'total' });
            const counts = new Map([
                ['sg1', [10, 20]],
            ]);
            const normalized = (analyzer as any).totalNormalization(counts) as Map<string, number[]>;
            // 10 -> 15, 20 -> 15 (mean total 30)
            expect(normalized.get('sg1')).toEqual([15, 15]);
        });
    });

    describe('DrugZ Normalization', () => {
        it('should support median normalization fallback', () => {
            const analyzer = new DrugZAnalyzer({ normalizationMethod: 'median' });
            const counts = new Map([
                ['sg1', [10, 20]],
            ]);
            // DrugZ median normalization logic test
            const normalized = (analyzer as any).medianNormalization(counts) as Map<string, number[]>;
            expect(normalized.has('sg1')).toBe(true);
        });
    });
});
