/**
 * Sequence and Gene List Parsers
 * Handles FASTA, VCF, GenBank, CSV, TSV, TXT, Excel formats
 */

import { ParsedSequence, ParsedGeneList } from './types/analyses';

// ============================================================================
// Sequence Parsers
// ============================================================================

/**
 * Parse FASTA format sequences
 * Supports single and multiple sequences
 */
export function parseFasta(content: string): ParsedSequence {
  const lines = content.trim().split('\n');
  
  if (lines.length === 0) {
    throw new Error('Empty FASTA file');
  }

  // Find first sequence header
  const headerIndex = lines.findIndex(line => line.startsWith('>'));
  
  if (headerIndex === -1) {
    throw new Error('Invalid FASTA format: No header found (should start with >)');
  }

  const header = lines[headerIndex].substring(1).trim();
  const sequenceLines: string[] = [];
  
  // Collect sequence lines until next header or end
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (lines[i].startsWith('>')) break;
    sequenceLines.push(lines[i].trim());
  }

  const sequence = sequenceLines.join('').toUpperCase();
  
  if (!isValidDNASequence(sequence)) {
    throw new Error('Invalid DNA sequence: Contains non-ATGCN characters');
  }

  return {
    sequence,
    length: sequence.length,
    metadata: {
      id: header.split(/\s+/)[0],
      description: header,
      source: 'fasta'
    }
  };
}

/**
 * Parse plain text DNA sequence
 */
export function parsePlainSequence(content: string): ParsedSequence {
  const sequence = content
    .replace(/\s+/g, '') // Remove all whitespace
    .replace(/[0-9]/g, '') // Remove numbers
    .toUpperCase();

  if (!isValidDNASequence(sequence)) {
    throw new Error('Invalid DNA sequence: Contains non-ATGCN characters');
  }

  if (sequence.length < 20) {
    throw new Error('Sequence too short: Minimum 20 bases required');
  }

  if (sequence.length > 10000) {
    throw new Error('Sequence too long: Maximum 10,000 bases allowed');
  }

  return {
    sequence,
    length: sequence.length,
    metadata: {
      source: 'manual'
    }
  };
}

/**
 * Parse GenBank format
 * Simplified parser for sequence extraction
 */
export function parseGenBank(content: string): ParsedSequence {
  const lines = content.split('\n');
  
  let inOriginSection = false;
  const sequenceLines: string[] = [];
  let locus = '';

  for (const line of lines) {
    // Extract LOCUS
    if (line.startsWith('LOCUS')) {
      locus = line.split(/\s+/)[1] || '';
    }
    
    // Start of sequence section
    if (line.startsWith('ORIGIN')) {
      inOriginSection = true;
      continue;
    }
    
    // End of sequence
    if (line.startsWith('//')) {
      inOriginSection = false;
      break;
    }
    
    // Collect sequence
    if (inOriginSection) {
      // GenBank format: "  1 atcgatcgat cgtagctag"
      const seqPart = line.replace(/^\s*\d+\s*/, '').replace(/\s+/g, '');
      sequenceLines.push(seqPart);
    }
  }

  if (sequenceLines.length === 0) {
    throw new Error('Invalid GenBank format: No sequence found');
  }

  const sequence = sequenceLines.join('').toUpperCase();

  if (!isValidDNASequence(sequence)) {
    throw new Error('Invalid DNA sequence in GenBank file');
  }

  return {
    sequence,
    length: sequence.length,
    metadata: {
      id: locus,
      source: 'genbank'
    }
  };
}

/**
 * Parse VCF and extract sequence context
 * Note: For production, this should query reference genome
 */
export function parseVCF(content: string): ParsedSequence {
  const lines = content.split('\n').filter(line => !line.startsWith('##'));
  
  const dataLines = lines.filter(line => line.trim() && !line.startsWith('#'));
  
  if (dataLines.length === 0) {
    throw new Error('No variants found in VCF file');
  }

  // Parse first variant
  const fields = dataLines[0].split('\t');
  if (fields.length < 5) {
    throw new Error('Invalid VCF format');
  }

  const [chrom, pos, id, ref, alt] = fields;
  
  // For demo: create synthetic sequence context (±50bp)
  // In production: query reference genome API
  const contextLength = 50;
  const totalLength = contextLength * 2 + ref.length;
  
  // Generate placeholder context sequence
  const sequence = 'N'.repeat(contextLength) + ref.toUpperCase() + 'N'.repeat(contextLength);

  return {
    sequence,
    length: sequence.length,
    metadata: {
      id: id !== '.' ? id : `${chrom}:${pos}`,
      description: `${chrom}:${pos} ${ref}>${alt}`,
      source: 'vcf'
    }
  };
}

/**
 * Validate DNA sequence
 */
function isValidDNASequence(seq: string): boolean {
  return /^[ATGCN]+$/i.test(seq);
}

// ============================================================================
// Gene List Parsers
// ============================================================================

/**
 * Parse CSV file with gene symbols
 */
