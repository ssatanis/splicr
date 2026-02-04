/** Allowed method values for analyses_method_check constraint (Supabase). */
export const ALLOWED_ANALYSIS_METHODS = ['mageck', 'bagel2', 'drugz'] as const

export type AnalysisMethod = (typeof ALLOWED_ANALYSIS_METHODS)[number]

/**
 * Normalize method to a value allowed by analyses_method_check (mageck, bagel2, drugz).
 * Use when inserting/updating analyses to avoid constraint violations.
 */
export function normalizeAnalysisMethod(method: string): AnalysisMethod {
  const lower = String(method || 'mageck').toLowerCase()
  if (ALLOWED_ANALYSIS_METHODS.includes(lower as AnalysisMethod)) return lower as AnalysisMethod
  return 'mageck'
}
