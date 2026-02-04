/**
 * CRISPR Library Loader
 *
 * Loads CRISPR library files from disk on-demand and provides
 * fast in-memory sequence matching for analysis.
 *
 * Supports: TSV, CSV, XLSX formats
 * Libraries: Brunello, BRIE, GeCKO v2, TKO v3, Calabrese, Dolcetto, Dolomiti
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

// ============================================================================
// Types
// ============================================================================

export interface Library {
  id: string;
  name: string;
  organism: 'Human' | 'Mouse';
  library_type: 'knockout' | 'activation' | 'inhibition';
  description: string;
  total_sgrnas: number;
  genes_targeted: number;
  sgrnas_per_gene: number;
  addgene_id: string;
  addgene_url: string;
  files: string[];
  file_format: 'tsv' | 'csv' | 'xlsx';
  columns: Record<string, number | string>;
}

export interface LibrariesMetadata {
  libraries: Library[];
}

export interface SgRNAInfo {
  sequence: string;
  gene_symbol: string;
  gene_id?: string;
  chromosome?: string;
  position?: number;
  strand?: string;
  library_id: string;
}

export interface LibraryData {
  metadata: Library;
  sgRNAMap: Map<string, SgRNAInfo>;
  totalLoaded: number;
}

export interface MatchResult {
  sequence: string;
  count: number;
  gene_symbol: string;
  gene_id?: string;
  library_id: string;
}

export interface AnalysisStats {
  totalReads: number;
  matchedReads: number;
  unmatchedReads: number;
  matchRate: number;
  uniqueSgRNAs: number;
  genesDetected: number;
  libraryCoverage: number;
}

export interface GeneAggregation {
  gene: string;
  gene_id?: string;
  totalReads: number;
  sgRNACount: number;
  avgReadsPerSgRNA: number;
  rpm: number;
  sgRNAs: MatchResult[];
}

// ============================================================================
// Cache
// ============================================================================

const libraryCache = new Map<string, LibraryData>();
let metadataCache: LibrariesMetadata | null = null;

// ============================================================================
// Path Helpers
// ============================================================================

const METADATA_FILE = 'libraries.json';

function getLibrariesRoot(): string {
  const cwd = process.cwd();
  const candidates = [
    path.join(cwd, 'data', 'libraries'),
    path.join(cwd, '..', 'data', 'libraries'),
    path.join(cwd, '..', '..', 'data', 'libraries'),
  ].map(p => path.normalize(p));
  for (const dir of candidates) {
    const metadataPath = path.join(dir, METADATA_FILE);
    if (fs.existsSync(metadataPath)) {
      return dir;
    }
  }
  throw new Error(
    `Library metadata not found. Tried: ${candidates.join(', ')}. Set cwd or run from project root.`
  );
}

function getLibraryFilePath(filename: string): string {
  return path.join(getLibrariesRoot(), 'raw', filename);
}

function getMetadataPath(): string {
  return path.join(getLibrariesRoot(), 'libraries.json');
}

// ============================================================================
// Metadata Loading
// ============================================================================

/**
 * Load library metadata (instant - just read JSON)
 */
