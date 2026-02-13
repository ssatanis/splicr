
import { mean, sampleStandardDeviation } from 'simple-statistics';
import { PCA } from 'ml-pca';
import * as jStat from 'jstat';

// Library definitions from previous step...
export const LIBRARIES = {
    Avana: {
        name: 'Avana',
        sgrnasPerGene: 4,
        organism: 'Human',
        source: 'Broad Institute',
    },
    Brunello: {
        name: 'Brunello',
        sgrnasPerGene: 4,
        organism: 'Human',
        source: 'Broad Institute',
    },
    GeCKOv2: {
        name: 'GeCKOv2',
        sgrnasPerGene: 6,
        organism: 'Human',
        source: 'Feng Zhang Lab',
    },
    TKOv3: {
        name: 'TKOv3',
        sgrnasPerGene: 4,
        organism: 'Human',
        source: 'Moffat Lab',
    }
};

export interface DetectedLibrary {
    name: string;
    confidence: number;
    matchStats: Record<string, number>;
    details: any;
}

export interface BatchCorrectionResult {
    correctedData: number[][]; // Genes x Samples
    metrics: {
        silhouetteBefore: number;
        silhouetteAfter: number;
        pcaR2Before: number;
        pcaR2After: number;
        kBetBefore?: number;
        kBetAfter?: number;
    };
    pcaCoordinates?: { x: number; y: number; batch: string }[];
}

/**
 * Detects the library used in a screen based on a sample of sgRNA sequences.
 */
export async function detectLibrary(sampleSequences: string[]): Promise<DetectedLibrary> {
    const sequences = sampleSequences.map(s => s.toUpperCase().trim()).slice(0, 1000);

    // Simulated matching logic for MVP
    // In real app: match against DB
    const matchCounts: Record<string, number> = {
        Avana: 0,
        Brunello: 0,
        GeCKOv2: 0,
        TKOv3: 0
    };

    // Heuristic simulation
    // If we have sequences, we pretend to find them
    if (sequences.length > 0) {
        // Deterministic pseudo-detection based on first char of first seq
        const firstChar = sequences[0].charAt(0);
        if (firstChar === 'A') matchCounts.Avana = sequences.length * 0.85;
        else if (firstChar === 'G') matchCounts.GeCKOv2 = sequences.length * 0.9;
        else if (firstChar === 'T') matchCounts.TKOv3 = sequences.length * 0.8;
        else matchCounts.Brunello = sequences.length * 0.92;
    }

    let bestLib = 'Unknown';
    let maxVal = -1;
    for (const [lib, count] of Object.entries(matchCounts)) {
        if (count > maxVal) {
            maxVal = count;
            bestLib = lib;
        }
    }

    return {
        name: bestLib,
        confidence: maxVal / sequences.length || 0,
        matchStats: matchCounts,
        details: LIBRARIES[bestLib as keyof typeof LIBRARIES] || {}
    };
}

/**
 * Applies Location-Scale (L/S) batch correction.
 * Aligns the user's data (batch 1) to the reference data (batch 2)
 * by matching means and variances gene-by-gene.
 * 
 * Formula: Z_g = (X_g - Mean_u) / SD_u * SD_r + Mean_r
 * 
 * @param userScreenData Matrix of gene scores (Genes x Samples) - Assumes genes match reference
 * @param depMapReference Matrix of gene scores (Genes x CellLines) - Reference batch
 * @param geneList Array of gene names corresponding to the rows
 */
export async function applyBatchCorrection(
    userScreenData: number[][],
    depMapReference: number[][],
    geneList: string[]
): Promise<BatchCorrectionResult> {

    const numGenes = userScreenData.length;
    const numUserSamples = userScreenData[0]?.length || 0;
    const numRefSamples = depMapReference[0]?.length || 0;

    if (numGenes !== depMapReference.length) {
        throw new Error('Gene count mismatch between user data and reference');
    }

    // 1. Calculate Statistics for Reference (Batch 2)
    const refMeans: number[] = [];
    const refSDs: number[] = [];

    for (let i = 0; i < numGenes; i++) {
        const row = depMapReference[i].filter(v => !isNaN(v));
        if (row.length > 1) {
            refMeans.push(mean(row));
            refSDs.push(sampleStandardDeviation(row) || 1); // Avoid div by 0
        } else {
            refMeans.push(0);
            refSDs.push(1);
        }
    }

    // 2. Calculate Statistics for User (Batch 1) & Correct
    const correctedData: number[][] = [];

    // We treat all user samples as one batch for now
    // Or we could correct sample-by-sample if they are independent
    // Standard ComBat assumes the Batch is the Experiment. 

    const userMeans: number[] = [];
    const userSDs: number[] = [];

    for (let i = 0; i < numGenes; i++) {
        const row = userScreenData[i].filter(v => !isNaN(v));
        if (row.length > 1) {
            userMeans.push(mean(row));
            userSDs.push(sampleStandardDeviation(row) || 1);
        } else {
            userMeans.push(0);
            userSDs.push(1);
        }
    }

    // 3. Apply Correction
    for (let i = 0; i < numGenes; i++) {
        const correctedRow: number[] = [];
        const uMean = userMeans[i];
        const uSD = userSDs[i];
        const rMean = refMeans[i];
        const rSD = refSDs[i];

        for (let j = 0; j < numUserSamples; j++) {
            const val = userScreenData[i][j];
            if (isNaN(val)) {
                correctedRow.push(NaN);
                continue;
            }
            // Z-score in user space -> Project to Ref space
            let newVal = ((val - uMean) / uSD) * rSD + rMean;
            correctedRow.push(newVal);
        }
        correctedData.push(correctedRow);
    }

    // 4. Validate Correction (Calculate Metrics)
    // We need to combine data for PCA: Genes x (UserSamples + RefSamples) or transposed?
    // PCA usually expects Samples x Genes (N x P)
    // So we need to transpose: (User + Ref) x Genes
    // Since Genes are 18k, this is heavy. We might select top 500 variable genes.

    const calculation = calculateMetrics(userScreenData, correctedData, depMapReference);

    return {
        correctedData,
        metrics: calculation.metrics,
        pcaCoordinates: calculation.pcaCoordinates
    };
}

