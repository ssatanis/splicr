import pako from 'pako';

export interface FASTQRead {
  id: string;
  sequence: string;
  quality: string;
}

export interface FASTQStats {
  totalReads: number;
  avgReadLength: number;
  avgQuality: number;
  gcContent: number;
}

export class FASTQParser {
  /**
   * Parse FASTQ file (handles both plain and gzipped)
   */
  static async parseFASTQ(file: File): Promise<{
    reads: FASTQRead[];
    stats: FASTQStats;
  }> {
    const arrayBuffer = await file.arrayBuffer();
    let content: string;

    // Check if file is gzipped by extension or magic number
    const isGzipped = file.name.endsWith('.gz') ||
                      (new Uint8Array(arrayBuffer).length > 2 &&
                       new Uint8Array(arrayBuffer)[0] === 0x1f &&
                       new Uint8Array(arrayBuffer)[1] === 0x8b);

    if (isGzipped) {
      // Decompress gzipped file
      content = pako.ungzip(new Uint8Array(arrayBuffer), { to: 'string' });
    } else {
      // Plain text file
      const decoder = new TextDecoder('utf-8');
      content = decoder.decode(arrayBuffer);
    }

    const lines = content.split('\n').filter(line => line.trim());
    const reads: FASTQRead[] = [];

    // FASTQ format: 4 lines per read
    for (let i = 0; i < lines.length; i += 4) {
      if (i + 3 >= lines.length) break;

      const id = lines[i].substring(1);
      const sequence = lines[i + 1];
      const quality = lines[i + 3];

      if (sequence && quality) {
        reads.push({ id, sequence, quality });
      }
    }

    const stats = this.calculateStats(reads);
    return { reads, stats };
  }

  /**
   * Parse gzipped FASTQ file (legacy method, use parseFASTQ instead)
   */
  static async parseGzippedFASTQ(file: File): Promise<{
    reads: FASTQRead[];
    stats: FASTQStats;
  }> {
    return this.parseFASTQ(file);
  }

  private static calculateStats(reads: FASTQRead[]): FASTQStats {
    if (reads.length === 0) {
      return { totalReads: 0, avgReadLength: 0, avgQuality: 0, gcContent: 0 };
    }

    let totalLength = 0;
    let totalQuality = 0;
    let gcCount = 0;
    let totalBases = 0;

    for (const read of reads) {
      totalLength += read.sequence.length;

      for (let i = 0; i < read.quality.length; i++) {
        totalQuality += read.quality.charCodeAt(i) - 33;
      }

      for (const base of read.sequence) {
        if (base === 'G' || base === 'C') gcCount++;
        totalBases++;
      }
    }

    return {
      totalReads: reads.length,
      avgReadLength: totalLength / reads.length,
      avgQuality: totalQuality / (reads.reduce((sum, r) => sum + r.quality.length, 0)),
      gcContent: (gcCount / totalBases) * 100
    };
  }

  /**
   * Extract sgRNA sequences (20bp). Tries adapter-first; falls back to first 20bp if valid DNA.
   */
  static extractSgRNAs(reads: FASTQRead[], adapterSequence: string): Map<string, number> {
    const sgRNACounts = new Map<string, number>();
    const adapter = (adapterSequence || 'TCTTGTGGAAAGGACGAAACACC').trim();
    const validDNA = /^[ATCG]+$/;

    for (const read of reads) {
      const seq = read.sequence.toUpperCase();
      let sgRNA: string | null = null;

      if (adapter.length > 0) {
        const adapterIndex = seq.indexOf(adapter);
        if (adapterIndex !== -1) {
          const sgRNAStart = adapterIndex + adapter.length;
          sgRNA = seq.substring(sgRNAStart, sgRNAStart + 20);
        }
      }

      // Fallback: use first 20bp if valid DNA (e.g. when adapter absent or different)
      if (!sgRNA || sgRNA.length !== 20 || !validDNA.test(sgRNA)) {
        const first20 = seq.length >= 20 ? seq.substring(0, 20) : null;
        if (first20 && validDNA.test(first20)) {
          sgRNA = first20;
        }
      }

      if (sgRNA && sgRNA.length === 20 && validDNA.test(sgRNA)) {
        sgRNACounts.set(sgRNA, (sgRNACounts.get(sgRNA) || 0) + 1);
      }
    }

    return sgRNACounts;
  }
}
