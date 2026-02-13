
/**
 * CRISPRoffT Optimization and Integration Module
 * 
 * Handles interaction with the CRISPRoffT database API to retrieve
 * experimentally validated off-target sites.
 */

interface ValidatedOffTarget {
    chromosome: string;
    position: number;
    sequence: string;
    mismatches: number;
    validation_method: string;
    cell_line: string;
    activity_score: number;
    study: string;
}

interface CRISPRoffTResponse {
    guide: string;
    validated_offtargets: ValidatedOffTarget[];
    predicted_offtargets: any[]; // We might not use their predictions if we use CRISPRitz
    total_validated: number;
    total_predicted: number;
}

interface EnrichedSgRNA {
    sgrnaId: string;
    sequence: string;
    pam: string;
    validatedOffTargets: ValidatedOffTarget[];
    maxActivity: number;
    detectedCellLines: string[];
}

const API_BASE_URL = 'https://ccsm.uth.edu/CRISPRoffT/api';

// Simple in-memory cache to avoid redundant requests during a single session
// In production, this should be replaced by Redis or a persistent cache
const CACHE = new Map<string, CRISPRoffTResponse>();

/**
 * Queries the CRISPRoffT database for a specific sgRNA.
 */
export async function queryCRISPRoffT(
    sgrnaSequence: string,
    pamType: string = 'NGG'
): Promise<CRISPRoffTResponse | null> {
    // Check cache first
    const cacheKey = `${sgrnaSequence}-${pamType}`;
    if (CACHE.has(cacheKey)) {
        return CACHE.get(cacheKey)!;
    }

    try {
        // Construct URL: GET /api/search?guide={sequence}&pam={type}&species=human
        const url = `${API_BASE_URL}/search?guide=${encodeURIComponent(sgrnaSequence)}&pam=${encodeURIComponent(pamType)}&species=human`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
        });

        if (!response.ok) {
            console.warn(`CRISPRoffT API error for ${sgrnaSequence}: ${response.statusText}`);
            return null;
        }

        const data = await response.json() as CRISPRoffTResponse;

        // Cache the result
        CACHE.set(cacheKey, data);

        return data;
    } catch (error) {
        console.error(`Failed to query CRISPRoffT for ${sgrnaSequence}:`, error);
        return null;
    }
}

/**
 * Enriches a list of sgRNAs with experimental off-target data.
 * Uses batch processing and rate limiting.
 */
export async function enrichWithExperimentalData(
    sgrnaList: { id: string; sequence: string; pam?: string }[]
): Promise<EnrichedSgRNA[]> {
    const enrichedList: EnrichedSgRNA[] = [];
    const BATCH_SIZE = 10;
    const DELAY_MS = 100; // Small delay to be polite to the API

    // Process in batches
    for (let i = 0; i < sgrnaList.length; i += BATCH_SIZE) {
        const batch = sgrnaList.slice(i, i + BATCH_SIZE);

        const promises = batch.map(async (sgRNA) => {
            const pam = sgRNA.pam || 'NGG';
            const data = await queryCRISPRoffT(sgRNA.sequence, pam);

            if (data && data.validated_offtargets) {
                // Extract key metrics
                const maxActivity = data.validated_offtargets.reduce(
                    (max, ot) => Math.max(max, ot.activity_score || 0), 0
                );

                const cellLines = Array.from(new Set(
                    data.validated_offtargets.map(ot => ot.cell_line).filter(Boolean)
                ));

                return {
                    sgrnaId: sgRNA.id,
                    sequence: sgRNA.sequence,
                    pam: pam,
                    validatedOffTargets: data.validated_offtargets,
                    maxActivity,
                    detectedCellLines: cellLines
                };
            }

            // Return empty structure if no data found
            return {
                sgrnaId: sgRNA.id,
                sequence: sgRNA.sequence,
                pam: pam,
                validatedOffTargets: [],
                maxActivity: 0,
                detectedCellLines: []
            };
        });

        const results = await Promise.all(promises);
        enrichedList.push(...results);

        // Rate limiting delay between batches
        if (i + BATCH_SIZE < sgrnaList.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    return enrichedList;
}
