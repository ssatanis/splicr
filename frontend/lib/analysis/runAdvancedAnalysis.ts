/**
 * Rebuild count matrix and sample indices from stored analysis results.
 * Used by /api/analyze/bagel2 and /api/analyze/drugz to run BAGEL2/DrugZ on existing analyses.
 */

import { getLibrary } from './sgRNALibraries';

export interface SampleLabel {
  fileName: string;
  fileId: string;
  sampleName: string;
  condition: 'control' | 'treatment';
  replicate: number;
}

export interface StoredAnalysis {
  id: string;
  sampleLabels: SampleLabel[];
  libraryType: string;
  parameters?: Record<string, unknown>;
}

export interface StoredResults {
  rawData?: {
    countMatrix: Record<string, Record<string, number>>;
  };
}

export interface RebuiltMatrix {
  countMatrix: Map<string, number[]>;
  sgRNAToGene: Map<string, string>;
  controlIndices: number[];
  treatmentIndices: number[];
  sampleNames: string[];
}

export function rebuildMatrixFromStored(
  analysis: StoredAnalysis,
  results: StoredResults
): RebuiltMatrix {
  const raw = results.rawData?.countMatrix;
  if (!raw || typeof raw !== 'object') {
    throw new Error('No raw count matrix in results');
  }

  const sampleLabels = analysis.sampleLabels || [];
  if (sampleLabels.length === 0) {
    throw new Error('No sample labels in analysis');
  }

  const sampleNames = sampleLabels.map((l: SampleLabel) => l.sampleName);
  const controlIndices: number[] = [];
  const treatmentIndices: number[] = [];
  sampleLabels.forEach((l: SampleLabel, i: number) => {
    if (l.condition === 'control') controlIndices.push(i);
    else treatmentIndices.push(i);
  });

  const library = getLibrary(analysis.libraryType);
  const countMatrix = new Map<string, number[]>();
  const sgRNAToGene = new Map<string, string>();
  let unmappedIndex = 0;

  for (const sgRNA of Object.keys(raw)) {
    const row = raw[sgRNA];
    if (!row || typeof row !== 'object') continue;
    const counts = sampleNames.map((name: string) => (row[name] ?? 0) as number);
    countMatrix.set(sgRNA, counts);
    const gene = library.get(sgRNA) ?? `SGRNA_${++unmappedIndex}`;
    sgRNAToGene.set(sgRNA, gene);
  }

  return {
    countMatrix,
    sgRNAToGene,
    controlIndices,
    treatmentIndices,
    sampleNames
  };
}
