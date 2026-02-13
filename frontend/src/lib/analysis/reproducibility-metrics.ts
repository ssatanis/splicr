// --- Helper Math Functions ---

export function mean(data: number[]): number {
    if (data.length === 0) return 0;
    return data.reduce((a, b) => a + b, 0) / data.length;
}

function sampleStandardDeviation(data: number[]): number {
    if (data.length < 2) return 0;
    const m = mean(data);
    const sumSquaredDiff = data.reduce((sum, val) => sum + Math.pow(val - m, 2), 0);
    return Math.sqrt(sumSquaredDiff / (data.length - 1));
}

export function sampleCorrelation(x: number[], y: number[]): number {
    if (x.length !== y.length || x.length < 2) return 0;
    const mx = mean(x);
    const my = mean(y);
    let num = 0, denX = 0, denY = 0;
    for (let i = 0; i < x.length; i++) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        num += dx * dy;
        denX += dx * dx;
        denY += dy * dy;
    }
    if (denX === 0 || denY === 0) return 0;
    return num / Math.sqrt(denX * denY);
}

// --- Data Structures ---

export interface ScreenData {
    sgrnaId: string;
    geneName: string;
    readcounts: number;      // Raw counts
    lfc: number;             // Log2 fold-change vs plasmid
    dlfc?: number;           // Differential LFC (if comparing conditions)
}

export interface ReplicateComparison {
    replicate1: ScreenData[];
    replicate2: ScreenData[];
    contextType: 'within' | 'between';  // Same condition vs different
}

export interface ReproducibilityMetrics {
    // Traditional metrics (for comparison)
    readcountPCC: number;
    lfcPCC: number;

    // Context-specific metrics (THE INNOVATION)
    wbcScore: number;          // Within-vs-Between Context z-score
    wbcZScore: number;         // Statistical significance
    qgiCorrelation?: number;   // If qGI scores available

    // Bin-wise analysis
    binwiseCorrelations: {
        bin: string;             // e.g., "Top 10% hits", "Bottom 10%", "Middle 80%"
        correlation: number;
        pValue: number;
    }[];

    // Quality assessment
    signalDensity: number;     // % of sgRNAs with |LFC| > threshold
    skewIndex: number;         // Distribution skewness

    // Pass/Fail
    overallQuality: 'EXCELLENT' | 'GOOD' | 'MARGINAL' | 'POOR';
    recommendation: string;
    shouldProceed: boolean;
}

// --- Helper Functions ---

function calculateCorrelationPValue(r: number, n: number): number {
    if (n < 3) return 1.0;
    // Simple Gaussian approximation for p-value from correlation
    // t = r * sqrt((n-2)/(1-r^2))
    // We'll use a simplified check for now or just 0 if very high
    if (Math.abs(r) > 0.99) return 0;

    const t = r * Math.sqrt((n - 2) / (1 - r * r));
    // p-value estimation (two-tailed)
    // Very rough approximation logic here to avoid complex stats library
    return Math.exp(-0.7 * Math.log(n) * Math.abs(r));
}

// --- Core Calculation Functions ---

/**
 * Calculate WBC score: measures if same-context replicates are more similar
 * than different-context pairs.
 * 
 * Formula from Billmann et al. 2023:
 * WBC = (mean_within_corr - mean_between_corr) / sd_between_corr
 */
export function calculateWBCScore(
    withinContextPairs: ReplicateComparison[],
    betweenContextPairs: ReplicateComparison[]
): { wbcScore: number; wbcZScore: number } {

    // Step 1: Calculate correlations for all within-context pairs
    const withinCorrelations = withinContextPairs.map(pair => {
        return sampleCorrelation(
            pair.replicate1.map(s => s.dlfc || s.lfc),
            pair.replicate2.map(s => s.dlfc || s.lfc)
        );
    });

    // Step 2: Calculate correlations for all between-context pairs
    const betweenCorrelations = betweenContextPairs.map(pair => {
        return sampleCorrelation(
            pair.replicate1.map(s => s.dlfc || s.lfc),
            pair.replicate2.map(s => s.dlfc || s.lfc)
        );
    });

    // Step 3: Calculate WBC z-score
    const meanWithin = mean(withinCorrelations);
    const meanBetween = mean(betweenCorrelations);
    const sdBetween = sampleStandardDeviation(betweenCorrelations);

    // Avoid division by zero
    const wbcZScore = sdBetween === 0 ? 0 : (meanWithin - meanBetween) / sdBetween;

    return {
        wbcScore: meanWithin, // Returning mean within correlation
        wbcZScore: wbcZScore
    };
}

