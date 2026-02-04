/**
 * Single source of truth for allowed sequencing/data file extensions.
 * Used by frontend validation and all upload API routes.
 */
export const ALLOWED_SEQUENCING_EXTENSIONS = [
  '.fastq',
  '.fq',
  '.fastq.gz',
  '.fq.gz',
  '.bam',
  '.cram',
  '.sam',
  '.txt',
] as const;

export type AllowedExtension = (typeof ALLOWED_SEQUENCING_EXTENSIONS)[number];

export function hasAllowedExtension(filename: string): boolean {
  const lower = filename.toLowerCase();
  return ALLOWED_SEQUENCING_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function getAllowedExtensionsCopy(): string {
  return ALLOWED_SEQUENCING_EXTENSIONS.join(', ');
}

/** Human-readable list for UI: "FASTQ/FASTQ.GZ, BAM/CRAM, SAM, TXT count tables" */
export const SUPPORTED_FORMATS_UI =
  'FASTQ/FASTQ.GZ, BAM/CRAM, SAM, TXT count tables';
