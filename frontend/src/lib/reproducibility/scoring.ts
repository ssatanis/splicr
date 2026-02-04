/**
 * Reproducibility Scoring System
 *
 * Calculates reproducibility scores based on completeness of documentation,
 * provenance tracking, and best practices. Awards badges for achievements.
 */

import { createClient } from '@/lib/supabase/server';
import {
  ReproducibilityScore,
  ReproducibilityChecklist,
  ReproducibilityBadge,
  BadgeInfo,
  ScoreImprovement,
} from '@/lib/types';

// =============================================================================
// SCORE CALCULATION
// =============================================================================

/**
 * Calculate and update reproducibility score for an analysis
 */
export async function calculateAndUpdateScore(
  analysis_id: string
): Promise<ReproducibilityScore> {
  const supabase = await createClient();

  // Use database function to calculate scores
  const { data: scoreData, error } = await (supabase as any)
    .rpc('calculate_reproducibility_score', { p_analysis_id: analysis_id })
    .single();

  if (error) {
    throw new Error(`Failed to calculate reproducibility score: ${error.message}`);
  }

  // Calculate checklist items
  const checklist = await calculateChecklist(analysis_id);

  // Upsert score
  const score: Partial<ReproducibilityScore> = {
    analysis_id,
    total_score: scoreData.total_score,
    parameters_documented: scoreData.parameters_documented,
    software_versions_captured: scoreData.software_versions_captured,
    provenance_tracked: scoreData.provenance_tracked,
    data_checksums_recorded: scoreData.data_checksums_recorded,
    methods_generated: scoreData.methods_generated,
    package_exported: scoreData.package_exported,
    published_with_doi: scoreData.published_with_doi,
    checklist,
    badge: scoreData.badge,
    updated_at: new Date().toISOString(),
  };

  const { data, error: upsertError } = await (supabase as any)
    .from('reproducibility_scores')
    .upsert(score, { onConflict: 'analysis_id' })
    .select()
    .single();

  if (upsertError) {
    throw new Error(`Failed to save reproducibility score: ${upsertError.message}`);
  }

  return data as ReproducibilityScore;
}

/**
 * Get reproducibility score for an analysis
 */
export async function getReproducibilityScore(
  analysis_id: string
): Promise<ReproducibilityScore | null> {
  const supabase = await createClient();

  const { data, error } = await (supabase as any)
    .from('reproducibility_scores')
    .select('*')
    .eq('analysis_id', analysis_id)
    .single();

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = not found, which is ok
    throw new Error(`Failed to fetch reproducibility score: ${error.message}`);
  }

  return data as ReproducibilityScore | null;
}

/**
 * Calculate checklist items
 */
async function calculateChecklist(analysis_id: string): Promise<ReproducibilityChecklist> {
  const supabase = await createClient();

  // Check if input files have checksums
  const { data: entities } = await (supabase as any)
    .from('prov_entities')
    .select('checksum')
    .eq('analysis_id', analysis_id)
    .eq('is_input', true);

  const input_files_checksummed =
    entities && entities.length > 0 && entities.every((e: { checksum: string | null }) => e.checksum !== null);

  // Check if parameters are saved
  const { data: analysis } = await (supabase as any)
    .from('analyses')
    .select('parameters')
    .eq('id', analysis_id)
    .single();

  const parameters_saved =
    analysis?.parameters && Object.keys(analysis.parameters).length > 0;

  // Check if analysis is completed
  const analysis_completed = analysis && (analysis as any).status === 'complete';

  // Check if methods have been reviewed
  const { data: methods } = await (supabase as any)
    .from('analysis_methods')
    .select('is_edited')
    .eq('analysis_id', analysis_id)
    .limit(1);

  const methods_reviewed = methods && methods.length > 0 && methods[0].is_edited;

  // Check if package has been exported
  const { data: packages } = await (supabase as any)
    .from('reproducibility_packages')
    .select('id')
    .eq('analysis_id', analysis_id)
    .limit(1);

  const package_exported = packages && packages.length > 0;

  // Check if shared or published
  const { data: sharedPackages } = await (supabase as any)
    .from('reproducibility_packages')
    .select('is_public, doi')
    .eq('analysis_id', analysis_id);

  const shared_or_published =
    sharedPackages &&
    sharedPackages.some((pkg: { is_public?: boolean; doi?: string | null }) => pkg.is_public === true || pkg.doi !== null);

  return {
    input_files_checksummed: input_files_checksummed || false,
    parameters_saved: parameters_saved || false,
    analysis_completed: analysis_completed || false,
    methods_reviewed: methods_reviewed || false,
    package_exported: package_exported || false,
    shared_or_published: shared_or_published || false,
  };
}