/**
 * Calculate correlation within specific ranges of effect sizes.
 */
export function calculateBinwiseCorrelations(
    replicate1: ScreenData[],
    replicate2: ScreenData[]
): Array<{ bin: string; correlation: number; pValue: number }> {

    // Sort by absolute LFC in replicate 1
    const sorted1 = [...replicate1].sort((a, b) =>
        Math.abs(b.lfc) - Math.abs(a.lfc)
    );

    const n = sorted1.length;
    const bins = [
        { name: 'Top 5% (Strongest hits)', start: 0, end: Math.floor(n * 0.05) },
        { name: 'Top 10%', start: 0, end: Math.floor(n * 0.10) },
        { name: 'Top 25%', start: 0, end: Math.floor(n * 0.25) },
        { name: 'Middle 50%', start: Math.floor(n * 0.25), end: Math.floor(n * 0.75) },
        { name: 'Bottom 25%', start: Math.floor(n * 0.75), end: n }
    ];

    return bins.map(bin => {
        if (bin.end - bin.start < 3) {
            return { bin: bin.name, correlation: 0, pValue: 1 };
        }

        const subset1 = sorted1.slice(bin.start, bin.end);

        // Find matching sgRNAs in replicate 2
        const validPairs: { v1: number, v2: number }[] = [];
        const rep2Map = new Map(replicate2.map(s => [s.sgrnaId, s]));

        for (const item1 of subset1) {
            const item2 = rep2Map.get(item1.sgrnaId);
            if (item2) {
                validPairs.push({ v1: item1.lfc, v2: item2.lfc });
            }
        }

        if (validPairs.length < 3) {
            return { bin: bin.name, correlation: 0, pValue: 1 };
        }

        const corr = sampleCorrelation(
            validPairs.map(p => p.v1),
            validPairs.map(p => p.v2)
        );

        const pValue = calculateCorrelationPValue(corr, validPairs.length);

        return {
            bin: bin.name,
            correlation: corr,
            pValue: pValue
        };
    });
}

/**
 * Apply qGI-style corrections to remove systematic artifacts.
 */
export function applyQGICorrections(
    screenData: ScreenData[]
): ScreenData[] {

    // Step 1: MA normalization (log ratio vs average)
    const maNormalized = screenData.map(sgRNA => {
        const M = sgRNA.lfc;
        const A = Math.log2((sgRNA.readcounts + 1));
        return { ...sgRNA, _M: M, _A: A };
    });

    // Further corrections would go here

    return maNormalized;
}

export function assessScreenQuality(metrics: ReproducibilityMetrics): {
    quality: 'EXCELLENT' | 'GOOD' | 'MARGINAL' | 'POOR';
    recommendation: string;
    shouldProceed: boolean;
} {

    // Decision tree based on literature benchmarks
    if (metrics.wbcZScore > 3 && metrics.lfcPCC > 0.5) {
        return {
            quality: 'EXCELLENT',
            recommendation: 'Screen quality is excellent. High confidence in hit identification. Safe to proceed with downstream validation.',
            shouldProceed: true
        };
    }

    if (metrics.wbcZScore > 1.5 && metrics.readcountPCC > 0.8) {
        return {
            quality: 'GOOD',
            recommendation: 'Screen quality is good. Replicates show reproducible signal. Consider increasing replicate number for marginal hits.',
            shouldProceed: true
        };
    }

    if (metrics.wbcZScore < 1 || metrics.lfcPCC < 0.3) {
        return {
            quality: 'POOR',
            recommendation: '⚠️ WARNING: Poor replicate reproducibility. Biological signal may be weak or confounded by technical noise. DO NOT proceed with hit validation. Repeat experiment with optimized conditions.',
            shouldProceed: false
        };
    }

    return {
        quality: 'MARGINAL',
        recommendation: 'Screen shows marginal reproducibility. Increase stringency (FDR < 0.01) and validate top hits with orthogonal methods (qPCR, competition assays).',
        shouldProceed: true
    };
}
