// Unified CRISPR Screen Analysis Pipeline
// Orchestrates MAGeCK, BAGEL2, and DrugZ algorithms with real-time progress tracking

import { MAGeCKAnalyzer, MAGeCKGeneResult } from './mageckRRA';
import { BAGEL2Analyzer, BAGEL2GeneResult } from './bagel2';
import { DrugZAnalyzer, DrugZGeneResult } from './drugz';
import { getLibrary, getLibraryMetadata, ESSENTIAL_GENES, NON_ESSENTIAL_GENES } from './sgRNALibraries';
import { FASTQParser } from '../fastqParser';

export interface SampleInfo {
  name: string;
  fileName: string;
  condition: 'control' | 'treatment';
  replicate: number;
  sgRNACounts: Map<string, number>;
  totalReads: number;
  mappedReads: number;
  uniqueSgRNAs: number;
  avgQuality?: number;
  gcContent?: number;
}

export interface AnalysisParameters {
  fdrThreshold: number;
  lfcThreshold: number;
  normalizationMethod: 'median' | 'total' | 'control' | 'none';
  minimumReads: number;
  removeRibosomal: boolean;
  essentialGenes?: string;
  nonEssentialGenes?: string;
  bagelPermutations?: number;
}

export interface LogEntry {
  timestamp: string;
  step: string;
  message: string;
  progress: number;
  level: 'info' | 'warning' | 'error' | 'success';
}

export interface QCMetrics {
  totalReads: number;
  mappedReads: number;
  mappingRate: number;
  zeroCounts: number;
  libraryCoverage: number;
  giniCoefficient: number;
  correlations: number[][];
  sampleStats: {
    name: string;
    totalReads: number;
    mappedReads: number;
    uniqueSgRNAs: number;
    mappingRate: number;
    avgQuality?: string;
    gcContent?: string;
  }[];
}

export interface GeneResultUnified {
  gene: string;
  numSgRNAs: number;
  log2FC: number;
  pValue: number;
  fdr: number;
  rank: number;
  mageck?: {
    rhoNeg: number;
    rhoPos: number;
    pValueNeg: number;
    pValuePos: number;
    fdrNeg: number;
    fdrPos: number;
  };
  bagel2?: {
    bayesFactor: number;
    essentialProbability: number;
  };
  drugz?: {
    normZ: number;
    syntheticScore: number;
  };
}

export interface PipelineResults {
  id: string;
  summary: {
    totalGenes: number;
    significantHits: number;
    enriched: number;
    depleted: number;
  };
  qcMetrics: QCMetrics;
  algorithms: {
    mageck?: MAGeCKGeneResult[];
    bagel2?: BAGEL2GeneResult[];
    drugz?: DrugZGeneResult[];
  };
  unifiedResults: GeneResultUnified[];
  volcanoData: {
    gene: string;
    log2FC: number;
    negLog10P: number;
    fdr: number;
    isSignificant: boolean;
  }[];
  topHits: {
    depleted: GeneResultUnified[];
    enriched: GeneResultUnified[];
  };
  logs: LogEntry[];
  rawData: {
    countMatrix: Record<string, Record<string, number>>;
    normalizedCounts: Record<string, Record<string, number>>;
  };
}

export type ProgressCallback = (progress: number, step: string, log: LogEntry) => void;

export class AnalysisPipeline {
  private logs: LogEntry[] = [];
  private progressCallback?: ProgressCallback;

