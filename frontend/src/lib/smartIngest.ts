
import { loadLibrary, LibraryData } from './libraryLoader';
import * as fs from 'fs';
import * as readline from 'readline';
import * as zlib from 'zlib';
import { calculateGiniIndex } from './analysis/qcMetrics';

// ============================================================================
// Types
// ============================================================================

export type DataType = 'fastq' | 'bam' | 'count_table';
export type DesignType = 'simple_control_treatment' | 'timecourse' | 'multi_condition' | 'unknown';

export interface SmartIngestResult {
    dataType: DataType;
    countMatrix: Record<string, Record<string, number>>; // sgRNA -> sample -> count
    sampleMetadata: SampleMetadata[];
    inferredDesign: DesignType;
    warnings: string[];
}

export interface SampleMetadata {
    sampleId: string;
    conditionLabel: 'control' | 'treatment' | 'other';
    replicateId: number;
    originalName: string;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function smartIngestScreenFile(
    filePath: string,
    originalFilename: string,
    libraryId: string
): Promise<SmartIngestResult> {
    const warnings: string[] = [];

    // 1. Detect File Type
    const dataType = detectFileType(originalFilename);
    console.log(`[SmartIngest] Detected file type: ${dataType} for ${originalFilename}`);

    // 2. Load Library
    let library: LibraryData | null = null;
    try {
        library = await loadLibrary(libraryId);
    } catch (error) {
        warnings.push(`Failed to load library ${libraryId}: ${(error as Error).message}`);
    }

    // 3. Process File
    let countMatrix: Record<string, Record<string, number>> = {};
    let samples: string[] = [];

    if (dataType === 'fastq' || dataType === 'bam') {
        const result = await ingestFastq(filePath, originalFilename, dataType, library);
        countMatrix = result.countMatrix;
        samples = result.samples;
        if (result.warning) warnings.push(result.warning);
    } else {
        const result = await ingestCountTable(filePath);
        countMatrix = result.countMatrix;
        samples = result.samples;
        warnings.push(...result.warnings);
    }

    // 4. Infer Design & Metadata
    const { sampleMetadata, design } = inferDesign(samples, originalFilename, dataType, countMatrix);

    // 5. Post-processing
    const conditions = new Set(sampleMetadata.map(s => s.conditionLabel));
    if (!conditions.has('control') && design !== 'multi_condition') {
        warnings.push("No control samples detected. Please manually assign labels.");
    }

    return {
        dataType,
        countMatrix,
        sampleMetadata,
        inferredDesign: design,
        warnings,
    };
}

// ============================================================================
// 1. File Type Detection
// ============================================================================

export function detectFileType(filename: string): DataType {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.fastq') || lower.endsWith('.fastq.gz') || lower.endsWith('.fq') || lower.endsWith('.fq.gz')) {
        return 'fastq';
    }
    if (lower.endsWith('.bam') || lower.endsWith('.cram') || lower.endsWith('.sam')) {
        return 'bam';
    }
    return 'count_table';
}

// ============================================================================
// 2. FASTQ Ingestion
// ============================================================================

async function ingestFastq(
    filePath: string,
    originalFilename: string,
    type: 'fastq' | 'bam',
    library: LibraryData | null
): Promise<{ countMatrix: Record<string, Record<string, number>>; samples: string[]; warning?: string }> {

    if (type === 'bam') {
        return {
            countMatrix: {},
            samples: [],
            warning: "BAM file ingestion is not yet fully implemented. Please convert to FASTQ."
        };
    }

    const sampleId = originalFilename.replace(/\.(fastq|fq)(\.gz)?$/i, '');
    const counts: Record<string, number> = {};

    if (library) {
        for (const seq of library.sgRNAMap.keys()) {
            counts[seq] = 0;
        }
    }

    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: filePath.endsWith('.gz') ? fileStream.pipe(zlib.createGunzip()) : fileStream,
        crlfDelay: Infinity,
    });

    let lineNum = 0;
    for await (const line of rl) {
        lineNum++;
        if (lineNum % 4 === 2) {
            const seq = line.trim().toUpperCase();
            if (!seq) continue;

            if (library) {
                const searchLimit = Math.min(seq.length - 20, 50);
                for (let i = 0; i <= searchLimit; i++) {
                    const candidate = seq.substring(i, i + 20);
                    if (library.sgRNAMap.has(candidate)) {
                        counts[candidate] = (counts[candidate] || 0) + 1;
                        break;
                    }
                }
            } else {
                if (seq.length >= 20) {
                    const candidate = seq.substring(0, 20);
                    counts[candidate] = (counts[candidate] || 0) + 1;
                }
            }
        }
    }

    const finalMatrix: Record<string, Record<string, number>> = {};
    for (const [seq, count] of Object.entries(counts)) {
        if (count > 0) {
            finalMatrix[seq] = { [sampleId]: count };
        }
    }

    const warning = library ? undefined : "Library metadata was not found. Using raw extracted sequences (first 20bp). Gene annotation will be missing.";
    return { countMatrix: finalMatrix, samples: [sampleId], warning };
}

