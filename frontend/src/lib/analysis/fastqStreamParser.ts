
import fs from 'fs';
import zlib from 'zlib';
import readline from 'readline';

export interface StreamResult {
    sgRNACounts: Map<string, number>;
    totalReads: number;
    mappedReads: number;
    uniqueSgRNAs: number;
    avgQuality: number;
    gcContent: number;
    orientation?: 'normal' | 'reverse-complement' | 'unknown';
    detectedOffset?: number;
    usedR2?: boolean;
}

/**
 * Server-side stream parser for FASTQ files.
 * Reduces memory usage by processing line-by-line instead of loading whole file.
 */
export class FastqStreamParser {
    static async processStream(
        filePath: string,
        library: { has(seq: string): boolean },
        adapterSequence: string = 'TCTTGTGGAAAGGACGAAACACC',
        guideLength: number = 20
    ): Promise<StreamResult> {
        // Legacy method wrapper - use processStreamWithOrientation
        const result = await this.processStreamWithOrientation(
            filePath,
            library,
            adapterSequence,
            undefined,
            guideLength
        );

        return {
            sgRNACounts: result.sgRNACounts,
            totalReads: result.totalReads,
            mappedReads: result.mappedReads,
            uniqueSgRNAs: result.uniqueSgRNAs,
            avgQuality: result.avgQuality,
            gcContent: result.gcContent
        };
    }

    static async processStreamWithOrientation(
        filePath: string,
        library: { has(seq: string): boolean },
        adapterSequence: string = 'TCTTGTGGAAAGGACGAAACACC',
        manualOffset?: number, // Optional manual override
        guideLength: number = 20, // Added guide length support
        pairedFilePath?: string // Optional R2 file path for fallback
    ): Promise<StreamResult> {

        // 1. Attempt detection on Primary File (R1)
        // If manual offset is provided, skip detection
        let detectedOffset = manualOffset;
        let useR2 = false;
        let activeFilePath = filePath;

        if (typeof manualOffset !== 'number') {
            // Auto-detect phase
            console.log(`[FastqStreamParser] Auto-detecting offset for ${filePath}...`);
            const r1Reads = await this.readFirstNReads(filePath, 5000); // Increased from 1000 to 5000
            const r1Offset = this.detectOptimalOffset(r1Reads, library, guideLength);

            if (r1Offset !== undefined) {
                detectedOffset = r1Offset;
                console.log(`[FastqStreamParser] Detected sgRNA offset ${r1Offset} on Read 1.`);
            } else {
                console.log(`[FastqStreamParser] Auto-offset detection failed on Read 1.`);

                // Fallback to R2 if provided
                if (pairedFilePath) {
                    console.log(`[FastqStreamParser] Checking Read 2 (${pairedFilePath}) for guide sequences...`);
                    const r2Reads = await this.readFirstNReads(pairedFilePath, 5000); // Increased from 1000 to 5000
                    const r2Offset = this.detectOptimalOffset(r2Reads, library, guideLength);

                    if (r2Offset !== undefined) {
                        detectedOffset = r2Offset;
                        useR2 = true;
                        activeFilePath = pairedFilePath;
                        console.log(`[FastqStreamParser] Found valid offset ${r2Offset} on Read 2. Switching to R2 for analysis.`);
                    } else {
                        console.log(`[FastqStreamParser] Auto-offset detection failed on Read 2 as well.`);
                    }
                }
            }
        } else {
            console.log(`[FastqStreamParser] Using manual offset ${manualOffset}.`);
        }

        // 2. Process the selected stream (R1 or R2) using the detected/manual offset
        // If detection failed completely (detectedOffset is undefined), we default to standard adapter/scaffold logic
        // but still process R1 (activeFilePath is R1).

        return await this.processFileStream(
            activeFilePath,
            library,
            adapterSequence,
            detectedOffset,
            guideLength,
            useR2
        );
    }

    private static async readFirstNReads(filePath: string, n: number): Promise<string[]> {
        const fileStream = fs.createReadStream(filePath);
        let inputStream: NodeJS.ReadableStream = fileStream;
        if (filePath.endsWith('.gz')) {
            const gunzip = zlib.createGunzip();
            fileStream.pipe(gunzip);
            inputStream = gunzip;
        }

        const rl = readline.createInterface({
            input: inputStream,
            crlfDelay: Infinity,
        });

        const reads: string[] = [];
        let lineIndex = 0;

        for await (const line of rl) {
            if (!line.trim()) continue;

            // Sequence is line 1 (0-based index 1)
            if (lineIndex % 4 === 1) {
                // Aggressive normalization: trim and uppercase
                reads.push(line.trim().toUpperCase());
                if (reads.length >= n) break;
            }
            lineIndex++;
        }

        rl.close();
        fileStream.destroy();
        return reads;
    }