export function parseCSV(content: string): ParsedGeneList {
  const lines = content.trim().split('\n');
  
  if (lines.length === 0) {
    throw new Error('Empty CSV file');
  }

  const genes: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  // Try to detect header
  const firstLine = lines[0];
  const hasHeader = /gene|symbol|name/i.test(firstLine);
  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split by comma, take first column
    const fields = line.split(',').map(f => f.trim().replace(/['"]/g, ''));
    const gene = fields[0].toUpperCase();

    if (!gene) continue;

    // Validate gene symbol format (alphanumeric + dash/dot)
    if (!/^[A-Z0-9][A-Z0-9\-\.]*$/i.test(gene)) {
      invalid.push(gene);
      continue;
    }

    if (seen.has(gene)) {
      duplicates.push(gene);
      continue;
    }

    seen.add(gene);
    genes.push(gene);
  }

  if (genes.length === 0) {
    throw new Error('No valid gene symbols found in CSV');
  }

  return {
    genes,
    invalid_genes: invalid.length > 0 ? invalid : undefined,
    duplicates: duplicates.length > 0 ? duplicates : undefined,
    metadata: {
      row_count: lines.length - startIdx
    }
  };
}

/**
 * Parse TSV file with gene symbols
 */
export function parseTSV(content: string): ParsedGeneList {
  const lines = content.trim().split('\n');
  
  if (lines.length === 0) {
    throw new Error('Empty TSV file');
  }

  const genes: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  // Try to detect header
  const firstLine = lines[0];
  const hasHeader = /gene|symbol|name/i.test(firstLine);
  const startIdx = hasHeader ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Split by tab, take first column
    const fields = line.split('\t').map(f => f.trim());
    const gene = fields[0].toUpperCase();

    if (!gene) continue;

    if (!/^[A-Z0-9][A-Z0-9\-\.]*$/i.test(gene)) {
      invalid.push(gene);
      continue;
    }

    if (seen.has(gene)) {
      duplicates.push(gene);
      continue;
    }

    seen.add(gene);
    genes.push(gene);
  }

  if (genes.length === 0) {
    throw new Error('No valid gene symbols found in TSV');
  }

  return {
    genes,
    invalid_genes: invalid.length > 0 ? invalid : undefined,
    duplicates: duplicates.length > 0 ? duplicates : undefined,
    metadata: {
      row_count: lines.length - startIdx
    }
  };
}

/**
 * Parse plain text gene list (one per line)
 */
export function parsePlainGeneList(content: string): ParsedGeneList {
  const lines = content.trim().split(/[\n,;\s]+/);
  
  const genes: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];

  for (const line of lines) {
    const gene = line.trim().toUpperCase();
    if (!gene) continue;

    if (!/^[A-Z0-9][A-Z0-9\-\.]*$/i.test(gene)) {
      invalid.push(gene);
      continue;
    }

    if (seen.has(gene)) {
      duplicates.push(gene);
      continue;
    }

    seen.add(gene);
    genes.push(gene);
  }

  if (genes.length === 0) {
    throw new Error('No valid gene symbols found');
  }

  return {
    genes,
    invalid_genes: invalid.length > 0 ? invalid : undefined,
    duplicates: duplicates.length > 0 ? duplicates : undefined
  };
}

/**
 * Detect file type and parse accordingly
 */
export async function parseSequenceFile(file: File): Promise<ParsedSequence & { source: string }> {
  const content = await file.text();
  const fileName = file.name.toLowerCase();

  try {
    if (fileName.endsWith('.fasta') || fileName.endsWith('.fa') || fileName.endsWith('.fna')) {
      return { ...parseFasta(content), source: 'fasta' };
    } else if (fileName.endsWith('.gb') || fileName.endsWith('.genbank')) {
      return { ...parseGenBank(content), source: 'genbank' };
    } else if (fileName.endsWith('.vcf')) {
      return { ...parseVCF(content), source: 'vcf' };
    } else if (fileName.endsWith('.txt')) {
      return { ...parsePlainSequence(content), source: 'manual' };
    } else {
      // Try to auto-detect
      if (content.trim().startsWith('>')) {
        return { ...parseFasta(content), source: 'fasta' };
      } else if (content.includes('LOCUS') && content.includes('ORIGIN')) {
        return { ...parseGenBank(content), source: 'genbank' };
      } else if (content.includes('##fileformat=VCF')) {
        return { ...parseVCF(content), source: 'vcf' };
      } else {
        return { ...parsePlainSequence(content), source: 'manual' };
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Detect file type and parse gene list
 */
export async function parseGeneListFile(file: File): Promise<ParsedGeneList & { source: string }> {
  const content = await file.text();
  const fileName = file.name.toLowerCase();

  try {
    if (fileName.endsWith('.csv')) {
      return { ...parseCSV(content), source: 'csv' };
    } else if (fileName.endsWith('.tsv') || fileName.endsWith('.tab')) {
      return { ...parseTSV(content), source: 'tsv' };
    } else if (fileName.endsWith('.txt')) {
      return { ...parsePlainGeneList(content), source: 'txt' };
    } else {
      // Auto-detect by checking for delimiters
      if (content.includes('\t')) {
        return { ...parseTSV(content), source: 'tsv' };
      } else if (content.includes(',')) {
        return { ...parseCSV(content), source: 'csv' };
      } else {
        return { ...parsePlainGeneList(content), source: 'txt' };
      }
    }
  } catch (error) {
    throw new Error(`Failed to parse ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
