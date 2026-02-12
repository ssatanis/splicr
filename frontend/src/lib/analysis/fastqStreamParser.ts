
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
            if (!line.trim()) continue; // Skip empty lines

            const recordIndex = lineIndex % 4;

            if (recordIndex === 0) {
                if (!line.startsWith('@')) {
                    // Basic validation
                    // console.warn(`Invalid FASTQ line ${lineIndex}: expected @ at start`);
                    // But continue? Or throw?
                    // If it's occasional corruption we might just skip.
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
                let sgRNA: string | null = null;

                // Adapter matching
                if (adapter.length > 0) {
                    const adapterIndex = currentSeq.indexOf(adapter);
                    if (adapterIndex !== -1) {
                        const sgRNAStart = adapterIndex + adapter.length;
                        sgRNA = currentSeq.substring(sgRNAStart, sgRNAStart + 20);
                    }
                }

                // Fallback
                if (!sgRNA || sgRNA.length !== 20 || !validDNA.test(sgRNA)) {
                    const first20 = currentSeq.length >= 20 ? currentSeq.substring(0, 20) : null;
                    if (first20 && validDNA.test(first20)) {
                        sgRNA = first20;
                    }
                }

                if (sgRNA && sgRNA.length === 20 && validDNA.test(sgRNA)) {
                    // Unified map key: uppercase
                    const key = sgRNA; // already uppercased

                    // IMPORTANT: Only count if it's in the library?
                    // Original pipeline filtered later. But stream parser calc logic does:
                    // mappedReads += count if library.has(seq)
                    // So we can still store all valid sgRNAs here, but maybe warn if many are invalid?

                    sgRNACounts.set(key, (sgRNACounts.get(key) || 0) + 1);
                } else if (totalReads < 5) {
                    console.log(`[Parser Debug] Read ${totalReads} failed valid sgRNA extraction. Seq: ${currentSeq.substring(0, 30)}... Adapter index: ${currentSeq.indexOf(adapter)}`);
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

        const avgReadLength = totalReads > 0 ? totalLength / totalReads : 0;
        const avgQuality = totalBases > 0 ? totalQuality / totalBases : 0; // Using bases instead of totalLength * reads? Wait logic in FASTQParser used quality length.
        const gcContent = totalBases > 0 ? (gcCount / totalBases) * 100 : 0;

        return {
            sgRNACounts,
            totalReads,
            mappedReads,
            uniqueSgRNAs: sgRNACounts.size,
            avgQuality,
            gcContent
        };
    }
}