export function getLibraryMetadata(): Library[] {
  if (metadataCache) {
    return metadataCache.libraries;
  }

  const metadataPath = getMetadataPath();

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Library metadata not found at: ${metadataPath}`);
  }

  const content = fs.readFileSync(metadataPath, 'utf-8');
  metadataCache = JSON.parse(content) as LibrariesMetadata;

  return metadataCache.libraries;
}

/**
 * Get metadata for a specific library
 */
export function getLibraryById(libraryId: string): Library | null {
  const libraries = getLibraryMetadata();
  return libraries.find(lib => lib.id === libraryId) || null;
}

// ============================================================================
// File Parsers
// ============================================================================

/**
 * Parse TSV file
 */
function parseTSV(filePath: string, columns: Record<string, number>, libraryId: string): SgRNAInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Handle CR, LF, and CRLF line terminators
  const lines = content.split(/\r\n|\r|\n/).filter(line => line.trim());

  const sgRNAs: SgRNAInfo[] = [];

  // Skip header (line 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = line.split('\t');

    const sequence = fields[columns.sequence as number]?.trim();
    const gene_symbol = fields[columns.gene_symbol as number]?.trim();
    const gene_id = columns.gene_id !== undefined ? fields[columns.gene_id as number]?.trim() : undefined;

    if (sequence && gene_symbol && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      sgRNAs.push({
        sequence: sequence.toUpperCase(),
        gene_symbol,
        gene_id,
        library_id: libraryId,
      });
    }
  }

  return sgRNAs;
}

/**
 * Parse CSV file (for GeCKO v2)
 */
function parseCSV(filePath: string, columns: Record<string, number | string>, libraryId: string, isLibraryB: boolean = false): SgRNAInfo[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  // Handle CR, LF, and CRLF line terminators
  const lines = content.split(/\r\n|\r|\n/).filter(line => line.trim());

  const sgRNAs: SgRNAInfo[] = [];

  // Skip header (line 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let fields: string[];

    // Handle CSV with quotes
    if (line.includes('"')) {
      fields = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g)?.map(f => f.replace(/"/g, '').trim()) || [];
    } else {
      // Simple comma split (for library B)
      fields = line.split(',').map(f => f.trim());
    }

    let sequence: string | undefined;
    let gene_symbol: string | undefined;

    if (isLibraryB) {
      // Library B: gene_id,UID,seq
      sequence = fields[columns.sequence_b as number];
      gene_symbol = fields[columns.gene_symbol_b as number];
    } else {
      // Library A: "Target Sequence","Public ID","Plasmid Name","Legacy Name","Flags"
      sequence = fields[columns.sequence_a as number];
      // Library A doesn't have gene info, skip it
    }

    if (sequence && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      sgRNAs.push({
        sequence: sequence.toUpperCase(),
        gene_symbol: gene_symbol || 'UNKNOWN',
        library_id: libraryId,
      });
    }
  }

  return sgRNAs;
}

/**
 * Parse XLSX file (for TKO v3)
 */
function parseXLSX(filePath: string, columns: Record<string, string>, libraryId: string): SgRNAInfo[] {
  const workbook = XLSX.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];

  // Convert to JSON with header row
  const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

  if (data.length === 0) {
    throw new Error('XLSX file is empty');
  }

  const header = data[0];
  const sequenceCol = header.indexOf(columns.sequence as string);
  const geneSymbolCol = header.indexOf(columns.gene_symbol as string);
  const geneIdCol = header.indexOf(columns.gene_id as string);

  if (sequenceCol === -1 || geneSymbolCol === -1) {
    throw new Error('Required columns not found in XLSX');
  }

  const sgRNAs: SgRNAInfo[] = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const sequence = row[sequenceCol]?.toString().trim();
    const gene_symbol = row[geneSymbolCol]?.toString().trim();
    const gene_id = geneIdCol !== -1 ? row[geneIdCol]?.toString().trim() : undefined;

    if (sequence && gene_symbol && sequence.length === 20 && /^[ATCG]+$/i.test(sequence)) {
      sgRNAs.push({
        sequence: sequence.toUpperCase(),
        gene_symbol,
        gene_id,
        library_id: libraryId,
      });
    }
  }

  return sgRNAs;
}

// ============================================================================
// Library Loading
// ============================================================================

/**
 * Load and parse a specific library file (on-demand, cached)
 */
export async function loadLibrary(libraryId: string): Promise<LibraryData> {
  // Check cache first
  if (libraryCache.has(libraryId)) {
    console.log(`[LibraryLoader] Using cached library: ${libraryId}`);
    return libraryCache.get(libraryId)!;
  }

  console.log(`[LibraryLoader] Loading library: ${libraryId}`);

  const metadata = getLibraryById(libraryId);
  if (!metadata) {
    throw new Error(`Library not found: ${libraryId}`);
  }

  const sgRNAMap = new Map<string, SgRNAInfo>();
  let totalLoaded = 0;

  // Load all files for this library
  for (const filename of metadata.files) {
    const filePath = getLibraryFilePath(filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Library file not found: ${filePath}`);
    }

    console.log(`[LibraryLoader] Parsing file: ${filename}`);

    let sgRNAs: SgRNAInfo[] = [];

    try {
      if (metadata.file_format === 'tsv') {
        sgRNAs = parseTSV(filePath, metadata.columns as Record<string, number>, libraryId);
      } else if (metadata.file_format === 'csv') {
        const isLibraryB = filename.includes('-b.csv');
        sgRNAs = parseCSV(filePath, metadata.columns, libraryId, isLibraryB);
      } else if (metadata.file_format === 'xlsx') {
        sgRNAs = parseXLSX(filePath, metadata.columns as Record<string, string>, libraryId);
      }

      // Add to map (later entries overwrite if duplicate sequences exist)
      for (const sgRNA of sgRNAs) {
        sgRNAMap.set(sgRNA.sequence, sgRNA);
      }

      totalLoaded += sgRNAs.length;
      console.log(`[LibraryLoader] Loaded ${sgRNAs.length.toLocaleString()} sgRNAs from ${filename}`);
    } catch (error) {
      console.error(`[LibraryLoader] Error parsing ${filename}:`, error);
      throw new Error(`Failed to parse ${filename}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  const libraryData: LibraryData = {
    metadata,
    sgRNAMap,
    totalLoaded,
  };

  // Cache for future use
  libraryCache.set(libraryId, libraryData);

  console.log(`[LibraryLoader] Successfully loaded ${totalLoaded.toLocaleString()} sgRNAs for ${metadata.name}`);

  return libraryData;
}

// ============================================================================
// Sequence Matching
// ============================================================================

/**
 * Match sequences against loaded library (very fast with Map)
 */
export function matchSequences(
  sequenceCounts: Map<string, number>,
  library: LibraryData
): {
  matches: MatchResult[];
  unmatched: Array<{ sequence: string; count: number }>;
  stats: AnalysisStats;
} {
  const matches: MatchResult[] = [];
  const unmatched: Array<{ sequence: string; count: number }> = [];

  let totalReads = 0;
  let matchedReads = 0;
  let unmatchedReads = 0;

  // Match each sequence
  for (const [sequence, count] of sequenceCounts) {
    totalReads += count;

    const sgRNAInfo = library.sgRNAMap.get(sequence.toUpperCase());

    if (sgRNAInfo) {
      matchedReads += count;
      matches.push({
        sequence,
        count,
        gene_symbol: sgRNAInfo.gene_symbol,
        gene_id: sgRNAInfo.gene_id,
        library_id: library.metadata.id,
      });
    } else {
      unmatchedReads += count;
      unmatched.push({ sequence, count });
    }
  }

  // Calculate stats
  const matchRate = totalReads > 0 ? matchedReads / totalReads : 0;
  const uniqueSgRNAs = matches.length;
  const genesDetected = new Set(matches.map(m => m.gene_symbol)).size;
  const libraryCoverage = library.totalLoaded > 0 ? uniqueSgRNAs / library.totalLoaded : 0;

  const stats: AnalysisStats = {
    totalReads,
    matchedReads,
    unmatchedReads,
    matchRate,
    uniqueSgRNAs,
    genesDetected,
    libraryCoverage,
  };

  return { matches, unmatched, stats };
}

/**
 * Aggregate matches by gene
 */
export function aggregateByGene(matches: MatchResult[], totalReads: number): GeneAggregation[] {
  const geneMap = new Map<string, GeneAggregation>();

  for (const match of matches) {
    if (!geneMap.has(match.gene_symbol)) {
      geneMap.set(match.gene_symbol, {
        gene: match.gene_symbol,
        gene_id: match.gene_id,
        totalReads: 0,
        sgRNACount: 0,
        avgReadsPerSgRNA: 0,
        rpm: 0,
        sgRNAs: [],
      });
    }

    const geneData = geneMap.get(match.gene_symbol)!;
    geneData.totalReads += match.count;
    geneData.sgRNACount++;
    geneData.sgRNAs.push(match);
  }

  // Calculate averages and RPM
  const aggregated = Array.from(geneMap.values());

  for (const gene of aggregated) {
    gene.avgReadsPerSgRNA = gene.totalReads / gene.sgRNACount;
    gene.rpm = totalReads > 0 ? (gene.totalReads / totalReads) * 1000000 : 0;
  }

  // Sort by total reads (descending)
  return aggregated.sort((a, b) => b.totalReads - a.totalReads);
}

// ============================================================================
// Quality Control
// ============================================================================

export interface QCMetrics {
  matchRate: number;
  matchRateQuality: 'excellent' | 'good' | 'fair' | 'poor';
  libraryCoverage: number;
  libraryQuality: 'excellent' | 'good' | 'fair' | 'poor';
  zeroCountSgRNAs: number;
  zeroCountPercentage: number;
  zeroCountQuality: 'excellent' | 'good' | 'fair' | 'poor';
  giniCoefficient: number;
  giniQuality: 'excellent' | 'good' | 'fair' | 'poor';
  overallQuality: 'excellent' | 'good' | 'fair' | 'poor';
  recommendation: string;
}

/**
 * Calculate Gini coefficient (measure of uniformity, 0 = perfect uniformity, 1 = maximum inequality)
 */
function calculateGiniCoefficient(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  let sum = 0;

  for (let i = 0; i < n; i++) {
    sum += (2 * (i + 1) - n - 1) * sorted[i];
  }

  const mean = sorted.reduce((a, b) => a + b, 0) / n;
  return sum / (n * n * mean);
}

/**
 * Calculate QC metrics
 */
export function calculateQCMetrics(
  matches: MatchResult[],
  stats: AnalysisStats,
  library: LibraryData
): QCMetrics {
  // Match rate quality
  let matchRateQuality: QCMetrics['matchRateQuality'] = 'poor';
  if (stats.matchRate >= 0.8) matchRateQuality = 'excellent';
  else if (stats.matchRate >= 0.7) matchRateQuality = 'good';
  else if (stats.matchRate >= 0.5) matchRateQuality = 'fair';

  // Library coverage quality
  let libraryQuality: QCMetrics['libraryQuality'] = 'poor';
  if (stats.libraryCoverage >= 0.5) libraryQuality = 'excellent';
  else if (stats.libraryCoverage >= 0.4) libraryQuality = 'good';
  else if (stats.libraryCoverage >= 0.2) libraryQuality = 'fair';

  // Zero-count sgRNAs
  const zeroCountSgRNAs = library.totalLoaded - stats.uniqueSgRNAs;
  const zeroCountPercentage = zeroCountSgRNAs / library.totalLoaded;

  let zeroCountQuality: QCMetrics['zeroCountQuality'] = 'poor';
  if (zeroCountPercentage <= 0.4) zeroCountQuality = 'excellent';
  else if (zeroCountPercentage <= 0.6) zeroCountQuality = 'good';
  else if (zeroCountPercentage <= 0.8) zeroCountQuality = 'fair';

  // Gini coefficient
  const readCounts = matches.map(m => m.count);
  const giniCoefficient = calculateGiniCoefficient(readCounts);

  let giniQuality: QCMetrics['giniQuality'] = 'poor';
  if (giniCoefficient <= 0.3) giniQuality = 'excellent';
  else if (giniCoefficient <= 0.5) giniQuality = 'good';
  else if (giniCoefficient <= 0.7) giniQuality = 'fair';

  // Overall quality (worst of all metrics)
  const qualities = [matchRateQuality, libraryQuality, zeroCountQuality, giniQuality];
  const qualityScores = qualities.map(q =>
    q === 'excellent' ? 4 : q === 'good' ? 3 : q === 'fair' ? 2 : 1
  );
  const avgScore = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;

  let overallQuality: QCMetrics['overallQuality'] = 'poor';
  if (avgScore >= 3.5) overallQuality = 'excellent';
  else if (avgScore >= 2.5) overallQuality = 'good';
  else if (avgScore >= 1.5) overallQuality = 'fair';

  // Recommendation
  let recommendation = '';
  if (overallQuality === 'excellent' || overallQuality === 'good') {
    recommendation = 'Good quality data. Proceed with analysis.';
  } else if (overallQuality === 'fair') {
    recommendation = 'Fair quality data. Review QC metrics and consider re-sequencing if needed.';
  } else {
    if (stats.matchRate < 0.5) {
      recommendation = 'Low match rate. Verify you selected the correct library.';
    } else if (stats.libraryCoverage < 0.2) {
      recommendation = 'Low library coverage. Consider deeper sequencing.';
    } else {
      recommendation = 'Poor quality data. Review experimental protocol and consider re-sequencing.';
    }
  }

  return {
    matchRate: stats.matchRate,
    matchRateQuality,
    libraryCoverage: stats.libraryCoverage,
    libraryQuality,
    zeroCountSgRNAs,
    zeroCountPercentage,
    zeroCountQuality,
    giniCoefficient,
    giniQuality,
    overallQuality,
    recommendation,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clear library cache (useful for testing)
 */
export function clearCache(): void {
  libraryCache.clear();
  metadataCache = null;
}

/**
 * Get cache stats
 */
export function getCacheStats(): { loaded: string[]; size: number } {
  return {
    loaded: Array.from(libraryCache.keys()),
    size: libraryCache.size,
  };
}
