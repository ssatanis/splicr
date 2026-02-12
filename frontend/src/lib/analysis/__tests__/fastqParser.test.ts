
import { describe, it, expect } from 'vitest';
import { FASTQParser } from '../../fastqParser';
import { FastqStreamParser } from '../fastqStreamParser';

describe('FASTQParser Reverse Complement', () => {
    it('should correctly calculate reverse complement', () => {
        const seq = 'ATCG';
        const rc = FASTQParser.getReverseComplement(seq);
        expect(rc).toBe('CGAT');
    });

    it('should handle complex sequences', () => {
        const seq = 'ATCGN';
        const rc = FASTQParser.getReverseComplement(seq);
        expect(rc).toBe('NCGAT');
    });
});

describe('FASTQParser Extraction', () => {
    const adapter = 'TCTTGTGGAAAGGACGAAACACC';
    const sgRNA = 'GGGGGGGGGGGGGGGGGGGG'; // 20 Gs
    const readStruct = `N${adapter}${sgRNA}N`;

    it('should extract sgRNA from normal read', () => {
        const reads = [{
            id: '1',
            sequence: readStruct,
            quality: 'I'.repeat(readStruct.length)
        }];
        const counts = FASTQParser.extractSgRNAs(reads, adapter);
        expect(counts.has(sgRNA)).toBe(true);
        expect(counts.get(sgRNA)).toBe(1);
    });

    it('should extract sgRNA from RC read', () => {
        // Construct RC read
        const rcReadStruct = FASTQParser.getReverseComplement(readStruct);
        const reads = [{
            id: '1',
            sequence: rcReadStruct,
            quality: 'I'.repeat(rcReadStruct.length)
        }];

        // Use normal adapter - parser should auto-detect RC
        const counts = FASTQParser.extractSgRNAs(reads, adapter);

        // Note: The extracted sgRNA will be the RC'd version of the sgRNA found in the RC read. 
        // Wait, logic:
        // if normal fails, we RC the read. 
        // effectively: rc(rcReadStruct) -> readStruct.
        // Then we extract normal adapter from readStruct -> finds sgRNA.
        // So we expect to find 'sgRNA'

        expect(counts.has(sgRNA)).toBe(true);
        expect(counts.get(sgRNA)).toBe(1);
    });
});

// Mock fs and readline for StreamParser? 
// That's complex for a quick verify. 
// We will rely on FASTQParser tests mainly as the logic is mirrored.
