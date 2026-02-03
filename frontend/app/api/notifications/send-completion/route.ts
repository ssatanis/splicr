import { NextRequest, NextResponse } from 'next/server';
import { sendAnalysisCompleteEmail } from '@/lib/email/service';
import { createClient } from '@/lib/supabase/server';

/**
 * API endpoint to send analysis completion email
 * Called by the analysis engine or workflow when analysis completes
 */
export async function POST(request: NextRequest) {
  try {
    const { analysisId, userId } = await request.json();

    if (!analysisId) {
      return NextResponse.json(
        { error: 'Missing analysisId' },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // Get analysis details
    const { data: analysis, error: analysisError } = await supabase
      .from('analyses')
      .select('*')
      .eq('id', analysisId)
      .single();

    if (analysisError || !analysis) {
      console.error('Analysis not found:', analysisError);
      return NextResponse.json(
        { error: 'Analysis not found' },
        { status: 404 }
      );
    }

    // Get user details
    const { data: userData, error: userError } = await supabase
      .from('profiles')
      .select('email, full_name')
      .eq('id', (analysis as any).user_id || userId)
      .single();

    if (userError || !userData) {
      console.error('User not found:', userError);
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Check notification preferences
    const { data: preferences } = await supabase
      .from('user_settings')
      .select('email_on_analysis_complete')
      .eq('user_id', (analysis as any).user_id || userId)
      .single();

    // If user has disabled email notifications, skip
    if (preferences && (preferences as any).email_on_analysis_complete === false) {
      console.log('⏭️  User has disabled email notifications, skipping');
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'User disabled email notifications',
      });
    }

    // Calculate duration
    const duration = calculateDuration(
      (analysis as any).created_at,
      (analysis as any).updated_at || new Date().toISOString()
    );

    // Extract key results
    const results = (analysis as any).results || {};
    const significantHits = results.significant_hits || results.hit_count || 0;
    const topGene = results.top_gene || results.top_hit || 'N/A';
    const enrichmentScore = results.enrichment_score || results.max_score || 0;

    // Send email
    const emailResult = await sendAnalysisCompleteEmail({
      userName: (userData as any).full_name || 'Researcher',
      userEmail: (userData as any).email,
      screenName: (analysis as any).name || (analysis as any).screen_name || 'Untitled Screen',
      completedAt: new Date((analysis as any).updated_at || (analysis as any).created_at).toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
      duration,
      significantHits,
      topGene,
      enrichmentScore,
      resultsUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://splicr.io'}/analysis/${analysisId}`,
    });

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error },
        { status: 500 }
      );
    }

    // Log notification
    await (supabase.from('notifications') as any).insert({
      user_id: (analysis as any).user_id || userId,
      type: 'analysis_complete',
      title: 'Analysis Complete',
      message: `Your analysis "${(analysis as any).name}" has completed`,
      metadata: {
        analysis_id: analysisId,
        email_sent: true,
        message_id: emailResult.messageId,
      },
    });

    return NextResponse.json({
      success: true,
      messageId: emailResult.messageId,
    });
  } catch (error: any) {
    console.error('❌ Error in send-completion API:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Calculate human-readable duration
 */
function calculateDuration(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  } else if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } else {
    return `${seconds}s`;
  }
}