// =============================================================================
// BADGE SYSTEM
// =============================================================================

/**
 * Get badge information for all badges
 */
export function getAllBadgeInfo(): BadgeInfo[] {
  return [
    {
      badge: 'platinum',
      name: 'Platinum Reproducibility',
      description: 'Perfect score with DOI published. The gold standard for scientific reproducibility.',
      icon: '🏆',
      color: '#E5E4E2',
      min_score: 100,
      requirements: [
        'Total score: 100/100',
        'All parameters documented',
        'Complete software version tracking',
        'Full provenance graph',
        'All data checksummed',
        'Methods section generated and reviewed',
        'Reproducibility package exported',
        'Published with DOI (Zenodo)',
      ],
    },
    {
      badge: 'gold',
      name: 'Gold Standard',
      description: 'Comprehensive reproducibility with package export. Ready for publication.',
      icon: '🥇',
      color: '#FFD700',
      min_score: 85,
      requirements: [
        'Total score: 85+/100',
        'All parameters documented',
        'Software versions captured',
        'Provenance tracking complete',
        'Reproducibility package exported',
      ],
    },
    {
      badge: 'silver',
      name: 'Silver Standard',
      description: 'Good reproducibility practices. Most requirements met.',
      icon: '🥈',
      color: '#C0C0C0',
      min_score: 60,
      requirements: [
        'Total score: 60+/100',
        'Parameters documented',
        'Some provenance tracking',
        'Basic checksums recorded',
      ],
    },
    {
      badge: 'bronze',
      name: 'Bronze Standard',
      description: 'Basic reproducibility requirements met. Good foundation.',
      icon: '🥉',
      color: '#CD7F32',
      min_score: 40,
      requirements: [
        'Total score: 40+/100',
        'Parameters saved',
        'Analysis completed',
      ],
    },
  ];
}

/**
 * Get badge info for a specific badge
 */
export function getBadgeInfo(badge: ReproducibilityBadge): BadgeInfo {
  const allBadges = getAllBadgeInfo();
  return allBadges.find((b) => b.badge === badge)!;
}

// =============================================================================
// SCORE IMPROVEMENTS
// =============================================================================

/**
 * Get suggestions for improving reproducibility score
 */
