import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runMageckPipeline } from '../mageck/mageck-executor';
import { buildMageckCountCommand, buildMageckTestCommand } from '../mageck/mageck-command-builder';
import { parseGeneSummary, mageckGeneToUnified } from '../mageck/mageck-result-parser';

// Mock fs and child_process.spawn inside executor if needed, 
// but here we focus on unit-testing the orchestration logic.

describe('MAGeCK CLI Integration', () => {
    describe('Command Builder', () => {
        it('should build a valid count command', () => {
            const params = {
                libraryPath: 'lib.txt',
                fastqPaths: ['s1.fastq', 's2.fastq'],
                sampleLabels: ['S1', 'S2'],
                outputPrefix: 'test_out',
                normMethod: 'median' as const,
            };
            const args = buildMageckCountCommand(params);
            expect(args).toContain('count');
            expect(args).toContain('--fastq');
            expect(args).toContain('s1.fastq');
            expect(args).toContain('s2.fastq');
            expect(args).toContain('--sample-label');
            expect(args).toContain('S1,S2');
        });

        it('should build a valid test (RRA) command', () => {
            const params = {
                countTablePath: 'counts.txt',
                treatmentColumns: 'S2',
                controlColumns: 'S1',
                outputPrefix: 'test_test',
                normMethod: 'median' as const,
            };
            const args = buildMageckTestCommand(params);
            expect(args).toContain('test');
            expect(args).toContain('-k');
            expect(args).toContain('counts.txt');
            expect(args).toContain('-t');
            expect(args).toContain('S2');
            expect(args).toContain('-c');
            expect(args).toContain('S1');
        });
    });

    describe('Result Parser', () => {
        it('should parse gene_summary.txt correctly', () => {
            const mockContent = `id\tnum\tneg|score\tneg|p-value\tneg|fdr\tneg|rank\tneg|goodsgrna\tneg|lfc\tpos|score\tpos|p-value\tpos|fdr\tpos|rank\tpos|goodsgrna\tpos|lfc
GENE1\t4\t0.001\t0.0001\t0.01\t1\t4\t-2.5\t0.9\t0.5\t0.8\t500\t0\t0.1
GENE2\t4\t0.8\t0.3\t0.7\t300\t1\t0.2\t0.002\t0.0002\t0.02\t2\t4\t2.1`;

            const results = parseGeneSummary(mockContent);
            expect(results).toHaveLength(2);
            expect(results[0].id).toBe('GENE1');
            expect(results[0].negLfc).toBe(-2.5);
            expect(results[1].id).toBe('GENE2');
            expect(results[1].posLfc).toBe(2.1);
        });

        it('should map MAGeCK results to Unified format', () => {
            const mageckResult = {
                id: 'PTEN',
                num: 4,
                negScore: 0.0001,
                negPValue: 0.00001,
                negFdr: 0.001,
                negRank: 1,
                negGoodSgrna: 4,
                negLfc: -3.2,
                posScore: 0.99,
                posPValue: 0.9,
                posFdr: 0.9,
                posRank: 18000,
                posGoodSgrna: 0,
            };

            const unified = mageckGeneToUnified(mageckResult as any, 0.05);
            expect(unified.gene).toBe('PTEN');
            expect(unified.log2FC).toBe(-3.2);
            expect(unified.fdr).toBe(0.001);
            expect(unified.rank).toBe(1);
        });
    });
});
