
import { describe, it, expect } from 'vitest';
import { loadRealLibrary } from '../analysis-utils';
import path from 'path';

describe('Real Library Loading', () => {
    const projectRoot = path.resolve(__dirname, '../../../../..');

    it('should load Brunello library from disk', async () => {
        // Brunello: ~76k entries
        const library = await loadRealLibrary('brunello', projectRoot);
        expect(library.size).toBeGreaterThan(70000);
        expect(library.has('CATCTTCTTTCACCTGAACG')).toBe(true);
        expect(library.get('CATCTTCTTTCACCTGAACG')).toBe('A1BG');
    });

    it('should load GeCKO v2 library (B) from disk', async () => {
        // GeCKO v2 Lib B: ~58k entries
        const library = await loadRealLibrary('gecko', projectRoot);
        expect(library.size).toBeGreaterThan(50000);
        expect(library.has('CAATGTGACGCTGACGTGCC')).toBe(true);
        expect(library.get('CAATGTGACGCTGACGTGCC')).toBe('A1BG');
    });

    it('should load TKO v3 library from disk', async () => {
        // TKO v3: ~71k
        const library = await loadRealLibrary('tko', projectRoot);
        expect(library.size).toBeGreaterThan(60000);
        expect(library.has('CAAGAGAAAGACCACGAGCA')).toBe(true);
        expect(library.get('CAAGAGAAAGACCACGAGCA')).toBe('A1BG');
    });

    it('should load Brie library from disk', async () => {
        // Brie: ~61k entries (total lines 61452)
        const library = await loadRealLibrary('brie', projectRoot);
        expect(library.size).toBeGreaterThan(60000);
        expect(library.has('TTACCTCAATATAAACGACA')).toBe(true);
        expect(library.get('TTACCTCAATATAAACGACA')).toBe('Pzp');
    });

    it('should fallback to synthetic for unknown library', async () => {
        const library = await loadRealLibrary('nonexistent', projectRoot);
        expect(library.size).toBeGreaterThan(0);
    });

    it('should load library when running from frontend subdirectory (simulating worker)', async () => {
        const frontendRoot = path.join(projectRoot, 'frontend');
        // The file is at projectRoot/data/libraries/raw/...
        // The code will try frontendRoot/data/libraries/raw (fail)
        // Then try frontendRoot/../data/libraries/raw (succeed)

        const library = await loadRealLibrary('brunello', frontendRoot);
        expect(library.size).toBeGreaterThan(70000);
    });
});