export async function getScoreImprovements(
  analysis_id: string
): Promise<ScoreImprovement[]> {
  const score = await getReproducibilityScore(analysis_id);

  if (!score) {
    return [
      {
        component: 'initial_setup',
        current_score: 0,
        max_score: 100,
        suggestions: [
          'Complete your analysis to start tracking reproducibility',
          'Ensure all parameters are documented',
          'Add checksums to input files',
        ],
        priority: 'high',
      },
    ];
  }

  const improvements: ScoreImprovement[] = [];

  // Parameters documented
  if (score.parameters_documented < 20) {
    improvements.push({
      component: 'parameters_documented',
      current_score: score.parameters_documented,
      max_score: 20,
      suggestions: [
        'Ensure all analysis parameters are set and saved',
        'Review parameter settings for completeness',
        'Document any custom parameters used',
      ],
      priority: 'high',
    });
  }

  // Software versions
  if (score.software_versions_captured < 20) {
    improvements.push({
      component: 'software_versions_captured',
      current_score: score.software_versions_captured,
      max_score: 20,
      suggestions: [
        'Create a version snapshot by completing an analysis',
        'Software versions are automatically captured during runs',
        'Verify that version information is present in analysis details',
      ],
      priority: 'high',
    });
  }

  // Provenance tracking
  if (score.provenance_tracked < 20) {
    improvements.push({
      component: 'provenance_tracked',
      current_score: score.provenance_tracked,
      max_score: 20,
      suggestions: [
        'Complete the full analysis pipeline to generate provenance',
        'Provenance is automatically tracked during analysis',
        'Ensure all processing steps complete successfully',
      ],
      priority: 'medium',
    });
  }

  // Data checksums
  if (score.data_checksums_recorded < 15) {
    improvements.push({
      component: 'data_checksums_recorded',
      current_score: score.data_checksums_recorded,
      max_score: 15,
      suggestions: [
        'Upload input files through SplicR (checksums are automatic)',
        'Verify that all input files have been processed',
        'Re-upload any files with missing checksums',
      ],
      priority: 'medium',
    });
  }

  // Methods generated
  if (score.methods_generated < 10) {
    improvements.push({
      component: 'methods_generated',
      current_score: score.methods_generated,
      max_score: 10,
      suggestions: [
        'Generate methods section in the Reproducibility tab',
        'Review and edit the auto-generated methods text',
        'Add missing details like sequencing platform and repository',
      ],
      priority: 'medium',
    });
  }

  // Package exported
  if (score.package_exported < 10) {
    improvements.push({
      component: 'package_exported',
      current_score: score.package_exported,
      max_score: 10,
      suggestions: [
        'Export a reproducibility package in the Reproducibility tab',
        'Choose ZIP format for easy sharing',
        'Include all input files and results',
      ],
      priority: 'low',
    });
  }

  // Published with DOI
  if (score.published_with_doi < 5) {
    improvements.push({
      component: 'published_with_doi',
      current_score: score.published_with_doi,
      max_score: 5,
      suggestions: [
        'Publish your reproducibility package to Zenodo',
        'Obtain a DOI for long-term archival',
        'Share the DOI in your publication',
      ],
      priority: 'low',
    });
  }

  return improvements.sort((a, b) => {
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}

/**
 * Get next badge the user can achieve
 */
export async function getNextBadge(
  analysis_id: string
): Promise<{ current: BadgeInfo | null; next: BadgeInfo | null; points_needed: number }> {
  const score = await getReproducibilityScore(analysis_id);
  const allBadges = getAllBadgeInfo().sort((a, b) => a.min_score - b.min_score);

  if (!score) {
    return {
      current: null,
      next: allBadges[0],
      points_needed: allBadges[0].min_score,
    };
  }

  const currentBadge = score.badge ? getBadgeInfo(score.badge) : null;
  const nextBadge = allBadges.find((b) => b.min_score > score.total_score) || null;

  return {
    current: currentBadge,
    next: nextBadge,
    points_needed: nextBadge ? nextBadge.min_score - score.total_score : 0,
  };
}

// =============================================================================
// LEADERBOARD (for lab/institution-wide comparisons)
// =============================================================================

/**
 * Get top reproducibility scores for a lab
 */
export async function getLabLeaderboard(
  lab_id: string,
  limit: number = 10
): Promise<Array<{ analysis: any; score: ReproducibilityScore }>> {
  const supabase = await createClient();

  // Get lab members
  const { data: members } = await (supabase as any)
    .from('lab_members')
    .select('user_id')
    .eq('lab_id', lab_id);

  if (!members || members.length === 0) {
    return [];
  }

  const userIds = members.map((m: { user_id: string }) => m.user_id);

  // Get top scores for lab members
  const { data: scores } = await (supabase as any)
    .from('reproducibility_scores')
    .select('*, analyses!inner(id, name, user_id, created_at)')
    .in('analyses.user_id', userIds)
    .order('total_score', { ascending: false })
    .limit(limit);

  if (!scores) {
    return [];
  }

  return scores.map((s: any) => ({
    analysis: s.analyses,
    score: s as ReproducibilityScore,
  }));
}

/**
 * Get reproducibility statistics for a user
 */
export async function getUserReproducibilityStats(user_id: string): Promise<{
  total_analyses: number;
  average_score: number;
  highest_score: number;
  badges_earned: Record<ReproducibilityBadge, number>;
  total_packages_exported: number;
  total_published: number;
}> {
  const supabase = await createClient();

  // Get all analyses for user
  const { data: analyses } = await (supabase as any)
    .from('analyses')
    .select('id')
    .eq('user_id', user_id);

  if (!analyses || analyses.length === 0) {
    return {
      total_analyses: 0,
      average_score: 0,
      highest_score: 0,
      badges_earned: { platinum: 0, gold: 0, silver: 0, bronze: 0 },
      total_packages_exported: 0,
      total_published: 0,
    };
  }

  const analysisIds = analyses.map((a: { id: string }) => a.id);

  // Get scores
  const { data: scores } = await (supabase as any)
    .from('reproducibility_scores')
    .select('*')
    .in('analysis_id', analysisIds);

  // Get packages
  const { data: packages } = await (supabase as any)
    .from('reproducibility_packages')
    .select('doi')
    .in('analysis_id', analysisIds);

  const badges_earned: Record<ReproducibilityBadge, number> = {
    platinum: 0,
    gold: 0,
    silver: 0,
    bronze: 0,
  };

  let totalScore = 0;
  let highestScore = 0;

  scores?.forEach((score: any) => {
    totalScore += score.total_score;
    highestScore = Math.max(highestScore, score.total_score);

    if (score.badge) {
      badges_earned[score.badge as ReproducibilityBadge]++;
    }
  });

  const total_published = packages?.filter((p: { doi?: string | null }) => p.doi !== null).length || 0;

  return {
    total_analyses: analyses.length,
    average_score: scores && scores.length > 0 ? totalScore / scores.length : 0,
    highest_score: highestScore,
    badges_earned,
    total_packages_exported: packages?.length || 0,
    total_published,
  };
}
