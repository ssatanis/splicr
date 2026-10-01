/**
 * The QC thresholds, as the engine defines them.
 *
 * These are mirrored from `engine/splicr/config.py:QcThresholds` so the console
 * can say what a value is being judged against without a round trip. A test
 * parses that file and fails if any number here stops matching it, because a
 * console that quotes a threshold the engine no longer uses is worse than one
 * that quotes none: a reader would check their screen against the wrong line.
 *
 * Every one is somebody else's published number, and the attribution travels
 * with it. A researcher deciding whether to trust a run is entitled to know
 * whether a line they are being held to is DepMap's, MAGeCK's, or ours.
 */

export interface Threshold {
  value: number;
  /** Who set it. "SplicR" where it is our own convention and nobody else's. */
  source: string;
}

export const QC: Record<string, Threshold> = {
  /** Below this a sample's reads are largely not guide amplicon. */
  mappingRateMin: { value: 0.6, source: "MAGeCK" },
  mappingRateWarn: { value: 0.65, source: "MAGeCKFlute" },
  /** Guides with no reads at all. Past the second figure the library is bottlenecked. */
  zeroFractionMax: { value: 0.01, source: "MAGeCK" },
  zeroFractionWarn: { value: 0.05, source: "MAGeCK" },
  /** 90th over 10th percentile guide count. */
  skewRatioMax: { value: 10, source: "Joung et al. 2017" },
  meanReadsPerGuideMin: { value: 185, source: "DepMap" },
  /** (median essential − median non-essential) / MAD(non-essential). Lower is better. */
  nnmdMax: { value: -1.25, source: "DepMap" },
  /** Pearson r of raw log counts between replicates. A coarse backstop. */
  replicateRMin: { value: 0.5, source: "SplicR" },
  giniPlasmidMax: { value: 0.15, source: "MAGeCK" },
  giniEndpointMax: { value: 0.35, source: "MAGeCK" },
} as const;
