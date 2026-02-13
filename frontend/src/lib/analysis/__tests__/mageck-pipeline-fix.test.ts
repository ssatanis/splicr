
import { runMageckPipeline } from '../mageck/mageck-executor';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

// Mock fs and child_process
jest.mock('fs');
jest.mock('child_process');

describe('MAGeCK Pipeline Executor', () => {
    const mockSpawn = spawn as unknown as jest.Mock;
    const mockFsExists = fs.existsSync as unknown as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockFsExists.mockReturnValue(true);
    });

    it('skips mageck count when inputCountTable is provided', async () => {
        // Setup mock process for 'mageck test'
        const mockChildProcess = new EventEmitter() as any;
        mockChildProcess.stdout = new EventEmitter();
        mockChildProcess.stderr = new EventEmitter();
        mockChildProcess.kill = jest.fn();

        // Simulate successful execution
        setTimeout(() => {
            mockChildProcess.emit('close', 0);
        }, 10);

        mockSpawn.mockReturnValue(mockChildProcess);

        const workingDir = '/tmp/test-analysis';
        const countTablePath = '/tmp/test-analysis/counts.txt';

        await runMageckPipeline(
            {
                libraryPath: 'brunello',
                fastqPaths: [], // No FASTQs provided
                sampleLabels: [],
                inputCountTable: countTablePath,
                outputPrefix: 'test_out'
            },
            {
                countTablePath: countTablePath, // Redundant but required by type if we were running test mainly
                controlColumns: 'Control',
                treatmentColumns: 'Treatment',
                outputPrefix: 'test_out'
            },
            { workingDir }
        );

        // Verify spawn was NOT called for 'count'
        // 'mageck count' normally has 'count' as first arg
        const spawnCalls = mockSpawn.mock.calls;
        const countCalls = spawnCalls.filter((call: any[]) => call[1][0] === 'count');
        expect(countCalls.length).toBe(0);

        // Verify spawn WAS called for 'test'
        const testCalls = spawnCalls.filter((call: any[]) => call[1][0] === 'test');
        expect(testCalls.length).toBe(1);

        // Valid args for 'test'
        const testArgs = testCalls[0][1];
        expect(testArgs).toContain('-k');
        expect(testArgs).toContain(countTablePath);
    });

    it('runs mageck count when inputCountTable is NOT provided', async () => {
        // Setup mock process
        const mockChildProcess = new EventEmitter() as any;
        mockChildProcess.stdout = new EventEmitter();
        mockChildProcess.stderr = new EventEmitter();
        setTimeout(() => {
            mockChildProcess.emit('close', 0);
        }, 10);
        mockSpawn.mockReturnValue(mockChildProcess);

        await runMageckPipeline(
            {
                libraryPath: 'brunello',
                fastqPaths: ['read1.fastq'],
                sampleLabels: ['sample1'],
                outputPrefix: 'test_out'
                // No inputCountTable
            },
            {
                countTablePath: 'dummy',
                controlColumns: 'Control',
                treatmentColumns: 'Treatment',
                outputPrefix: 'test_out'
            },
            { workingDir: '/tmp' }
        );

        const spawnCalls = mockSpawn.mock.calls;
        const countCalls = spawnCalls.filter((call: any[]) => call[1][0] === 'count');
        expect(countCalls.length).toBe(1);
    });
});