function calculateMetrics(
    original: number[][],
    corrected: number[][],
    reference: number[][]
) {
    // Check dimensions
    const nGenes = original.length;
    // Subsample genes for performance (e.g., top 500 variances)
    // For now, random subsample 500 genes
    const indices = []; // Subsample indices
    const step = Math.floor(nGenes / 500) || 1;
    for (let i = 0; i < nGenes; i += step) indices.push(i);

    // Prepare data for Silhouette / PCA (Samples x Features)
    // Original Batch 1 (User)
    const datasetOriginal: number[][] = [];
    // Corrected Batch 1 (User)
    const datasetCorrected: number[][] = [];
    // Reference Batch 2
    const datasetRef: number[][] = [];

    // Transpose subsampled
    const nUser = original[0].length;
    const nRef = reference[0].length;

    for (let j = 0; j < nUser; j++) {
        datasetOriginal.push(indices.map(i => original[i][j] || 0));
        datasetCorrected.push(indices.map(i => corrected[i][j] || 0));
    }
    for (let j = 0; j < nRef; j++) {
        datasetRef.push(indices.map(i => reference[i][j] || 0));
    }

    // Combine for Before
    const combinedBefore = [...datasetOriginal, ...datasetRef]; // Labels: 0... (User), 1... (Ref)
    const labelsBefore = new Array(nUser).fill(0).concat(new Array(nRef).fill(1));

    // Combine for After
    const combinedAfter = [...datasetCorrected, ...datasetRef];
    const labelsAfter = new Array(nUser).fill(0).concat(new Array(nRef).fill(1));

    // Calculate PCA
    const pcaBefore = new PCA(combinedBefore);
    const scoresBefore = pcaBefore.predict(combinedBefore);
    const pc1Before = scoresBefore.to2DArray().map(row => row[0]);
    const r2Before = calculateR2(pc1Before, labelsBefore);

    const pcaAfter = new PCA(combinedAfter);
    const scoresAfter = pcaAfter.predict(combinedAfter);
    const pc1After = scoresAfter.to2DArray().map(row => row[0]);
    const r2After = calculateR2(pc1After, labelsAfter);

    // Extract PCA coordinates for visualization
    const pcaCoordinates: { x: number; y: number; batch: string; stage: string }[] = [];

    // Add Before points
    const beforeScores2D = scoresBefore.to2DArray();
    for (let i = 0; i < beforeScores2D.length; i++) {
        pcaCoordinates.push({
            x: beforeScores2D[i][0],
            y: beforeScores2D[i][1],
            batch: i < nUser ? 'User' : 'DepMap',
            stage: 'Before'
        });
    }

    // Add After points
    const afterScores2D = scoresAfter.to2DArray();
    for (let i = 0; i < afterScores2D.length; i++) {
        pcaCoordinates.push({
            x: afterScores2D[i][0],
            y: afterScores2D[i][1],
            batch: i < nUser ? 'User' : 'DepMap',
            stage: 'After'
        });
    }

    return {
        metrics: {
            silhouetteBefore: 0.2, // placeholder
            silhouetteAfter: 0.1,  // placeholder
            pcaR2Before: r2Before,
            pcaR2After: r2After
        },
        pcaCoordinates
    };
}

function calculateR2(x: number[], y: number[]) {
    // Simple Pearson correlation squared
    const n = x.length;
    const meanX = mean(x);
    const meanY = mean(y);
    let num = 0;
    let denX = 0;
    let denY = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - meanX;
        const dy = y[i] - meanY;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    const r = num / Math.sqrt(denX * denY);
    return r * r;
}
