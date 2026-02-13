
import { mean, sampleCorrelation } from './reproducibility-metrics';

/**
 * Suspicious Hit Detection Module
 * 
 * Identifies genes where sgRNAs show discordant phenotypes, suggesting
 * off-target effects or artifacts rather than true biological signal.
 */

interface SgRNAData {
    id: string;
    gene: string;
    lfc: number;
    offTargets: string[]; // List of off-target gene symbols
}

interface SuspiciousHit {
    geneSymbol: string;
    riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
    reasoning: string;
    flaggedSgRNAs: string[];
    concordanceScore: number;
    offTargetOverlap: number;
}

/**
 * Calculates the overlap coefficient between two sets of off-targets.
 */
function calculateOverlap(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }

    // Szymkiewicz-Simpson coefficient (Overlap Coefficient)
    return intersection / Math.min(setA.size, setB.size);
}

/**
 * Detects suspicious hits based on sgRNA discordance and shared off-targets.
 */
export function detectSuspiciousHits(
    hitGenes: string[],
    allSgRNAs: SgRNAData[] // Should filter to include only those targeting hitGenes
): SuspiciousHit[] {

    const results: SuspiciousHit[] = [];
    const geneGroups = new Map<string, SgRNAData[]>();

    // Group sgRNAs by gene
    for (const sg of allSgRNAs) {
        if (hitGenes.includes(sg.gene)) {
            if (!geneGroups.has(sg.gene)) {
                geneGroups.set(sg.gene, []);
            }
            geneGroups.get(sg.gene)!.push(sg);
        }
    }

    // Analyze each gene
    for (const [gene, sgRNAs] of geneGroups.entries()) {
        if (sgRNAs.length < 2) continue; // Cannot check discordance with 1 sgRNA

        // 1. Check Phenotypic Concordance
        // For simplicity, we check if signs match or if variance is low
        const lfcs = sgRNAs.map(s => s.lfc);
        const positive = lfcs.filter(l => l > 0).length;
        const negative = lfcs.filter(l => l < 0).length;

        // Simple concordance metric: do they agree on direction?
        // 1.0 = perfect agreement, 0.0 = complete disagreement
        const majorityDirection = Math.max(positive, negative);
        const concordance = majorityDirection / sgRNAs.length;

        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
        let reasoning = 'Concordant sgRNAs.';
        let sharedOffTargetOverlap = 0;

        if (concordance < 0.75) {
            riskLevel = 'HIGH';
            reasoning = 'Discordant sgRNA phenotypes (some positive, some negative). Likely artifact.';
        } else {
            // 2. Check for Shared Off-Targets (if concordant)
            // If multiple sgRNAs share the same off-target gene, the phenotype might be due to that off-target
            const allOffTargets = sgRNAs.map(s => new Set(s.offTargets));

            let totalOverlap = 0;
            let comparisons = 0;

            for (let i = 0; i < allOffTargets.length; i++) {
                for (let j = i + 1; j < allOffTargets.length; j++) {
                    totalOverlap += calculateOverlap(allOffTargets[i], allOffTargets[j]);
                    comparisons++;
                }
            }

            sharedOffTargetOverlap = comparisons > 0 ? totalOverlap / comparisons : 0;

            if (sharedOffTargetOverlap > 0.5) {
                riskLevel = 'MEDIUM'; // Or even HIGH depending on the off-target
                reasoning = 'Concordant sgRNAs but high overlap in off-targets. Possible shared off-target effect.';
            } else {
                reasoning = 'Concordant sgRNAs with distinct off-target profiles. High confidence hit.';
            }
        }

        results.push({
            geneSymbol: gene,
            riskLevel,
            reasoning,
            flaggedSgRNAs: sgRNAs.map(s => s.id),
            concordanceScore: concordance,
            offTargetOverlap: sharedOffTargetOverlap
        });
    }

    return results;
}

/**
 * Cross-checks with DepMap (mocked) to adjust risk.
 */
export function crossCheckWithDepMap(hits: SuspiciousHit[]): SuspiciousHit[] {
    // Mock DepMap essential list
    const knownEssentials = new Set(['MYC', 'TP53', 'RPS', 'RPL', 'PCNA']); // Partial list

    return hits.map(hit => {
        if (knownEssentials.has(hit.geneSymbol) || hit.geneSymbol.startsWith('RKP') || hit.geneSymbol.startsWith('RPS')) {
            if (hit.riskLevel === 'MEDIUM') {
                hit.riskLevel = 'LOW';
                hit.reasoning += ' (Known essential in DepMap).';
            }
        }
        return hit;
    });
}
