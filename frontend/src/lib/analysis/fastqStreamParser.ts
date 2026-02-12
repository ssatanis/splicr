
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
}

/**
 * Server-side stream parser for FASTQ files.
 * Reduces memory usage by processing line-by-line instead of loading whole file.
 */
export class FastqStreamParser {
    static async processStream(
        filePath: string,
        library: { has(seq: string): boolean },
        adapterSequence: string = 'TCTTGTGGAAAGGACGAAACACC'
    ): Promise<StreamResult> {
        const fileStream = fs.createReadStream(filePath);

        // Auto-detect gzip by extension or magic bytes?
        // Start by peeking at magic bytes.
        // Or just try gunzip?
        // Let's rely on extension for now, but handle plain text too.

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

        const sgRNACounts = new Map<string, number>();
        const adapter = (adapterSequence || 'TCTTGTGGAAAGGACGAAACACC').trim().toUpperCase();
        const validDNA = /^[ATCG]+$/;

        let totalReads = 0;
        let totalQuality = 0;
        let totalLength = 0; // for avg length/quality calc
        let gcCount = 0;
        let totalBases = 0;
        let mappedReads = 0;

        let lineIndex = 0;
        let currentId = '';
        let currentSeq = '';

        // FASTQ: 4 lines per record.
        // 0: @ID
        // 1: Sequence
        // 2: +
        // 3: Quality

        for await (const line of rl) {

            const recordIndex = lineIndex % 4;

            if (recordIndex === 0) {
                if (!line.startsWith('@')) {
                    // Basic validation
                }
                currentId = line.substring(1);
            } else if (recordIndex === 1) {
                currentSeq = line.trim().toUpperCase();
            } else if (recordIndex === 3) {
                const quality = line.trim();
                totalReads++;

                // Stats
                totalLength += currentSeq.length;
                for (let i = 0; i < quality.length; i++) {
                    totalQuality += quality.charCodeAt(i) - 33;
                }
                for (const base of currentSeq) {
                    if (base === 'G' || base === 'C') gcCount++;
                    totalBases++;
                }

                // Processing
                // Try normal orientation
                let sgRNA = this.extractSgRNA(currentSeq, adapter, validDNA);

                // If not found, try reverse complement
                if (!sgRNA) {
                    const rcSeq = this.getReverseComplement(currentSeq);
                    sgRNA = this.extractSgRNA(rcSeq, adapter, validDNA);

                    if (sgRNA && library.has(sgRNA)) {
                        // It matched in RC mode!
                        // But wait, we should really detect orientation globally first to avoid mixed results?
                        // For now, let's try both transparency. 
                        // Better approach: If auto-detect isn't enabled, we might miss it.
                        // But here we are processing stream. 
                        // Let's stick to the plan: if a read doesn't match normal, try RC.
                        // If RC matches library, use it.
                    } else {
                        // Reset if it didn't match library in RC either
                        if (sgRNA && !library.has(sgRNA)) {
                            // It was a valid sgRNA string but not in library. 
                            // We'll stick with original extraction for consistency unless we confirm RC is better.
                            // Actually, let's just stick to the original if neither matches library.
                            sgRNA = this.extractSgRNA(currentSeq, adapter, validDNA);
                        }
                    }
                }

                if (sgRNA && sgRNA.length === 20) {
                    const key = sgRNA;
                    sgRNACounts.set(key, (sgRNACounts.get(key) || 0) + 1);
                } else if (totalReads < 5) {
                    // Debug log
                }
            }

            lineIndex++;
        }

        // Now calculate mappedReads strictly against library for return stats
        for (const [seq, count] of sgRNACounts.entries()) {
            if (library.has(seq)) {
                mappedReads += count;
            }
        }

        // Auto-detect check: If mapping rate is low (<5%), try re-counting with RC?
        // Streaming prevents easy re-pass. 
        // Modified approach: The StreamResult should probably return BOTH counts if we want to be safe, 
        // OR we just do the "try both" approach line-by-line.
        // The implementation Plan said: "Count library matches for Normal vs. RC... Returns best orientation".
        // To do that in a stream without buffering everything is tricky.
        // We will buffer the first 1000 reads to detect orientation, then process the rest.

        // Actually, let's implement the buffering strategy properly in a separate method or within processStream.
        // Since we can't easily rewind the stream in Node without reopening, 
        // and we want to keep it simple:
        // We will just try matching BOTH orientations against the library for every read.
        // Whichever matches the LIBRARY is the winner.
        // If both match (unlikely for 20bp), prefer Normal.

        return {
            sgRNACounts,
            totalReads,
            mappedReads,
            uniqueSgRNAs: sgRNACounts.size,
            avgQuality: totalBases > 0 ? totalQuality / totalBases : 0,
            gcContent: totalBases > 0 ? (gcCount / totalBases) * 100 : 0
        };
    }

