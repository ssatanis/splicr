/**
 * Utility functions for manipulating sgRNA count matrices.
 */

export interface FilterStats {
    originalSgRnaCount: number;
    filteredSgRnaCount: number;
    removedSgRnaCount: number;
    removedFraction: number;
    meanReadDepth: number;
}

export function filterCountMatrix(
    countMatrix: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    options: { minimumReads: number; removeRibosomal: boolean }
): { filteredMatrix: Map<string, number[]>; stats: FilterStats } {
    // Compute pre-filtering stats
    const originalSgRnaCount = countMatrix.size;
    let sumTotalReads = 0;

    // Calculate mean read depth on ORIGINAL matrix
    for (const counts of countMatrix.values()) {
        const totalReadsForSgRNA = counts.reduce((a, b) => a + b, 0);
        sumTotalReads += totalReadsForSgRNA;
    }
    const meanReadDepth = originalSgRnaCount > 0 ? sumTotalReads / originalSgRnaCount : 0;

    const filteredMatrix = new Map<string, number[]>();
    let retained = 0;
    let filtered = 0;

    for (const [sgRNA, counts] of countMatrix.entries()) {
        const gene = sgRNAToGene.get(sgRNA);

        // Filter by minimum reads (mean count across samples)
        // Note: User prompt implies "min reads" is usually mean count
        // "Min reads = 30" -> usually means average coverage. 
        // Existing logic used meanCount, preserving that.
        const meanCount = counts.reduce((a, b) => a + b, 0) / counts.length;

        if (meanCount < options.minimumReads) {
            filtered++;
            continue;
        }

        // Filter ribosomal genes
        // Standard ribosomal patterns: RPL/RPS followed by number
        if (options.removeRibosomal && gene && /^RP[LS]\d+/.test(gene)) {
            filtered++;
            continue;
        }

        filteredMatrix.set(sgRNA, counts);
        retained++;
    }

    return {
        filteredMatrix,
        stats: {
            originalSgRnaCount,
            filteredSgRnaCount: retained,
            removedSgRnaCount: filtered,
            removedFraction: originalSgRnaCount > 0 ? filtered / originalSgRnaCount : 0,
            meanReadDepth
        }
    };
}
