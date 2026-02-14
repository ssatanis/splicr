/**
 * Sequence utility functions for TEA (Therapeutic Editing Assessment)
 */

/**
 * Generate a unique TEA report ID
 */
export function generateTEAReportId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `TEA-${timestamp}-${randomPart}`.toUpperCase();
}

/**
 * Calculate GC content of a sequence
 */
export function calculateGCContent(sequence: string): number {
  if (!sequence) return 0;
  const gcCount = (sequence.match(/[GC]/gi) || []).length;
  return (gcCount / sequence.length) * 100;
}

/**
 * Find homopolymers in a sequence
 */
export function findHomopolymers(sequence: string, minLength: number = 4): string[] {
  const homopolymers: string[] = [];
  const regex = /([ACGT])\1{3,}/gi;
  let match;
  
  while ((match = regex.exec(sequence)) !== null) {
    if (match[0].length >= minLength) {
      homopolymers.push(match[0]);
    }
  }
  
  return homopolymers;
}

/**
 * Validate DNA sequence
 */
export function isValidDNASequence(sequence: string): boolean {
  return /^[ACGT]+$/i.test(sequence);
}

/**
 * Get reverse complement of a DNA sequence
 */
export function reverseComplement(sequence: string): string {
  const complement: { [key: string]: string } = {
    'A': 'T', 'T': 'A', 'G': 'C', 'C': 'G',
    'a': 't', 't': 'a', 'g': 'c', 'c': 'g'
  };
  
  return sequence
    .split('')
    .reverse()
    .map(base => complement[base] || base)
    .join('');
}

/**
 * Find PAM sites in a sequence
 */
export function findPAMSites(
  sequence: string,
  pamSequence: string = 'NGG',
  searchRadius: number = 50
): Array<{ sequence: string; position: number; strand: string }> {
  const sites: Array<{ sequence: string; position: number; strand: string }> = [];
  
  // Convert PAM pattern to regex (N = any nucleotide)
  const pamPattern = pamSequence.replace(/N/g, '[ACGT]');
  const regex = new RegExp(pamPattern, 'gi');
  
  // Search forward strand
  let match;
  while ((match = regex.exec(sequence)) !== null) {
    sites.push({
      sequence: match[0],
      position: match.index,
      strand: '+'
    });
  }
  
  // Search reverse strand
  const revComp = reverseComplement(sequence);
  const revRegex = new RegExp(pamPattern, 'gi');
  while ((match = revRegex.exec(revComp)) !== null) {
    sites.push({
      sequence: match[0],
      position: sequence.length - match.index - match[0].length,
      strand: '-'
    });
  }
  
  return sites;
}

/**
 * Parse sequence from uploaded file
 */
export async function parseSequenceFile(file: File): Promise<{
  sequence: string;
  format: string;
  metadata?: Record<string, any>;
}> {
  const text = await file.text();
  const fileName = file.name.toLowerCase();
  
  // Handle FASTA format
  if (fileName.endsWith('.fasta') || fileName.endsWith('.fa') || text.startsWith('>')) {
    const lines = text.split('\n');
    const sequence = lines
      .filter(line => !line.startsWith('>'))
      .join('')
      .replace(/\s/g, '')
      .toUpperCase();
    
    const header = lines.find(line => line.startsWith('>'));
    const metadata = header ? { header: header.substring(1).trim() } : undefined;
    
    return { sequence, format: 'FASTA', metadata };
  }
  
  // Handle plain text
  const sequence = text.replace(/\s/g, '').toUpperCase();
  return { sequence, format: 'plain' };
}

/**
 * Validate DNA sequence and return validation results
 */
export function validateSequence(sequence: string): {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    gcContent: number;
    length: number;
    pamSites: number;
  };
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check if sequence is empty
  if (!sequence || sequence.trim().length === 0) {
    errors.push('Sequence cannot be empty');
    return { isValid: false, errors, warnings };
  }
  
  // Remove whitespace
  const cleanSeq = sequence.replace(/\s/g, '');
  
  // Check for invalid characters
  if (!isValidDNASequence(cleanSeq)) {
    errors.push('Sequence contains invalid characters. Only A, C, G, T are allowed.');
    return { isValid: false, errors, warnings };
  }
  
  // Check length
  if (cleanSeq.length < 20) {
    errors.push('Sequence is too short. Minimum length is 20 bp.');
  }
  
  if (cleanSeq.length > 10000) {
    warnings.push('Sequence is very long. Consider providing a smaller target region.');
  }
  
  // Calculate GC content
  const gcContent = calculateGCContent(cleanSeq);
  
  if (gcContent < 30 || gcContent > 70) {
    warnings.push(`GC content is ${gcContent.toFixed(1)}%. Optimal range is 30-70%.`);
  }
  
  // Find PAM sites
  const pamSites = findPAMSites(cleanSeq);
  
  if (pamSites.length === 0) {
    warnings.push('No NGG PAM sites found. Consider alternative PAM sequences or base/prime editing.');
  }
  
  const metadata = {
    gcContent,
    length: cleanSeq.length,
    pamSites: pamSites.length,
  };
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    metadata,
  };
}