    private static async processFileStream(
        filePath: string,
        library: { has(seq: string): boolean },
        adapterSequence: string,
        offset: number | undefined,
        guideLength: number,
        isR2: boolean
    ): Promise<StreamResult> {
        const fileStream = fs.createReadStream(filePath);
        let inputStream: NodeJS.ReadableStream = fileStream;
        if (filePath.endsWith('.gz')) {
            const gunzip = zlib.createGunzip();
            fileStream.pipe(gunzip);
            inputStream = gunzip;
        }

        const rl = readline.createInterface({
            input: inputStream,
            crlfDelay: Infinity,
        });

        const normalCounts = new Map<string, number>();
        const rcCounts = new Map<string, number>();
        const adapter = (adapterSequence || 'TCTTGTGGAAAGGACGAAACACC').trim().toUpperCase();
        const validDNA = /^[ATCG]+$/;

        let totalReads = 0;
        let totalQuality = 0;
        let totalBases = 0;
        let gcCount = 0;
        let totalLength = 0;

        let lineIndex = 0;
        let currentSeq = '';

        for await (const line of rl) {
            if (!line.trim()) continue;

            const recordIndex = lineIndex % 4;
            if (recordIndex === 1) {
                currentSeq = line.trim().toUpperCase();
            } else if (recordIndex === 3) {
                const quality = line.trim();
                totalReads++;

                totalLength += currentSeq.length;
                for (let i = 0; i < quality.length; i++) {
                    totalQuality += quality.charCodeAt(i) - 33;
                }
                for (const base of currentSeq) {
                    if (base === 'G' || base === 'C') gcCount++;
                    totalBases++;
                }

                // Normal processing
                this.processRead(currentSeq, adapter, validDNA, normalCounts, rcCounts, guideLength, offset);
            }
            lineIndex++;
        }

        // Determine orientation
        let normalMapped = 0;
        for (const [seq, count] of normalCounts.entries()) {
            if (library.has(seq)) normalMapped += count;
        }

        let rcMapped = 0;
        for (const [seq, count] of rcCounts.entries()) {
            if (library.has(seq)) rcMapped += count;
        }

        const normalRate = totalReads > 0 ? normalMapped / totalReads : 0;
        const rcRate = totalReads > 0 ? rcMapped / totalReads : 0;

        let finalCounts = normalCounts;
        let finalMapped = normalMapped;
        let orientation: 'normal' | 'reverse-complement' | 'unknown' = 'normal';

        // Prefer RC if it has significantly better mapping
        if (rcRate > normalRate && rcRate > 0.05) {
            orientation = 'reverse-complement';
            finalCounts = rcCounts;
            finalMapped = rcMapped;
        } else if (normalRate < 0.05 && rcRate < 0.05) {
            orientation = 'unknown';
        }

        // If we switched to R2, we might want to flag the orientation differently or just note it
        // The orientation here is relative to the READ sequence we processed.

        const avgQuality = totalBases > 0 ? totalQuality / totalBases : 0;
        const gcContent = totalBases > 0 ? (gcCount / totalBases) * 100 : 0;

        return {
            sgRNACounts: finalCounts,
            totalReads,
            mappedReads: finalMapped,
            uniqueSgRNAs: finalCounts.size,
            avgQuality,
            gcContent,
            orientation,
            detectedOffset: offset,
            usedR2: isR2
        };
    }

    public static getReverseComplement(seq: string): string {
        const complement: Record<string, string> = {
            'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C', 'N': 'N'
        };
        return seq.split('').reverse().map(b => complement[b] || b).join('');
    }

