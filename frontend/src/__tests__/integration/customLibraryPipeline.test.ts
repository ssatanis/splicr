
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnalysisPipeline, AnalysisParameters } from '@/lib/analysis/pipeline';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Custom Library Pipeline Integration', () => {
    let tempDir: string;
    let customLibDir: string;
    let fastqPath: string;
    let customLibId: string;

    beforeEach(() => {
        // Setup temp dirs
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'splicr-test-'));
        customLibDir = path.join(os.tmpdir(), 'splicr-custom-libs');
        if (!fs.existsSync(customLibDir)) {
            fs.mkdirSync(customLibDir, { recursive: true });
        }

        // 1. Create Custom Library
        customLibId = `custom_test_${Date.now()}`;
        const libraryData = {
            id: customLibId,
            filename: 'test_library.csv',
            count: 2,
            guideLength: 21,
            preview: [],
            entries: [
                { id: 'g1', gene: 'GENE1', sequence: 'AAAAAAAAAAAAAAAAAAAAA' }, // 21 As
                { id: 'g2', gene: 'GENE2', sequence: 'TTTTTTTTTTTTTTTTTTTTT' }  // 21 Ts
            ]
        };
        fs.writeFileSync(path.join(customLibDir, `${customLibId}.json`), JSON.stringify(libraryData));

        // 2. Create FASTQ file
        fastqPath = path.join(tempDir, 'test_sample.fastq');
        // valid read: 5bp offset + 21bp guide + adapter
        const readSeq = 'NNNNN' + 'AAAAAAAAAAAAAAAAAAAAA' + 'TCTTGTGG';
        const quality = 'I'.repeat(readSeq.length);
        const fastqContent = `@seq1\n${readSeq}\n+\n${quality}\n`.repeat(10);
        fs.writeFileSync(fastqPath, fastqContent);
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        // Clean up specific custom lib
        if (customLibId) {
            const libPath = path.join(customLibDir, `${customLibId}.json`);
            if (fs.existsSync(libPath)) fs.unlinkSync(libPath);
        }
    });

    it('loads custom library and detects 21bp guides', async () => {
        const pipeline = new AnalysisPipeline();

        // Mock MAGeCK to avoid running actual algorithms (since we just test parsing/loading)
        // We can do this by mocking the module, but since we are in integration test, 
        // let's just let it run. It might fail at MAGeCK step due to few reads, 
        // but we can check logs before that.
        // Or we can mock the `runMageckPipeline` import.

        // For now, let's catch the error if MAGeCK fails, but verify logs first.

        const params: AnalysisParameters = {
            fdrThreshold: 0.05,
            lfcThreshold: 1,
            normalizationMethod: 'median',
            minimumReads: 1,
            removeRibosomal: false,
            bagelPermutations: 100,
            customLibraryId: customLibId,
            sgRNAOffset: undefined // Auto-detect
        };

        try {
            await pipeline.runPipeline(
                [fastqPath],
                [{
                    fileName: 'test_sample.fastq',
                    condition: 'control',
                    replicate: 1,
                    sampleName: 'TestSample'
                },
                {
                    fileName: 'test_sample.fastq',
                    condition: 'treatment',
                    replicate: 1,
                    sampleName: 'TestSample2'
                }], // duplicated for control/treatment pair requirement
                'custom',
                ['mageck'],
                params
            );
        } catch (e) {
            // It's expected to fail at stats/algorithm phase due to dummy data
            // console.log('Pipeline failed as expected (dummy data):', e);
        }

        // Verify Logs
        // 1. Library Loading
        const libLog = pipeline['logs'].find(l => l.step === 'library' && l.message.includes('Loaded Custom Library'));
        expect(libLog).toBeDefined();
        expect(libLog?.message).toContain('test_library.csv');
        expect(libLog?.message).toContain('(2 sgRNAs, len=21)');

        // 2. Parsing & Offset Detection
        const offsetLog = pipeline['logs'].find(l => l.message.includes('Auto-detected sgRNA offset at base 5'));
        expect(offsetLog).toBeDefined();

        // 3. Mapping
        // Since we had 10 reads of perfect match, mapping rate should be high?
        // Wait, 'Parsing test_sample.fastq' log doesn't contain mapping stats?
        // The logs usually show "Extracted X reads...".
        // Let's check for any success log in parsing.
    });

    it('respects manual offset override', async () => {
        const pipeline = new AnalysisPipeline();
        const params: AnalysisParameters = {
            fdrThreshold: 0.05,
            lfcThreshold: 1,
            normalizationMethod: 'median',
            minimumReads: 1,
            removeRibosomal: false,
            bagelPermutations: 100,
            customLibraryId: customLibId,
            sgRNAOffset: 0 // Wrong offset (real is 5)
        };

        try {
            await pipeline.runPipeline(
                [fastqPath],
                [{ fileName: 'test_sample.fastq', condition: 'control', replicate: 1, sampleName: 'C' }, { fileName: 'test_sample.fastq', condition: 'treatment', replicate: 1, sampleName: 'T' }],
                'custom',
                ['mageck'],
                params
            );
        } catch (e) { }

        const manualLog = pipeline['logs'].find(l => l.message.includes('Using manual sgRNA offset: 0'));
        expect(manualLog).toBeDefined();

        // Auto-detect log should NOT be present
        const offsetLog = pipeline['logs'].find(l => l.message.includes('Auto-detected sgRNA offset'));
        expect(offsetLog).toBeUndefined();
    });
});
