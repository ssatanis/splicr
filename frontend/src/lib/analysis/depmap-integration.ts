
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { mean, standardDeviation } from 'simple-statistics';

// Paths
const DATA_DIR = path.join(process.cwd(), 'data', 'depmap');
const DEPMAP_FILE = path.join(DATA_DIR, 'CRISPRGeneEffect.csv');
const REFERENCE_METADATA_FILE = path.join(DATA_DIR, 'reference_metadata.json');

// Types
export interface DepMapReference {
    cellLines: string[];
    genes: string[];
    data: number[][]; // Genes x CellLines (or vice versa, optimized for access)
}

/**
 * Ensures the data directory exists
 */
function ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
}

/**
 * Downloads the DepMap reference dataset (Mock implementation)
 * In production, this would stream from a heavy URL or an R2 bucket.
 */
export async function downloadDepMapReference(onProgress?: (progress: number) => void): Promise<void> {
    ensureDataDir();

    if (fs.existsSync(DEPMAP_FILE)) {
        // Already exists
        onProgress?.(100);
        return;
    }

    // MOCK DOWNLOAD
    console.log('Starting DepMap download...');
    let progress = 0;
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            progress += 10;
            onProgress?.(progress);
            if (progress >= 100) {
                clearInterval(interval);
                // Create a dummy file for testing
                createDummyDepMapFile();
                resolve();
            }
        }, 200);
    });
}

/**
 * Creates a small dummy CSV for testing/development if the real one isn't there.
 */
function createDummyDepMapFile() {
    const genes = ['A1BG', 'NAT1', 'ADA', 'CDH1', 'KRAS', 'TP53', 'MYC', 'BRCA1', 'BRCA2', 'PTEN'];
    const cellLines = ['ACH-000001', 'ACH-000002', 'ACH-000004', 'ACH-000005', 'ACH-000007'];

    let csvContent = 'ModelID,' + genes.join(',') + '\n';

    for (const line of cellLines) {
        const scores = genes.map(() => (Math.random() * 2 - 1).toFixed(4));
        csvContent += `${line},${scores.join(',')}\n`;
    }

    fs.writeFileSync(DEPMAP_FILE, csvContent);
}

/**
 * Loads the DepMap reference data into memory.
 * Optimized for row-wise access (by gene) or column-wise (by cell line) depending on usage.
 * ComBat usually needs Gene x Sample matrix.
 */
export async function loadDepMapReference(): Promise<DepMapReference | null> {
    if (!fs.existsSync(DEPMAP_FILE)) return null;

    const content = fs.readFileSync(DEPMAP_FILE, 'utf8');

    return new Promise((resolve, reject) => {
        Papa.parse(content, {
            header: true,
            dynamicTyping: true,
            skipEmptyLines: true,
            complete: (results) => {
                const data = results.data as Record<string, any>[];
                if (data.length === 0) return resolve(null);

                // Data is usually CellLine x Gene in the CSV (Rows=CellLines, Cols=Genes)
                // We need to transpose it potentially or just store it effectively.
                // The CSV header has 'ModelID' and then Genes.

                const genes = Object.keys(data[0]).filter(k => k !== 'ModelID');
                const cellLines = data.map(d => d.ModelID as string);

                // Convert to Matrix: Genes x CellLines (Standard for ComBat)
                // matrix[geneIndex][cellLineIndex]
                const matrix: number[][] = [];

                for (const gene of genes) {
                    const geneRow: number[] = [];
                    for (const row of data) {
                        geneRow.push(typeof row[gene] === 'number' ? row[gene] : NaN);
                    }
                    matrix.push(geneRow);
                }

                resolve({
                    cellLines,
                    genes,
                    data: matrix
                });
            },
            error: (err: any) => reject(err)
        });
    });
}

/**
 * Gets a subset of DepMap data matching a specific tissue or cell line list.
 */
export async function getDepMapSubset(
    reference: DepMapReference | null,
    tissue?: string,
    specificCellLines?: string[]
): Promise<DepMapReference | null> {
    if (!reference) return null;

    // Logic to filter by tissue would implement looking up metadata.
    // For now, return full set or filtered by specific cell lines if provided.

    if (specificCellLines && specificCellLines.length > 0) {
        const indices = specificCellLines.map(cl => reference.cellLines.indexOf(cl)).filter(i => i !== -1);
        if (indices.length === 0) return null;

        const newCellLines = indices.map(i => reference.cellLines[i]);
        const newData = reference.data.map(geneRow => indices.map(i => geneRow[i]));

        return {
            genes: reference.genes,
            cellLines: newCellLines,
            data: newData
        };
    }

    return reference;
}