    // Helper to process a single read (Normal & RC)
    private static processRead(
        seq: string,
        adapter: string,
        validDNA: RegExp,
        normalCounts: Map<string, number>,
        rcCounts: Map<string, number>,
        guideLength: number,
        offset?: number
    ) {
        // 1. Try Normal
        const normalSgRNA = this.extractSgRNA(seq, adapter, validDNA, guideLength, offset);
        if (normalSgRNA) {
            normalCounts.set(normalSgRNA, (normalCounts.get(normalSgRNA) || 0) + 1);
        }

        // 2. Try RC
        const rcSeq = this.getReverseComplement(seq);
        const rcSgRNA = this.extractSgRNA(rcSeq, adapter, validDNA, guideLength, offset);
        if (rcSgRNA) {
            rcCounts.set(rcSgRNA, (rcCounts.get(rcSgRNA) || 0) + 1);
        }
    }

    // Detects optimal window by scanning positions 0-60
    private static detectOptimalOffset(reads: string[], library: { has(seq: string): boolean }, guideLength: number): number | undefined {
        const matchesPerOffset = new Map<number, number>();
        const total = reads.length;
        if (total === 0) return undefined;

        // Scan offsets 0 to 60
        for (let offset = 0; offset <= 60; offset++) {
            let matches = 0;
            for (const seq of reads) {
                // Ensure sequence is clean (though it should be from readFirstNReads)
                if (seq.length < offset + guideLength) continue;
                // Aggressive normalization: trim and uppercase
                const candidate = seq.substring(offset, offset + guideLength).trim().toUpperCase();
                if (library.has(candidate)) matches++;
            }
            matchesPerOffset.set(offset, matches);
        }

        // Sort offsets by hit count descending
        const sortedOffsets = Array.from(matchesPerOffset.entries())
            .map(([offset, count]) => ({ offset, count }))
            .filter(x => x.count > 0)
            .sort((a, b) => b.count - a.count);

        console.log(`[DEBUG] Offset detection: Checked ${total} reads.`);
        console.log(`[DEBUG] Top 10 offsets by hit count:`);
        sortedOffsets.slice(0, 10).forEach(x => {
            console.log(`[DEBUG]   Offset ${x.offset}: ${x.count} hits (${(100 * x.count / total).toFixed(1)}%)`);
        });

        if (sortedOffsets.length === 0) return undefined;

        const best = sortedOffsets[0];
        const maxHits = best.count;
        const secondBestHits = sortedOffsets.length > 1 ? sortedOffsets[1].count : 0;
        const bestOffset = best.offset;

        console.log(`[DEBUG] Best offset: ${bestOffset}, hits: ${maxHits}`);
        console.log(`[DEBUG] Second-best hits: ${secondBestHits}`);
        const passesThreshold = maxHits >= 10 && maxHits >= 2 * secondBestHits;
        console.log(`[DEBUG] Passes threshold (>=10 hits, >=2x second-best)? ${passesThreshold}`);

        // Criteria:
        // 1. Max hits >= 10 (absolute minimum)
        // 2. Max hits >= 2 * secondBestHits (dominance)

        if (passesThreshold) {
            return bestOffset;
        }

        return undefined;
    }

    private static extractSgRNA(seq: string, adapter: string, validDNA: RegExp, guideLength: number, offset?: number): string | null {
        // 0. Use fixed offset if provided
        if (typeof offset === 'number') {
            if (seq.length >= offset + guideLength) {
                const candidate = seq.substring(offset, offset + guideLength);
                if (candidate.length === guideLength && validDNA.test(candidate)) return candidate;
            }
            return null;
        }

        // 1. Try primary adapter
        if (adapter.length > 0) {
            const adapterIndex = seq.indexOf(adapter);
            if (adapterIndex !== -1) {
                const sgRNAStart = adapterIndex + adapter.length;
                const candidate = seq.substring(sgRNAStart, sgRNAStart + guideLength);
                if (candidate.length === guideLength && validDNA.test(candidate)) return candidate;
            }
        }

        // 2. Try common sgRNA scaffolds (GTTTTAGAGCTA...) if adapter fail or not provided
        const scaffolds = ['GTTTTAGAGCTA', 'GUUUUAGAGCUA', 'GTTTTAGAGC'];
        for (const scaffold of scaffolds) {
            const idx = seq.indexOf(scaffold);
            if (idx >= guideLength) { // Scaffold usually follows the sgRNA
                const candidate = seq.substring(idx - guideLength, idx);
                if (candidate.length === guideLength && validDNA.test(candidate)) return candidate;
            }
        }

        // 3. Last resort: first N bp if it looks like a read starting with sgRNA
        const firstN = seq.substring(0, guideLength);
        if (firstN.length === guideLength && validDNA.test(firstN)) {
            return firstN;
        }

        return null;
    }
}
