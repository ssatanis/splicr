
export interface CustomLibraryEntry {
    id: string;
    gene: string | null;
    sequence: string;
}

export interface CustomLibrarySummary {
    id: string;
    filename: string;
    count: number;
    guideLength: number;
    preview: CustomLibraryEntry[];
    entries: CustomLibraryEntry[]; // In-memory storage for now
}

export class CustomLibraryParser {
    /**
     * Parse a raw string content (CSV or TSV) into a structured library.
     * Enforces:
     * - Distinct sequences (warns/skips duplicates?) -> robustly handles duplicates by keeping first?
     * - Valid DNA characters (A, C, G, T, N) case-insensitive.
     * - Consistent guide length across the file (inferred from first valid entry).
     */
    static parse(content: string, filename: string): CustomLibrarySummary {
        const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
        if (lines.length < 2) {
            throw new Error("File is empty or too short. Requires header and at least one entry.");
        }

        // Detect delimiter (comma or tab) based on first line
        const firstLine = lines[0];
        const isTsv = firstLine.includes('\t');
        const delimiter = isTsv ? '\t' : ',';

        // Parse header to find columns
        const headers = firstLine.split(delimiter).map(h => h.trim().toLowerCase());

        // Heuristic for column mapping
        const colMap = {
            id: headers.findIndex(h => h.includes('id') || h.includes('name') || h.includes('sgrna')),
            gene: headers.findIndex(h => h.includes('gene') || h.includes('symbol')),
            seq: headers.findIndex(h => h.includes('seq') || h.includes('guide'))
        };

        if (colMap.seq === -1) {
            throw new Error("Could not identify a 'Sequence' column. Please ensure header contains 'Sequence' or 'sgRNA Sequence'.");
        }

        const entries: CustomLibraryEntry[] = [];
        let expectedLength: number | null = null;
        const validDNA = /^[ATCGN]+$/i;

        // Start from line 1 (skip header)
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(delimiter).map(c => c.trim());

            // Skip empty lines or widely malformed lines
            if (cols.length <= colMap.seq) continue;

            const rawSeq = cols[colMap.seq];
            const cleanSeq = rawSeq.toUpperCase();

            if (!validDNA.test(cleanSeq)) {
                // Warn or skip? For strictness, let's skip but maybe log?
                // Throwing might be too harsh for one bad line in 100k.
                continue;
            }

            // Infer expected length from first valid sequence
            if (expectedLength === null) {
                expectedLength = cleanSeq.length;
                if (expectedLength < 10 || expectedLength > 30) {
                    throw new Error(`Invalid guide length (${expectedLength}) in first entry. Expected 10-30bp.`);
                }
            } else if (cleanSeq.length !== expectedLength) {
                throw new Error(`Inconsistent guide length at line ${i + 1}. Expected ${expectedLength}, found ${cleanSeq.length}.`);
            }

            const id = colMap.id !== -1 ? cols[colMap.id] : `custom_sgrna_${i}`;
            const gene = colMap.gene !== -1 ? cols[colMap.gene] : null;

            entries.push({
                id,
                gene,
                sequence: cleanSeq
            });
        }

        if (entries.length === 0) {
            throw new Error("No valid sgRNA entries found.");
        }

        return {
            id: `custom_${Date.now()}`,
            filename,
            count: entries.length,
            guideLength: expectedLength!,
            preview: entries.slice(0, 5),
            entries
        };
    }
}
