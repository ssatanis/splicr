/**
 * Utility functions for manipulating sgRNA count matrices.
 */

export interface FilterStats {
    total: number;
    retained: number;
    filtered: number;
}

export function filterCountMatrix(
    countMatrix: Map<string, number[]>,
    sgRNAToGene: Map<string, string>,
    options: { minimumReads: number; removeRibosomal: boolean }
): { filteredMatrix: Map<string, number[]>; stats: FilterStats } {
    const filteredMatrix = new Map<string, number[]>();
    let retained = 0;
    let filtered = 0;

    for (const [sgRNA, counts] of countMatrix.entries()) {
        const gene = sgRNAToGene.get(sgRNA);

        // Filter by minimum reads (mean count across samples)
        const meanCount = counts.reduce((a, b) => a + b, 0) / counts.length;
        if (meanCount < options.minimumReads) {
            filtered++;
            continue;
        }

        // Filter ribosomal genes
        // Standard ribosomal patterns: RPL/RPS followed by number
        // E.g. RPL5, RPS19, RPLP0
        if (options.removeRibosomal && gene && /^RP[LS]\d+/.test(gene)) {
            filtered++;
            continue;
        }

        filteredMatrix.set(sgRNA, counts);
        retained++;
    }

    return {
        filteredMatrix,
        stats: { total: countMatrix.size, retained, filtered }
    };
}
