
import { describe, it, expect } from 'vitest';
import { detectLibrary, applyBatchCorrection, LIBRARIES } from '../../lib/analysis/batch-correction';
import { mean } from 'simple-statistics';

describe('Batch Correction Module', () => {

    describe('detectLibrary', () => {
        it('should detect Avana library based on sequences starting with A', async () => {
            const sequences = ['AAAAA', 'ATGCG', 'ACTGA'];
            const result = await detectLibrary(sequences);
            expect(result.name).toBe('Avana');
            expect(result.confidence).toBeGreaterThan(0.5);
            expect(result.details).toEqual(LIBRARIES.Avana);
        });

        it('should detect GeCKOv2 library based on sequences starting with G', async () => {
            const sequences = ['GGGGG', 'GATCG', 'GCTGA'];
            const result = await detectLibrary(sequences);
            expect(result.name).toBe('GeCKOv2');
            expect(result.details).toEqual(LIBRARIES.GeCKOv2);
        });

        it('should detect TKOv3 library based on sequences starting with T', async () => {
            const sequences = ['TTTTT', 'TATCG', 'TCTGA'];
            const result = await detectLibrary(sequences);
            expect(result.name).toBe('TKOv3');
            expect(result.details).toEqual(LIBRARIES.TKOv3);
        });

        it('should default to Brunello for other sequences', async () => {
            const sequences = ['CCCCC', 'CATCG', 'CCTGA'];
            const result = await detectLibrary(sequences);
            expect(result.name).toBe('Brunello');
            expect(result.details).toEqual(LIBRARIES.Brunello);
        });
    });

    describe('applyBatchCorrection', () => {
        // Synthetic data setup
        // Gene 1: User batch mean 10, Ref mean 20. SDs 2.
        // Gene 2: User batch mean 5, Ref mean 5. SDs 1.

        const geneList = ['Gene1', 'Gene2', 'Gene3'];

        // 3 samples for User
        const userMatrix = [
            [10, 12, 8],     // Gene 1 ~ N(10, 2)
            [5, 6, 4],       // Gene 2 ~ N(5, 1)
            [20, 22, 18]     // Gene 3 ~ N(20, 2)
        ];

        // 3 samples for Ref
        const refMatrix = [
            [20, 22, 18],    // Gene 1 ~ N(20, 2) - Shifted!
            [5, 6, 4],       // Gene 2 ~ N(5, 1) - No shift
            [10, 12, 8]      // Gene 3 ~ N(10, 2) - Shifted!
        ];

        it('should correct means to match reference', async () => {
            const result = await applyBatchCorrection(userMatrix, refMatrix, geneList);
            const corrected = result.correctedData;

            // Check Gene 1 corrected mean (should be close to Ref mean 20)
            const g1CorrectedMean = mean(corrected[0]);
            expect(g1CorrectedMean).toBeCloseTo(20, 0);

            // Check Gene 2 corrected mean (should stay close to 5)
            const g2CorrectedMean = mean(corrected[1]);
            expect(g2CorrectedMean).toBeCloseTo(5, 0);

            // Check Gene 3 corrected mean (should be close to Ref mean 10)
            const g3CorrectedMean = mean(corrected[2]);
            expect(g3CorrectedMean).toBeCloseTo(10, 0);
        });

        it('should return PCA coordinates and metrics', async () => {
            const result = await applyBatchCorrection(userMatrix, refMatrix, geneList);

            expect(result.metrics).toBeDefined();
            expect(result.metrics.pcaR2Before).toBeDefined();
            expect(result.metrics.pcaR2After).toBeDefined();

            expect(result.pcaCoordinates).toBeDefined();
            expect(result.pcaCoordinates?.length).toBeGreaterThan(0);

            // Expected R2 improvement: Batch effect should decrease
            // In this simple case, we aligned them perfectly, so "Batch" separation might disappear or change
            // verifying structure mostly
            const coords = result.pcaCoordinates!;
            expect(coords[0]).toHaveProperty('x');
            expect(coords[0]).toHaveProperty('y');
            expect(coords[0]).toHaveProperty('batch');
        });

        it('should throw error on gene mismatch', async () => {
            const badUserMatrix = [[1, 2], [3, 4]]; // 2 genes
            const badRefMatrix = [[1, 2]]; // 1 gene

            await expect(applyBatchCorrection(badUserMatrix, badRefMatrix, ['G1', 'G2']))
                .rejects.toThrow('Gene count mismatch');
        });
    });
});