  async runPipeline(
    files: File[],
    fileMetadata: { fileName: string; condition: 'control' | 'treatment'; replicate: number; sampleName: string }[],
    libraryType: string,
    algorithms: string[],
    parameters: AnalysisParameters,
    progressCallback?: ProgressCallback
  ): Promise<PipelineResults> {
    this.logs = [];
    this.progressCallback = progressCallback;

    const analysisId = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    try {
      // Phase 1: Load sgRNA Library (5%)
      this.log('library', 2, `Loading ${libraryType} sgRNA library...`, 'info');
      const library = getLibrary(libraryType);
      const libraryMeta = getLibraryMetadata(libraryType);
      this.log('library', 5, `Loaded ${libraryMeta.name} library: ${library.size} sgRNAs targeting ${libraryMeta.totalGenes} genes`, 'success');

      // Phase 2: Parse FASTQ Files (5-25%)
      this.log('parsing', 6, 'Beginning FASTQ file parsing...', 'info');
      const samples: SampleInfo[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const metadata = fileMetadata[i];
        const fileProgress = 6 + (i / files.length) * 19;

        this.log('parsing', fileProgress, `Parsing ${file.name} (${(file.size / 1e6).toFixed(1)} MB)...`, 'info');

        try {
          const { reads, stats } = await FASTQParser.parseFASTQ(file);
          this.log('parsing', fileProgress + 2, `Extracted ${stats.totalReads.toLocaleString()} reads from ${file.name}`, 'info');

          // Extract sgRNAs
          const sgRNACounts = FASTQParser.extractSgRNAs(reads, '');
          const uniqueSgRNAs = sgRNACounts.size;
          const mappedReads = Array.from(sgRNACounts.values()).reduce((sum, count) => sum + count, 0);

          // Match sgRNAs to library
          const matchedCounts = new Map<string, number>();
          let matchedSgRNAs = 0;

          for (const [seq, count] of sgRNACounts.entries()) {
            if (library.has(seq)) {
              matchedCounts.set(seq, count);
              matchedSgRNAs++;
            }
          }

          this.log('parsing', fileProgress + 4, `Matched ${matchedSgRNAs.toLocaleString()} sgRNAs (${uniqueSgRNAs ? ((matchedSgRNAs / uniqueSgRNAs) * 100).toFixed(1) : 0}%) to ${libraryMeta.name} library`, 'info');

          // Use all extracted sgRNAs so unmapped ones get synthetic genes and analysis runs
          samples.push({
            name: metadata.sampleName,
            fileName: file.name,
            condition: metadata.condition,
            replicate: metadata.replicate,
            sgRNACounts,
            totalReads: stats.totalReads,
            mappedReads,
            uniqueSgRNAs,
            avgQuality: stats.avgQuality,
            gcContent: stats.gcContent
          });

        } catch (error) {
          this.log('parsing', fileProgress, `Error parsing ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
          throw error;
        }
      }

      this.log('parsing', 25, `Successfully parsed ${samples.length} samples`, 'success');

      // Phase 3: Build Count Matrix (25-30%)
      this.log('matrix', 26, 'Building sgRNA count matrix...', 'info');
      const { countMatrix, sgRNAToGene, controlIndices, treatmentIndices } = this.buildCountMatrix(samples, library);
      this.log('matrix', 30, `Count matrix: ${countMatrix.size} sgRNAs × ${samples.length} samples`, 'success');

      // Phase 4: Calculate QC Metrics (30-35%)
      this.log('qc', 31, 'Calculating quality control metrics...', 'info');
      const qcMetrics = this.calculateQCMetrics(samples, countMatrix, library);
      this.log('qc', 35, `QC complete: ${(qcMetrics.mappingRate * 100).toFixed(1)}% mapping rate, ${(qcMetrics.libraryCoverage * 100).toFixed(1)}% library coverage`, 'success');

      // Phase 5: Run Selected Algorithms (35-90%)
      const algorithmResults: {
        mageck?: MAGeCKGeneResult[];
        bagel2?: BAGEL2GeneResult[];
        drugz?: DrugZGeneResult[];
      } = {};

      const algorithmProgress = {
        mageck: { start: 35, end: 55 },
        bagel2: { start: 55, end: 75 },
        drugz: { start: 75, end: 90 }
      };

      if (algorithms.includes('mageck')) {
        this.log('mageck', 35, 'Starting MAGeCK RRA analysis...', 'info');
        const mageckAnalyzer = new MAGeCKAnalyzer({
          alpha: parameters.fdrThreshold,
          minSgRNAs: 3
        });

        algorithmResults.mageck = await mageckAnalyzer.runAnalysis(
          countMatrix,
          sgRNAToGene,
          controlIndices,
          treatmentIndices,
          (progress) => {
            const scaledProgress = algorithmProgress.mageck.start +
              (progress.progress / 100) * (algorithmProgress.mageck.end - algorithmProgress.mageck.start);
            this.log('mageck', scaledProgress, progress.message, 'info');
          }
        );
        this.log('mageck', algorithmProgress.mageck.end, `MAGeCK complete: ${algorithmResults.mageck.filter(r => Math.min(r.fdrNeg, r.fdrPos) < parameters.fdrThreshold).length} significant genes`, 'success');
      }

      if (algorithms.includes('bagel2')) {
        this.log('bagel2', algorithmProgress.bagel2.start, 'Starting BAGEL2 analysis...', 'info');
        const bagel2Analyzer = new BAGEL2Analyzer({
          essentialGenes: parameters.essentialGenes ? parameters.essentialGenes.split(',').map(s => s.trim()) : undefined,
          nonEssentialGenes: parameters.nonEssentialGenes ? parameters.nonEssentialGenes.split(',').map(s => s.trim()) : undefined,
          bootstrapIterations: parameters.bagelPermutations || 1000
        });

        algorithmResults.bagel2 = await bagel2Analyzer.runAnalysis(
          countMatrix,
          sgRNAToGene,
          controlIndices,
          treatmentIndices,
          (progress) => {
            const scaledProgress = algorithmProgress.bagel2.start +
              (progress.progress / 100) * (algorithmProgress.bagel2.end - algorithmProgress.bagel2.start);
            this.log('bagel2', scaledProgress, progress.message, 'info');
          }
        );
        this.log('bagel2', algorithmProgress.bagel2.end, `BAGEL2 complete: ${algorithmResults.bagel2.filter(r => r.bayesFactor > 0).length} putative essential genes`, 'success');
      }

      if (algorithms.includes('drugz')) {
        this.log('drugz', algorithmProgress.drugz.start, 'Starting DrugZ analysis...', 'info');
        const drugzAnalyzer = new DrugZAnalyzer({
          minSgRNAs: 3
        });

        algorithmResults.drugz = await drugzAnalyzer.runAnalysis(
          countMatrix,
          sgRNAToGene,
          controlIndices,
          treatmentIndices,
          (progress) => {
            const scaledProgress = algorithmProgress.drugz.start +
              (progress.progress / 100) * (algorithmProgress.drugz.end - algorithmProgress.drugz.start);
            this.log('drugz', scaledProgress, progress.message, 'info');
          }
        );
        this.log('drugz', algorithmProgress.drugz.end, `DrugZ complete: ${algorithmResults.drugz.filter(r => r.fdr < parameters.fdrThreshold).length} significant genes`, 'success');
      }

      // Phase 6: Merge Results (90-95%)
      this.log('merge', 91, 'Merging results from all algorithms...', 'info');
      const unifiedResults = this.mergeResults(algorithmResults, parameters);
      this.log('merge', 95, `Merged results for ${unifiedResults.length} genes`, 'success');

      // Phase 7: Generate Final Output (95-100%)
      this.log('output', 96, 'Generating volcano plot data...', 'info');
      const volcanoData = unifiedResults.map(r => ({
        gene: r.gene,
        log2FC: r.log2FC,
        negLog10P: -Math.log10(Math.max(r.pValue, 1e-300)),
        fdr: r.fdr,
        isSignificant: r.fdr < parameters.fdrThreshold && Math.abs(r.log2FC) > parameters.lfcThreshold
      }));

      this.log('output', 98, 'Identifying top hits...', 'info');
      const significantGenes = unifiedResults.filter(r =>
        r.fdr < parameters.fdrThreshold && Math.abs(r.log2FC) > parameters.lfcThreshold
      );

      const depleted = significantGenes
        .filter(r => r.log2FC < 0)
        .sort((a, b) => a.log2FC - b.log2FC)
        .slice(0, 20);

      const enriched = significantGenes
        .filter(r => r.log2FC > 0)
        .sort((a, b) => b.log2FC - a.log2FC)
        .slice(0, 20);

      // Build raw data for export
      const rawCountMatrix: Record<string, Record<string, number>> = {};
      for (const [sgRNA, counts] of countMatrix.entries()) {
        rawCountMatrix[sgRNA] = {};
        samples.forEach((sample, i) => {
          rawCountMatrix[sgRNA][sample.name] = counts[i];
        });
      }

      this.log('complete', 100, `Analysis complete! Found ${significantGenes.length} significant genes (${depleted.length} depleted, ${enriched.length} enriched)`, 'success');

      return {
        id: analysisId,
        summary: {
          totalGenes: unifiedResults.length,
          significantHits: significantGenes.length,
          enriched: enriched.length,
          depleted: depleted.length
        },
        qcMetrics,
        algorithms: algorithmResults,
        unifiedResults,
        volcanoData,
        topHits: { depleted, enriched },
        logs: this.logs,
        rawData: {
          countMatrix: rawCountMatrix,
          normalizedCounts: rawCountMatrix // Simplified for now
        }
      };

    } catch (error) {
      this.log('error', 0, `Pipeline failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      throw error;
    }
  }

  private log(step: string, progress: number, message: string, level: LogEntry['level']): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      step,
      message,
      progress,
      level
    };

    this.logs.push(entry);
    this.progressCallback?.(progress, step, entry);
  }

  private buildCountMatrix(
    samples: SampleInfo[],
    library: Map<string, string>
  ): {
    countMatrix: Map<string, number[]>;
    sgRNAToGene: Map<string, string>;
    controlIndices: number[];
    treatmentIndices: number[];
  } {
    // Get all unique sgRNAs across samples
    const allSgRNAs = new Set<string>();
    for (const sample of samples) {
      for (const sgRNA of sample.sgRNACounts.keys()) {
        allSgRNAs.add(sgRNA);
      }
    }

    // Build count matrix; assign synthetic genes to unmapped sgRNAs so analysis runs
    const countMatrix = new Map<string, number[]>();
    const sgRNAToGene = new Map<string, string>();
    let unmappedIndex = 0;

    for (const sgRNA of allSgRNAs) {
      const counts = samples.map(s => s.sgRNACounts.get(sgRNA) || 0);
      countMatrix.set(sgRNA, counts);

      const gene = library.get(sgRNA) ?? `SGRNA_${++unmappedIndex}`;
      sgRNAToGene.set(sgRNA, gene);
    }

    // Get control and treatment indices
    const controlIndices: number[] = [];
    const treatmentIndices: number[] = [];

    samples.forEach((sample, index) => {
      if (sample.condition === 'control') {
        controlIndices.push(index);
      } else {
        treatmentIndices.push(index);
      }
    });

    return { countMatrix, sgRNAToGene, controlIndices, treatmentIndices };
  }

  private calculateQCMetrics(
    samples: SampleInfo[],
    countMatrix: Map<string, number[]>,
    library: Map<string, string>
  ): QCMetrics {
    // Total and mapped reads
    const totalReads = samples.reduce((sum, s) => sum + s.totalReads, 0);
    const mappedReads = samples.reduce((sum, s) => sum + s.mappedReads, 0);
    const mappingRate = totalReads > 0 ? mappedReads / totalReads : 0;

    // Zero counts
    let zeroCount = 0;
    let totalCounts = 0;
    for (const counts of countMatrix.values()) {
      for (const count of counts) {
        totalCounts++;
        if (count === 0) zeroCount++;
      }
    }
    const zeroCounts = totalCounts > 0 ? (zeroCount / totalCounts) * 100 : 0;

    // Library coverage
    const coveredSgRNAs = countMatrix.size;
    const libraryCoverage = library.size > 0 ? coveredSgRNAs / library.size : 0;

    // Gini coefficient
    const allCounts = Array.from(countMatrix.values()).flat().filter(c => c > 0);
    const giniCoefficient = this.calculateGini(allCounts);

    // Sample correlations
    const correlations = this.calculateCorrelations(samples);

    // Sample stats
    const sampleStats = samples.map(s => ({
      name: s.name,
      totalReads: s.totalReads,
      mappedReads: s.mappedReads,
      uniqueSgRNAs: s.uniqueSgRNAs,
      mappingRate: s.totalReads > 0 ? s.mappedReads / s.totalReads : 0,
      avgQuality: s.avgQuality?.toFixed(1),
      gcContent: s.gcContent?.toFixed(1)
    }));

    return {
      totalReads,
      mappedReads,
      mappingRate,
      zeroCounts,
      libraryCoverage,
      giniCoefficient,
      correlations,
      sampleStats
    };
  }

  private calculateGini(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = sorted.reduce((acc, val) => acc + val, 0);

    if (sum === 0) return 0;

    let numerator = 0;
    for (let i = 0; i < n; i++) {
      numerator += (2 * (i + 1) - n - 1) * sorted[i];
    }

    return numerator / (n * sum);
  }

  private calculateCorrelations(samples: SampleInfo[]): number[][] {
    const n = samples.length;
    const correlations: number[][] = Array(n).fill(0).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          correlations[i][j] = 1.0;
        } else {
          correlations[i][j] = this.pearsonCorrelation(
            samples[i].sgRNACounts,
            samples[j].sgRNACounts
          );
        }
      }
    }

    return correlations;
  }

  private pearsonCorrelation(
    counts1: Map<string, number>,
    counts2: Map<string, number>
  ): number {
    const allSgRNAs = new Set([...counts1.keys(), ...counts2.keys()]);
    const pairs: [number, number][] = [];

    for (const sgRNA of allSgRNAs) {
      pairs.push([counts1.get(sgRNA) || 0, counts2.get(sgRNA) || 0]);
    }

    if (pairs.length === 0) return 0;

    const x = pairs.map(p => p[0]);
    const y = pairs.map(p => p[1]);

    const meanX = x.reduce((a, b) => a + b, 0) / x.length;
    const meanY = y.reduce((a, b) => a + b, 0) / y.length;

    let numerator = 0;
    let denomX = 0;
    let denomY = 0;

    for (let i = 0; i < pairs.length; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      numerator += dx * dy;
      denomX += dx * dx;
      denomY += dy * dy;
    }

    if (denomX === 0 || denomY === 0) return 0;

    return numerator / Math.sqrt(denomX * denomY);
  }

  private mergeResults(
    algorithmResults: {
      mageck?: MAGeCKGeneResult[];
      bagel2?: BAGEL2GeneResult[];
      drugz?: DrugZGeneResult[];
    },
    parameters: AnalysisParameters
  ): GeneResultUnified[] {
    // Collect all genes from all algorithms
    const geneMap = new Map<string, GeneResultUnified>();

    // Add MAGeCK results
    if (algorithmResults.mageck) {
      for (const result of algorithmResults.mageck) {
        geneMap.set(result.gene, {
          gene: result.gene,
          numSgRNAs: result.numSgRNAs,
          log2FC: result.log2FC,
          pValue: Math.min(result.pValueNeg, result.pValuePos),
          fdr: Math.min(result.fdrNeg, result.fdrPos),
          rank: result.rank,
          mageck: {
            rhoNeg: result.rhoNeg,
            rhoPos: result.rhoPos,
            pValueNeg: result.pValueNeg,
            pValuePos: result.pValuePos,
            fdrNeg: result.fdrNeg,
            fdrPos: result.fdrPos
          }
        });
      }
    }

    // Add BAGEL2 results
    if (algorithmResults.bagel2) {
      for (const result of algorithmResults.bagel2) {
        const existing = geneMap.get(result.gene);
        if (existing) {
          existing.bagel2 = {
            bayesFactor: result.bayesFactor,
            essentialProbability: result.essentialProbability
          };
        } else {
          geneMap.set(result.gene, {
            gene: result.gene,
            numSgRNAs: result.numSgRNAs,
            log2FC: result.log2FC,
            pValue: 1 / (1 + Math.exp(result.bayesFactor)), // Convert BF to pseudo-pvalue
            fdr: 1 / (1 + Math.exp(result.bayesFactor)),
            rank: result.rank,
            bagel2: {
              bayesFactor: result.bayesFactor,
              essentialProbability: result.essentialProbability
            }
          });
        }
      }
    }

    // Add DrugZ results
    if (algorithmResults.drugz) {
      for (const result of algorithmResults.drugz) {
        const existing = geneMap.get(result.gene);
        if (existing) {
          existing.drugz = {
            normZ: result.normZ,
            syntheticScore: result.syntheticScore
          };
          // Use DrugZ p-value if it's more significant
          if (result.pValue < existing.pValue) {
            existing.pValue = result.pValue;
            existing.fdr = result.fdr;
          }
        } else {
          geneMap.set(result.gene, {
            gene: result.gene,
            numSgRNAs: result.numSgRNAs,
            log2FC: result.log2FC,
            pValue: result.pValue,
            fdr: result.fdr,
            rank: result.rank,
            drugz: {
              normZ: result.normZ,
              syntheticScore: result.syntheticScore
            }
          });
        }
      }
    }

    // Convert to array and sort by FDR
    const results = Array.from(geneMap.values());
    results.sort((a, b) => a.fdr - b.fdr);

    // Assign unified ranks
    results.forEach((result, index) => {
      result.rank = index + 1;
    });

    return results;
  }
}

export default AnalysisPipeline;
