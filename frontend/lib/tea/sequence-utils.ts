/**
 * Generate unique TEA Report IDs
 * Format: TEA-YYYY-XXXX-XXXX (e.g., TEA-2026-A7K9-M3P2)
 */

import { customAlphabet } from 'nanoid';

// Use alphanumeric characters excluding ambiguous ones (0, O, I, 1, l)
const nanoid = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4);

export function generateTEAReportId(): string {
  const year = new Date().getFullYear();
  const part1 = nanoid();
  const part2 = nanoid();
  
  return `TEA-${year}-${part1}-${part2}`;
}

/**
 * Validate TEA Report ID format
 */
export function isValidTEAReportId(id: string): boolean {
  return /^TEA-\d{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(id);
}

/**
 * Parse sequence from various formats
 */
export interface ParsedSequence {
  sequence: string;
  header?: string;
  format: 'fasta' | 'plain';
  metadata?: Record<string, any>;
}

export async function parseSequenceFile(file: File): Promise<ParsedSequence> {
  const text = await file.text();
  
  // Detect FASTA format
  if (text.trim().startsWith('>')) {
    const lines = text.split('\n');
    const header = lines[0].substring(1).trim();
    const sequence = lines
      .slice(1)
      .join('')
      .replace(/\s/g, '')
      .toUpperCase();
    
    return {
      sequence,
      header,
      format: 'fasta',
      metadata: parseFastaHeader(header)
    };
  }
  
  // Plain text format
  const sequence = text
    .replace(/\s/g, '')
    .replace(/[^ACGTNacgtn]/g, '')
    .toUpperCase();
  
  return {
    sequence,
    format: 'plain'
  };
}

/**
 * Parse FASTA header for metadata
 */
function parseFastaHeader(header: string): Record<string, any> {
  const metadata: Record<string, any> = {};
  
  // Extract gene name if present
  const geneMatch = header.match(/gene[=:](\w+)/i);
  if (geneMatch) metadata.gene = geneMatch[1];
  
  // Extract chromosome
  const chrMatch = header.match(/chr(\w+)/i);
  if (chrMatch) metadata.chromosome = chrMatch[1];
  
  // Extract position
  const posMatch = header.match(/(\d+)-(\d+)/);
  if (posMatch) {
    metadata.start = parseInt(posMatch[1]);
    metadata.end = parseInt(posMatch[2]);
  }
  
  return metadata;
}

/**
 * Validate DNA sequence
 */
export interface SequenceValidation {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export function validateSequence(seq: string): SequenceValidation {
  const warnings: string[] = [];
  
  // Check for invalid characters
  if (!/^[ACGTN]+$/i.test(seq)) {
    return {
      valid: false,
      error: 'Invalid characters detected. Only A, C, G, T, N are allowed.'
    };
  }
  
  // Check minimum length
  if (seq.length < 50) {
    return {
      valid: false,
      error: 'Sequence too short. Minimum 50 bp required for accurate analysis.'
    };
  }
  
  // Check maximum length
  if (seq.length > 10000) {
    return {
      valid: false,
      error: 'Sequence too long. Maximum 10,000 bp allowed.'
    };
  }
  
  // Warn about high N content
  const nContent = (seq.match(/N/gi) || []).length / seq.length;
  if (nContent > 0.1) {
    warnings.push(`High N content (${(nContent * 100).toFixed(1)}%). Results may be less accurate.`);
  }
  
  // Warn about extreme GC content
  const gcContent = calculateGC(seq);
  if (gcContent < 30 || gcContent > 70) {
    warnings.push(`Extreme GC content (${gcContent.toFixed(1)}%). This may affect editing efficiency.`);
  }
  
  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Calculate GC content percentage
 */
export function calculateGC(sequence: string): number {
  const gcCount = (sequence.match(/[GCgc]/g) || []).length;
  return (gcCount / sequence.length) * 100;
}

/**
 * Find PAM sites in sequence
 */
export interface PAMSite {
  sequence: string;
  position: number;
  distance: number; // Distance from target position
  strand: '+' | '-';
  type: 'SpCas9' | 'SaCas9' | 'Cas9-NG' | 'ScCas9';
  score: number; // Quality score 0-1
}

export function findPAMSites(
  sequence: string,
  targetPosition: number
): PAMSite[] {
  const pams: PAMSite[] = [];
  const seq = sequence.toUpperCase();
  
  // SpCas9 NGG PAM (most common)
  for (let i = 0; i < seq.length - 2; i++) {
    if (seq[i + 1] === 'G' && seq[i + 2] === 'G') {
      const distance = Math.abs(i - targetPosition);
      const score = calculatePAMScore(distance, 'SpCas9');
      
      pams.push({
        sequence: seq.substring(i, i + 3),
        position: i,
        distance,
        strand: '+',
        type: 'SpCas9',
        score
      });
    }
  }
  
  // SaCas9 NNGRRT PAM
  for (let i = 0; i < seq.length - 5; i++) {
    const pam = seq.substring(i, i + 6);
    if (/^..G[AG][AG]T$/.test(pam)) {
      const distance = Math.abs(i - targetPosition);
      const score = calculatePAMScore(distance, 'SaCas9');
      
      pams.push({
        sequence: pam,
        position: i,
        distance,
        strand: '+',
        type: 'SaCas9',
        score
      });
    }
  }
  
  // Cas9-NG (NG PAM - very relaxed)
  for (let i = 0; i < seq.length - 1; i++) {
    if (seq[i + 1] === 'G') {
      const distance = Math.abs(i - targetPosition);
      const score = calculatePAMScore(distance, 'Cas9-NG') * 0.8; // Lower baseline
      
      pams.push({
        sequence: seq.substring(i, i + 2),
        position: i,
        distance,
        strand: '+',
        type: 'Cas9-NG',
        score
      });
    }
  }
  
  return pams.sort((a, b) => b.score - a.score);
}

/**
 * Calculate PAM quality score based on distance and type
 */
function calculatePAMScore(distance: number, type: PAMSite['type']): number {
  // Optimal distance for base editing: 4-8 bp from PAM
  // Optimal distance for prime editing: 0-30 bp from PAM
  
  let optimalDistance: number;
  let tolerance: number;
  
  switch (type) {
    case 'SpCas9':
      optimalDistance = 6;
      tolerance = 2;
      break;
    case 'SaCas9':
      optimalDistance = 7;
      tolerance = 3;
      break;
    case 'Cas9-NG':
      optimalDistance = 6;
      tolerance = 3;
      break;
    default:
      optimalDistance = 6;
      tolerance = 2;
  }
  
  const deviation = Math.abs(distance - optimalDistance);
  
  if (deviation <= tolerance) {
    return 1.0 - (deviation / tolerance) * 0.3; // 0.7 to 1.0
  } else if (deviation <= tolerance * 2) {
    return 0.7 - ((deviation - tolerance) / tolerance) * 0.4; // 0.3 to 0.7
  } else {
    return Math.max(0.1, 0.3 - (deviation / 50)); // Decay slowly
  }
}

/**
 * Predict secondary structures
 */
export interface SecondaryStructure {
  position: number;
  length: number;
  type: 'hairpin' | 'stem-loop' | 'bulge';
  deltaG: number; // Gibbs free energy
  structure: string; // Dot-bracket notation
}

export function predictStructures(sequence: string): SecondaryStructure[] {
  // Simplified structure prediction (real implementation would use ViennaRNA)
  const structures: SecondaryStructure[] = [];
  const seq = sequence.toUpperCase();
  
  // Look for inverted repeats (potential hairpins)
  for (let i = 0; i < seq.length - 8; i++) {
    for (let j = i + 4; j < Math.min(i + 50, seq.length - 4); j++) {
      const upstream = seq.substring(i, i + 4);
      const downstream = seq.substring(j, j + 4);
      const revComp = reverseComplement(downstream);
      
      if (upstream === revComp) {
        const loopSize = j - i - 4;
        const stemSize = 4;
        
        // Estimate deltaG (simplified)
        const deltaG = -(stemSize * 1.5 + Math.min(loopSize, 8) * 0.5);
        
        if (deltaG < -6) { // Stable enough to matter
          structures.push({
            position: i,
            length: j - i + 4,
            type: 'hairpin',
            deltaG,
            structure: '((((...))))' // Simplified
          });
        }
      }
    }
  }
  
  return structures.sort((a, b) => a.deltaG - b.deltaG); // Most stable first
}

/**
 * Reverse complement of DNA sequence
 */
export function reverseComplement(seq: string): string {
  const complement: Record<string, string> = {
    'A': 'T',
    'T': 'A',
    'G': 'C',
    'C': 'G',
    'N': 'N'
  };
  
  return seq
    .toUpperCase()
    .split('')
    .reverse()
    .map(base => complement[base] || base)
    .join('');
}

/**
 * Generate share token for reports
 */
export function generateShareToken(): string {
  const nanoid = customAlphabet(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
    32
  );
  return nanoid();
}
