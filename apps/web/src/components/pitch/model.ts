export type DiligenceInputs = {
  structuralVulnerability: number;
  contextualEscapeRisk: number;
  toxicityRisk: number;
};

const clamp = (value: number) => Math.min(100, Math.max(0, value));

/**
 * A transparent diligence index, not a calibrated clinical probability.
 * Risk inputs are inverted because lower escape/toxicity risk raises the result.
 */
export function translationalScore(inputs: DiligenceInputs): number {
  const structural = clamp(inputs.structuralVulnerability);
  const escapeResilience = 100 - clamp(inputs.contextualEscapeRisk);
  const safetyMargin = 100 - clamp(inputs.toxicityRisk);
  return Math.round(structural * 0.4 + escapeResilience * 0.35 + safetyMargin * 0.25);
}

/** Only public, same-origin paths are eligible as the exit from pitch mode. */
export function honestRoute(candidate: string | null | undefined): string {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  if (candidate.startsWith("/pitch") || candidate.startsWith("/dashboard")) return "/";
  return candidate;
}

export const pipelineSteps = [
  { key: "ingest", label: "Ingest FASTQ", short: "Ingest" },
  { key: "qc", label: "FastQC validation", short: "FastQC" },
  { key: "compute", label: "MAGeCK / BAGEL2", short: "Compute" },
  { key: "structure", label: "AlphaFold structural context", short: "Structure" },
  { key: "escape", label: "Paralog escape analysis", short: "Escape" },
] as const;

export type PipelineStepKey = (typeof pipelineSteps)[number]["key"];

export const pipelineLogs: Record<PipelineStepKey, readonly string[]> = {
  ingest: [
    "Resolving GEO series and sample accessions",
    "Manifest locked, 8 FASTQ lanes, 412.6M reads",
    "Read groups normalized against GRCh38",
  ],
  qc: [
    "FastQC 0.12.1, adapter and per-base checks",
    "Median Q30 94.8%, zero-count guide ceiling 3.1%",
    "Replicate gate passed, Pearson r 0.93–0.96",
  ],
  compute: [
    "MAGeCK RRA 0.5.9.5, treatment against plasmid Day-0",
    "BAGEL2 1.30, CEGv2 reference separation NNMD -1.82",
    "12 depleted candidates retained at BH FDR ≤ 0.05",
  ],
  structure: [
    "UniProt MANE mapping, 47 guide cuts resolved",
    "AlphaFold coordinates attached to mapped residues",
    "Structural context recorded, effect scores unchanged",
  ],
  escape: [
    "Ensembl Compara + HGNC paralog graph loaded",
    "ARID1A → ARID1B conditional dependency evaluated",
    "Validation array proposed, direct evidence still required",
  ],
};