    private static extractSgRNA(seq: string, adapter: string, validDNA: RegExp): string | null {
        let sgRNA: string | null = null;

        if (adapter.length > 0) {
            const adapterIndex = seq.indexOf(adapter);
            if (adapterIndex !== -1) {
                const sgRNAStart = adapterIndex + adapter.length;
                sgRNA = seq.substring(sgRNAStart, sgRNAStart + 20);
            }
        }

        if (!sgRNA || sgRNA.length !== 20 || !validDNA.test(sgRNA)) {
            const first20 = seq.length >= 20 ? seq.substring(0, 20) : null;
            if (first20 && validDNA.test(first20)) {
                sgRNA = first20;
            }
        }

        if (sgRNA && sgRNA.length === 20 && validDNA.test(sgRNA)) {
            return sgRNA;
        }
        return null;
    }

    public static getReverseComplement(seq: string): string {
        const complement: Record<string, string> = {
            'A': 'T', 'T': 'A', 'C': 'G', 'G': 'C',
            'N': 'N', 'R': 'Y', 'Y': 'R', 'M': 'K', 'K': 'M', 'S': 'S', 'W': 'W'
        };
        return seq.split('').reverse().map(b => complement[b] || b).join('');
    }

    // Updated processStream to handle orientation intelligently
    static async processStreamWithOrientation(
        filePath: string,
        library: { has(seq: string): boolean },
        adapterSequence: string = 'TCTTGTGGAAAGGACGAAACACC'
    ): Promise<StreamResult & { orientation: 'normal' | 'reverse-complement' | 'unknown' }> {
        // We'll reopen the stream to be safe if we need two passes, but let's try single pass with smart counting.
        // We will maintain two sets of counts: Normal and RC.
        // After processing, we see which one yielded better library mapping.

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
        const rcAdapter = this.getReverseComplement(adapter);

        let totalReads = 0;
        let totalQuality = 0;
        let totalBases = 0;
        let gcCount = 0;
        let totalLength = 0;

        let lineIndex = 0;
        let currentSeq = '';

        // Sample first 1000 reads to determine orientation? 
        // Or just do whole file? 
        // Doing whole file for both is safer and not much slower (just string reversal).

        for await (const line of rl) {
            if (!line.trim()) continue;

            const recordIndex = lineIndex % 4;
            if (recordIndex === 1) {
                currentSeq = line.trim().toUpperCase();
            } else if (recordIndex === 3) {
                const quality = line.trim();
                totalReads++;

                // Stats
                totalLength += currentSeq.length;
                for (let i = 0; i < quality.length; i++) {
                    totalQuality += quality.charCodeAt(i) - 33;
                }
                for (const base of currentSeq) {
                    if (base === 'G' || base === 'C') gcCount++;
                    totalBases++;
                }

                // 1. Try Normal
                const normalSgRNA = this.extractSgRNA(currentSeq, adapter, validDNA);
                if (normalSgRNA) {
                    normalCounts.set(normalSgRNA, (normalCounts.get(normalSgRNA) || 0) + 1);
                }

                // 2. Try RC
                // For RC, the adapter would be at the 3' end in theory? 
                // Or we simply RC the whole read and look for the adapter at 5'.
                // Usually in standard cloning, if reviewed/sequenced from other end, the whole thing is RC.
                const rcSeq = this.getReverseComplement(currentSeq);
                // We look for the adapter in the RC sequence.
                // Note: extractSgRNA uses the 'adapter' string passed in. 
                // If the read is RC, the adapter in the read is also RC.
                // So if we RC the read, we should find the NORMAL adapter sequence in it.
                const rcSgRNA = this.extractSgRNA(rcSeq, adapter, validDNA);
                if (rcSgRNA) {
                    rcCounts.set(rcSgRNA, (rcCounts.get(rcSgRNA) || 0) + 1);
                }
            }
            lineIndex++;
        }

        // Calculate mapping rates
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

        if (rcRate > normalRate && rcRate > 0.1) { // Threshold to switch
            orientation = 'reverse-complement';
            finalCounts = rcCounts;
            finalMapped = rcMapped;
        } else if (normalRate < 0.01 && rcRate < 0.01) {
            orientation = 'unknown'; // Both failed
        }

        const avgQuality = totalBases > 0 ? totalQuality / totalBases : 0;
        const gcContent = totalBases > 0 ? (gcCount / totalBases) * 100 : 0;

        return {
            sgRNACounts: finalCounts,
            totalReads,
            mappedReads: finalMapped,
            uniqueSgRNAs: finalCounts.size,
            avgQuality,
            gcContent,
            orientation
        };
    }
}
