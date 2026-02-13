
import fs from 'fs';
import path from 'path';
import { getLibrary as getSyntheticLibrary } from './sgRNALibraries';

// Map library types to their real file paths (relative to project root)
const LIBRARY_FILES: Record<string, string> = {
    'brunello': 'data/libraries/raw/brunello-library-contents.txt',
    'gecko': 'data/libraries/raw/gecko-v2-library-b.csv',
    'tko': 'data/libraries/raw/tko-v3-guide-sequences.xlsx',
    'brie': 'data/libraries/raw/brie-library-contents.txt',
};

/**
 * Loads a real sgRNA library from disk based on the libraryType.
 * Supports:
 *  - Brunello (TXT/TSV)
 *  - Brie (TXT/TSV)
 *  - GeCKO v2 (CSV, focusing on Library B)
 *  - TKO v3 (XLSX)
 * 
 * Falls back to synthetic library if file is missing or parsing fails.
 * Returns Map<sequence, geneSymbol>
 */
export async function loadRealLibrary(libraryType: string, projectRoot: string = process.cwd()): Promise<Map<string, string>> {
    const relativePath = LIBRARY_FILES[libraryType];

    if (!relativePath) {
        console.warn(`[Library] No real library file mapped for '${libraryType}'. Using synthetic library fallback.`);
        return getSyntheticLibrary(libraryType);
    }

    const filename = path.basename(relativePath); // Extract filename from the mapped path
    let fullPath = '';

    // Discovery logic: Try to find project root by looking for 'data' directory
    let currentDir = projectRoot;
    let foundPath: string | null = null;

    // Search up to 3 levels up for the data directory
    for (let i = 0; i < 3; i++) {
        const checkPath = path.resolve(currentDir, relativePath);
        if (fs.existsSync(checkPath)) {
            foundPath = checkPath;
            break;
        }
        currentDir = path.resolve(currentDir, '..');
    }

    if (!foundPath) {
        // Try standard data/libraries/raw fallback if specific relativePath check failed
        const secondaryParent = path.resolve(projectRoot, '..', 'data/libraries/raw', filename);
        if (fs.existsSync(secondaryParent)) {
            foundPath = secondaryParent;
        }
    }

    if (foundPath) {
        fullPath = foundPath;
    } else {
        // Last resort: Check absolute docker path
        const dockerPath = path.join('/app/data/libraries/raw', filename);
        if (fs.existsSync(dockerPath)) {
            console.log(`[Library] Found library file in Docker path: ${dockerPath}`);
            fullPath = dockerPath;
        } else {
            console.warn(`[Library] Library file '${filename}' not found in expected locations.`);
        }
    }


    if (!fs.existsSync(fullPath)) {
        console.warn(`[Library] Real library file not found at ${fullPath}. Using synthetic library fallback.`);
        return getSyntheticLibrary(libraryType);
    }

    console.log(`[Library] Loading real library '${libraryType}' from ${fullPath}...`);
    const library = new Map<string, string>();
    let loadedCount = 0;

    try {
        if (libraryType === 'tko') {
            // TKO v3 is an XLSX file
            try {
                // Dynamic import to avoid bundling xlsx on client if this code were shared (though it's server-side)
                const XLSX = await import('xlsx');
                const workbook = XLSX.readFile(fullPath);
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];

                // TKO Header: GENE, SEQUENCE, GUIDE_ID, TARGET EXON
                const rows = XLSX.utils.sheet_to_json<any>(sheet);

                for (const row of rows) {
                    if (row.SEQUENCE && row.GENE) {
                        // Aggressive normalization: trim and uppercase
                        const seq = String(row.SEQUENCE).trim().toUpperCase();
                        const gene = String(row.GENE).trim();
                        // Validate: must be 20bp ACGT (or similar length)
                        if (seq && gene && /^[ACGTN]+$/.test(seq)) {
                            library.set(seq, gene);
                            loadedCount++;
                        }
                    }
                }
            } catch (e) {
                console.error(`[Library] Failed to parse XLSX file for TKO: ${e}`);
                throw e;
            }
        } else if (libraryType === 'gecko') {
            // GeCKO v2 Library B (CSV)
            // Header: gene_id,UID,seq,...
            // Note: File might use legacy Mac line endings (\r) or standard (\n)
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            const lines = content.split(/\r?\n|\r/).filter(l => l.trim().length > 0);

            // Basic CSV parsing
            // Expected columns: gene_id (0), UID (1), seq (2)
            // Verify header roughly
            const header = lines[0].toLowerCase();
            const hasSeq = header.includes('seq');
            const hasGene = header.includes('gene');

            let geneIdx = 0;
            let seqIdx = 2; // Default for Gecko lib B

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                // CSV split by comma
                // Note: simple split is okay if fields don't contain commas, which they shouldn't for ID/Seq
                const cols = line.split(',');

                if (cols.length > seqIdx) {
                    const gene = cols[geneIdx]?.trim();
                    const seq = cols[seqIdx]?.trim().toUpperCase();

                    if (seq && gene && seq.length >= 19) { // strict length check? usually 20
                        library.set(seq, gene);
                        loadedCount++;
                    }
                }
            }

        } else if (libraryType === 'brunello' || libraryType === 'brie') {
            // Brunello and Brie are Tab-delimited TXT files from Addgene
            // Brunello: Target Gene Symbol (1), sgRNA Target Sequence (6) - verified
            // Brie: Target Gene Symbol (1), sgRNA Target Sequence (6) - verified

            console.log(`[Library] Reading ${libraryType} from ${fullPath}`);
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            const lines = content.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);

            if (lines.length === 0) {
                console.warn(`[Library] File content for ${libraryType} at ${fullPath} is empty.`);
            }

            let geneIdx = 1;
            let seqIdx = 6;

            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                const cols = line.split('\t');

                if (cols.length > seqIdx) {
                    const gene = cols[geneIdx]?.trim();
                    // Aggressive normalization
                    const seq = cols[seqIdx]?.trim().toUpperCase();

                    // Validate
                    if (seq && gene && /^[ACGTN]+$/.test(seq)) {
                        library.set(seq, gene);
                        loadedCount++;
                    }
                }
            }
            console.log(`[Library] Parsed ${loadedCount} entries for ${libraryType}`);
        } else {
            console.warn(`[Library] Unknown library type '${libraryType}' format. Returning synthetic.`);
            return getSyntheticLibrary(libraryType);
        }

        console.log(`[Library] Successfully loaded ${loadedCount} sgRNAs for '${libraryType}' from ${relativePath}`);

        if (library.size === 0) {
            console.warn(`[Library] Parsed 0 entries from ${fullPath}. Check parsing logic. Using synthetic fallback.`);
            return getSyntheticLibrary(libraryType);
        }

        return library;

    } catch (error) {
        console.error(`[Library] Error loading library ${fullPath}:`, error);
        return getSyntheticLibrary(libraryType);
    }
}
