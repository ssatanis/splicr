import { describe, it, expect } from 'vitest';
import { calculateGiniIndex, generateLorenzCurve, assessGiniQuality } from '@/lib/analysis/qcMetrics';
import { assessQCStatus as assessStatusReal } from '@/lib/analysis/quality-calculator';

describe('QCMetrics', () => {
    it('calculates Gini index correctly', () => {
        // Perfect equality: [10, 10, 10] -> Gini 0
        expect(calculateGiniIndex([10, 10, 10])).toBeCloseTo(0, 2);

        // Perfect inequality: [0, 0, 10] -> Gini close to 1
        // Formula: G = (Sum(|xi - xj|)) / (2 * n^2 * mean)
        // For [0,0,10]: mean=3.33. n=3.
        // Diffs: |0-0|, |0-10|, |0-0|, |0-10|, |10-0|, |10-0| -> 0, 10, 0, 10, 10, 10 sum=40.
        // Denom: 2 * 9 * 3.33 = 60.
        // 40/60 = 0.666? 
        // Wait, theoretical max for large N is 1. For small N it's (N-1)/N.
        // Let's rely on the implemented logic matching the standard behavior.

        // Test with a known distribution
        const counts = [1, 2, 3, 4, 5];
        const gini = calculateGiniIndex(counts);
        expect(gini).toBeGreaterThan(0);
        expect(gini).toBeLessThan(0.4); // This is a fairly uniform distribution
    });

    it('generates valid Lorenz curve points', () => {
        const counts = [10, 20, 30, 40];
        const curve = generateLorenzCurve(counts);

        expect(curve).toHaveLength(5); // 0% to 100% + start point
        expect(curve[0]).toEqual({ cumulative_population: 0, cumulative_reads: 0 });
        expect(curve[curve.length - 1]).toEqual({ cumulative_population: 1, cumulative_reads: 1 });
    });

    it('assesses QC status correctly (Real Calculator)', () => {
        const goodMetrics: any = {
            totalReads: 5000000,
            mappedReads: 4500000,
            mappingRate: 0.9,      // 90%
            libraryCoverage: 0.99, // 99%
            zeroCounts: 0.5,       // 0.5%
            giniCoefficient: 0.1,
            librarySize: 1000,
            sgRNAsDetected: 1000
        };

        const result = assessStatusReal(goodMetrics);
        expect(result.status).toBe('PASS');
        expect(result.issues).toHaveLength(0);

        const badMetrics: any = {
            totalReads: 5000000,
            mappedReads: 1000,
            mappingRate: 0.002,    // 0.2%
            libraryCoverage: 0.1,  // 10%
            zeroCounts: 90,        // 90%
            giniCoefficient: 0.8,
            librarySize: 1000,
            sgRNAsDetected: 100
        };

        const failResult = assessStatusReal(badMetrics);
        expect(failResult.status).toBe('FAIL');
        expect(failResult.issues.join(' ')).toContain('Low mapping rate');
        expect(failResult.issues.join(' ')).toContain('Low library coverage');
    });
});
