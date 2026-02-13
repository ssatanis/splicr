
import { loadLibrary, LibraryData, SgRNAInfo } from './libraryLoader';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import * as zlib from 'zlib';

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

    // 2. Load Library (needed for all paths to validate or map)
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
        if (!library) {
            console.warn(`[SmartIngest] Warning: Library ${libraryId} not found. Proceeding with raw sequence extraction.`);
        }
        const result = await ingestFastq(filePath, originalFilename, dataType, library);
        countMatrix = result.countMatrix;
        samples = result.samples;
        if (result.warning) warnings.push(result.warning);
    } else {
        // Count Table
        const result = await ingestCountTable(filePath);
        countMatrix = result.countMatrix;
        samples = result.samples;
        warnings.push(...result.warnings);
    }

    // 4. Infer Design & Metadata
    const { sampleMetadata, design } = inferDesign(samples, originalFilename, dataType);

    // 5. Post-processing & Validation
    // Ensure every condition has at least one replicate
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

    // For single file upload, we usually treat it as ONE sample, unless specific logic exists.
    // We'll use the filename as the sample ID.
    const sampleId = originalFilename.replace(/\.(fastq|fq)(\.gz)?$/i, '');
    const counts: Record<string, number> = {};

    if (library) {
        // Initialize counts for all library guides to 0
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
    // Simple 4-line FASTQ parser
    // Line 1: @Header
    // Line 2: Sequence
    // Line 3: +
    // Line 4: Quality

    for await (const line of rl) {
        lineNum++;
        if (lineNum % 4 === 2) {
            const seq = line.trim().toUpperCase();

            if (library) {
                // Heuristic: Extract 20bp. 
                // Let's check a sliding window of 20bp for the first 50bp.
                const searchLimit = Math.min(seq.length - 20, 50);
                for (let i = 0; i <= searchLimit; i++) {
                    const candidate = seq.substring(i, i + 20);
                    if (library.sgRNAMap.has(candidate)) {
                        counts[candidate] = (counts[candidate] || 0) + 1;
                        break; // Count once per read
                    }
                }
            } else {
                // Fallback: Just take the first 20bp if it looks valid
                // Or maybe the 20bp after a common scaffold? 
                // Without library, we have to guess.
                // Simplest guess: First 20bp. 
                // Better guess: Scan for 20bp that appears "sgRNA-like"? No, that's impossible.
                // Let's just take the first 20bp for now as a naive fallback or maybe the whole read if it's short?
                // Most sgRNA reads are ~20bp + adapters.
                // Let's try to extract a 20bp sequence from the start.
                if (seq.length >= 20) {
                    const candidate = seq.substring(0, 20);
                    // Simple filter: GC content? No.
                    // Just count it.
                    counts[candidate] = (counts[candidate] || 0) + 1;
                }
            }
        }
    }

    // Format matrix
    const matrix: Record<string, Record<string, number>> = {};
    for (const [seq, count] of Object.entries(counts)) {
        if (count > 0) { // Only include if present? Or all? Usually sparse is better but for small preview all is fine.
            if (!matrix[seq]) matrix[seq] = {};
            matrix[seq][sampleId] = count;
        }
    }

    // Re-filtering:
    const finalMatrix: Record<string, Record<string, number>> = {};
    for (const seq of Object.entries(counts)) {
        if (seq[1] > 0) {
            finalMatrix[seq[0]] = { [sampleId]: seq[1] };
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

    // Detect delimiter
    const firstLine = fileContent.split('\n')[0];
    const delimiter = firstLine.includes('\t') ? '\t' : ',';

    const lines = fileContent.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
        throw new Error("Count table is empty or has no data.");
    }

    const output: Record<string, Record<string, number>> = {}; // sgRNA -> Sample -> Count

    // Header parsing
    const headers = lines[0].split(delimiter).map(h => h.trim().replace(/"/g, ''));

    // Detect ID column
    const idColIndex = headers.findIndex(h => /^(sgRNA|guide|gRNA|id|name)$/i.test(h));
    // Detect Gene column (optional, for metadata, usually ignored for count matrix which uses ID)
    // We need to identify WHICH columns are samples.
    // Strategy: All columns that are NOT ID and NOT Gene and contain numeric data in body.

    const nonSampleCols = new Set([idColIndex]);
    const geneColIndex = headers.findIndex(h => /^(gene|symbol|target)$/i.test(h));
    if (geneColIndex !== -1) nonSampleCols.add(geneColIndex);

    const sampleIndices = headers.map((_, i) => i).filter(i => !nonSampleCols.has(i));
    const samples = sampleIndices.map(i => headers[i]);

    // A375 Special Detector
    // "If any sample column contains both: Cell line keyword: a375 And either dmso or plx / vemurafenib"
    // This logic is mostly for *Labeling* later, but we need to ensure we parsed the columns correctly first.

    for (let i = 1; i < lines.length; i++) {
        const row = lines[i].split(delimiter);
        if (row.length < headers.length) continue; // Skip malformed

        // Get ID
        let id = idColIndex !== -1 ? row[idColIndex].trim() : String(i); // Fallback to line number? Bad.
        if (idColIndex === -1) {
            // Try first column if likely ID
            id = row[0].trim();
        }

        if (!output[id]) output[id] = {};

        sampleIndices.forEach((colIdx, sampleArrIdx) => {
            const sampleName = samples[sampleArrIdx];
            const val = parseFloat(row[colIdx]);
            if (!isNaN(val)) {
                output[id][sampleName] = val;
            } else {
                // Warn once?
            }
        });
    }

    return { countMatrix: output, samples, warnings };
}

// ============================================================================
// 4. Metadata & Design Inference
// ============================================================================

function inferDesign(samples: string[], filename: string, dataType: DataType): { sampleMetadata: SampleMetadata[], design: DesignType } {
    const metadata: SampleMetadata[] = [];

    // 4.2 Recognize A375 A375‑style tables automatically
    const isA375 = samples.some(s => /a375/i.test(s)) && samples.some(s => /(dmso|plx|vemurafenib)/i.test(s));

    samples.forEach((sample, index) => {
        let label: 'control' | 'treatment' | 'other' = 'other';
        const sLower = sample.toLowerCase();

        if (isA375) {
            // Force: Columns containing dmso → control
            // Columns containing plx or vemurafenib → treatment.
            if (sLower.includes('dmso')) label = 'control';
            else if (sLower.includes('plx') || sLower.includes('vemurafenib')) label = 'treatment';
        } else {
            // Standard heuristics
            const controlKeywords = ["control", "ctrl", "vehicle", "veh", "dmso", "untreated", "day0", "t0", "baseline"];
            const treatmentKeywords = ["drug", "treat", "tx", "compound", "perturb", "plx", "vemurafenib", "braf", "sgk", "dose"];

            if (controlKeywords.some(k => sLower.includes(k))) label = 'control';
            else if (treatmentKeywords.some(k => sLower.includes(k))) label = 'treatment';

            // If neither, fallback logic:
            // If we detect "Day0" or "DMSO" among ANY samples, and this one didn't match, 
            // and we haven't assigned simple binary yet?
            // Actually the prompt says: "If header includes... -> control. Else if header includes... -> treatment."
        }

        // Replicate grouping
        // Group columns with the same base name (before _rep, _R1, etc.)
        // Regex to strip common suffixes
        const baseName = sample.replace(/(_rep|_r|_replicate)?\d+$/i, '').replace(/[._-](r|rep)?\d+$/i, '');
        // This is dynamic. Simpler: Assign replicateId based on order of appearance of this label? 
        // Or try to parse integer?
        // "assign replicateId accordingly" - usually just auto-increment for unique condition

        metadata.push({
            sampleId: sample,
            conditionLabel: label,
            replicateId: 1, // Placeholder, need separate pass or map to count
            originalName: sample
        });
    });

    // Fix replicate IDs
    const labelCounts: Record<string, number> = {};
    metadata.forEach(m => {
        const key = m.conditionLabel; // Should be per-condition? Or per-biological-sample?
        // Usually Replicates are Rep 1, Rep 2 of "Condition X".
        // If we have "Control_Rep1", "Control_Rep2", labels are "control", "control".
        // We want replicateId 1, 2.
        if (!labelCounts[key]) labelCounts[key] = 0;
        labelCounts[key]++;
        m.replicateId = labelCounts[key];
    });

    // Inferred Design
    let design: DesignType = 'multi_condition';
    const conditions = new Set(metadata.map(m => m.conditionLabel));

    // "If there are exactly 2 groups and each has ≥1 column labeled "control" or "treatment" → inferredDesign = "simple_control_treatment"."
    if (conditions.size === 2 && conditions.has('control') && conditions.has('treatment')) {
        design = 'simple_control_treatment';
    } else if (conditions.size > 2 && samples.some(s => /day|time|hr/i.test(s))) {
        // Very loose timecourse detection
        design = 'timecourse';
    } else {
        design = 'multi_condition';
    }

    return { sampleMetadata: metadata, design };
}