// ============================================================================
// 3. Count Table Ingestion
// ============================================================================

async function ingestCountTable(filePath: string): Promise<{ countMatrix: Record<string, Record<string, number>>; samples: string[]; warnings: string[] }> {
    const warnings: string[] = [];
    const fileContent = fs.readFileSync(filePath, 'utf-8');

    const firstLine = fileContent.split('\n')[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    const lines = fileContent.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
        throw new Error("Count table is empty or has no data.");
    }

    const output: Record<string, Record<string, number>> = {};
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/"/g, ''));

    const idColIndex = headers.findIndex(h => /^(sgRNA|guide|gRNA|id|name)$/i.test(h));
    const nonSampleCols = new Set([idColIndex]);
    const geneColIndex = headers.findIndex(h => /^(gene|symbol|target)$/i.test(h));
    if (geneColIndex !== -1) nonSampleCols.add(geneColIndex);

    const sampleIndices = headers.map((_, i) => i).filter(i => !nonSampleCols.has(i));
    const samples = sampleIndices.map(i => headers[i]);

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(delimiter);
        if (row.length < headers.length) continue;

        let id = idColIndex !== -1 ? row[idColIndex].trim() : row[0].trim();
        if (!output[id]) output[id] = {};

        sampleIndices.forEach((colIdx, sampleArrIdx) => {
            const sampleName = samples[sampleArrIdx];
            const val = parseFloat(row[colIdx]);
            if (!isNaN(val)) {
                output[id][sampleName] = val;
            }
        });
    }

    return { countMatrix: output, samples, warnings };
}

// ============================================================================
// 4. Metadata & Design Inference
// ============================================================================

function inferDesign(
    samples: string[],
    filename: string,
    dataType: DataType,
    countMatrix: Record<string, Record<string, number>>
): { sampleMetadata: SampleMetadata[], design: DesignType } {
    const metadata: SampleMetadata[] = [];

    samples.forEach((sample) => {
        let label: 'control' | 'treatment' | 'other' = 'other';
        const sLower = sample.toLowerCase();

        // 1. Biological signal (Gini Index)
        const sampleCounts = Object.values(countMatrix)
            .map(s => s[sample] || 0)
            .filter(c => c > 0);

        const gini = sampleCounts.length > 100 ? calculateGiniIndex(sampleCounts) : 0.5;
        const isHighlyUniform = gini < 0.28;
        const isHighlySkewed = gini > 0.45;

        // 2. Enhanced Keyword Heuristics
        const controlKeywords = [
            "control", "ctrl", "vehicle", "veh", "dmso", "untreated",
            "day0", "d0", "t0", "baseline", "input", "pdna", "plasmid", "reference"
        ];
        const treatmentKeywords = [
            "drug", "treat", "tx", "trt", "compound", "perturb", "plx",
            "vemurafenib", "braf", "sgk", "dose", "final", "end", "d8", "d7", "t8", "t7"
        ];

        // 3. Inference Logic with Priority
        if (sLower.includes('t0') || sLower.includes('day0') || sLower.includes('d0')) {
            label = 'control';
        } else if (/(t|d)[1-9][0-9]*/.test(sLower)) {
            label = 'treatment';
        } else if (controlKeywords.some(k => sLower.includes(k))) {
            label = 'control';
        } else if (treatmentKeywords.some(k => sLower.includes(k))) {
            label = 'treatment';
        } else if (isHighlyUniform) {
            label = 'control';
        } else if (isHighlySkewed) {
            label = 'treatment';
        }

        metadata.push({
            sampleId: sample,
            conditionLabel: label,
            replicateId: 1,
            originalName: sample
        });
    });

    // Fix replicate IDs
    const labelCounts: Record<string, number> = {};
    metadata.forEach(m => {
        const key = m.conditionLabel;
        if (!labelCounts[key]) labelCounts[key] = 0;
        labelCounts[key]++;
        m.replicateId = labelCounts[key];
    });

    // Inferred Design
    let design: DesignType = 'multi_condition';
    const conditions = new Set(metadata.map(m => m.conditionLabel));

    if (conditions.size === 2 && conditions.has('control') && conditions.has('treatment')) {
        design = 'simple_control_treatment';
    } else if (conditions.size > 2 || samples.some(s => /day|time|hr/i.test(s))) {
        design = 'timecourse';
    }

    return { sampleMetadata: metadata, design };
}
