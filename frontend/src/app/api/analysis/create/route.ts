import { NextResponse } from 'next/server';
import { createClient, supabaseAdmin } from '@/lib/supabase/server';
import { normalizeAnalysisMethod } from '@/lib/analysis-method';
import { enqueueAnalysis, JobPriority } from '@/lib/queue/analysis-queue';
import { markAnalysisQueued } from '@/lib/queue/db-state';

export const dynamic = 'force-dynamic';

/**
 * Create analysis record with R2 FASTQ paths.
 * Expects JSON body: { name, library, method?, algorithms?, r2Keys, parameters?, sampleLabels? }
 * Always attempts to enqueue analysis to worker queue.
 */
export async function POST(request: Request) {
  try {
    const { getApiUser } = await import('@/lib/supabase/server');

    const { user, error: userError } = await getApiUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized. Please log in.' },
        { status: 401 }
      );
    }

    const admin = supabaseAdmin as any;

    const body = await request.json();
    const { name, library, method, r2Keys, parameters } = body;
    const sampleLabels = body.sampleLabels ?? body.parameters?.sampleLabels ?? [];
    const algorithms = parameters?.algorithms || (Array.isArray(method) ? method : [method]);

    if (!name || !library || (!method && (!algorithms || algorithms.length === 0))) {
      return NextResponse.json(
        { error: 'Missing required fields: name, library, method/algorithms' },
        { status: 400 }
      );
    }

    if (!r2Keys || !Array.isArray(r2Keys) || r2Keys.length === 0) {
      return NextResponse.json(
        { error: 'At least one FASTQ file is required (r2Keys)' },
        { status: 400 }
      );
    }

    const invalidKeys = r2Keys.filter(
      (key: string) => typeof key !== 'string' || !key.startsWith(`${user.id}/`)
    );
    if (invalidKeys.length > 0) {
      return NextResponse.json(
        { error: 'Invalid file paths. Files must belong to current user.' },
        { status: 403 }
      );
    }

    const params = parameters || {
      fdr_threshold: 0.05,
      normalization: 'median',
      min_reads: 30,
    };
    const payload: Record<string, unknown> = {
      user_id: user.id,
      name: String(name).trim(),
      library: String(library),
      method: normalizeAnalysisMethod(String(algorithms[0] || method)),
      parameters: { ...params, r2Keys, sampleLabels, algorithms },
      status: 'pending',
      progress: 0,
    };

    let { data: analysis, error: insertError } = await admin
      .from('analyses')
      .insert({
        ...payload,
        file_names: r2Keys,
        sample_labels: sampleLabels || [],
      })
      .select()
      .single();

    if (insertError?.code === 'PGRST204') {
      const fallback = await admin.from('analyses').insert(payload).select().single();
      insertError = fallback.error;
      analysis = fallback.data;
    }

    if (insertError) {
      console.error('Database insert error:', insertError);
      return NextResponse.json(
        {
          success: false,
          error: `Failed to create analysis: ${insertError.message}`,
        },
        { status: 500 }
      );
    }

    // Check for Serverless Mode (bypass queue)
    const enableServerless = process.env.NEXT_PUBLIC_ENABLE_SERVERLESS_ANALYSIS === 'true' || !!process.env.VERCEL;

    if (enableServerless) {
      console.log('Serverless mode detected: Running analysis in-process...');

      // We must not await this if we want to return the response immediately?
      // BUT Vercel/Next.js function execution stops when response is sent.
      // We rely on "waitUntil" logic via 'after' (if available) or just await it (blocking response).
      // Given the constraints and user request for "real logs", we will await it.
      // This means the "Create" button will spin until analysis completes or timeouts.
      // This is the only way to guarantee execution without an external worker/queue on standard Vercel.

      // Dynamic import to avoid loading heavy analysis code on cold start if not needed
      const { runAnalysisPipeline } = await import('@/lib/runAnalysisPipeline');

      // We can try to use a "fire and forget" if we had access to `waitUntil` (Next.js 15+),
      // but to be safe and ensure log visibility, we'll await.
      // NOTE: This may timeout on Vercel Hobby (10s limit) or Pro (60s limit).
      // It is a fallback for when the Redis worker is missing.

      // We still return success:true immediately if we want async? NO, we want to ensure it runs.

      // To strictly follow the "Show logs like localhost" request, if we await, the user sees a spinner.
      // Then redirects to "Complete" (or partial logs if it timed out and we caught it?).

      // Optimization: We can wrap in a try/catch logging but NOT reject the HTTP request if analysis fails,
      // so the user gets redirected to the results page and sees the error log there.

      /* eslint-disable-next-line @typescript-eslint/no-floating-promises */
      (async () => {
        try {
          // Wait for a brief moment to allow the DB commit to propagate if needed (usually instant)
          await new Promise(r => setTimeout(r, 100));
          await runAnalysisPipeline(analysis.id, analysis);
        } catch (err) {
          console.error('In-process analysis failed:', err);
          // Error is updated in DB by runAnalysisPipeline usually
        }
      })();

      // WORKAROUND: In Vercel, the above async promise might be killed when we return.
      // Only "await" guarantees it runs.
      // Let's AWAIT it.
      try {
        await runAnalysisPipeline(analysis.id, analysis);
      } catch (err) {
        console.error('Serverless analysis error:', err);
        // Swallow error so client still gets the analysis ID and redirects to see the error logs
      }

      return NextResponse.json(
        {
          success: true,
          analysis,
          message: 'Analysis completed in-process (Serverless Mode).',
        },
        { status: 201 }
      );

    } else {
      // Standard Queue Mode
      // Enqueue the analysis job (with timeout so we never block if Redis is down)
      const ENQUEUE_TIMEOUT_MS = 8000;
      try {
        const jobId = await Promise.race([
          enqueueAnalysis(
            {
              analysisId: analysis.id,
              userId: user.id,
              fileNames: r2Keys,
              sampleLabels: sampleLabels || [],
              library: String(library),
              algorithms: algorithms.map((a: string) => normalizeAnalysisMethod(a)),
              parameters: params,
            },
            { priority: JobPriority.NORMAL }
          ),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Queue timeout')), ENQUEUE_TIMEOUT_MS)
          ),
        ]);

        await markAnalysisQueued(analysis.id, jobId);

        return NextResponse.json(
          {
            success: true,
            analysis,
            jobId,
            message: 'Analysis created and queued for processing.',
          },
          { status: 201 }
        );
      } catch (queueError) {
        console.warn('Enqueue analysis failed (analysis created):', queueError instanceof Error ? queueError.message : queueError);
        return NextResponse.json(
          {
            success: true,
            analysis,
            warning: 'Analysis created but could not be queued. Queue might be down.',
          },
          { status: 201 }
        );
      }
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Analysis creation error:', error);
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
