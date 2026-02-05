'use client';

/**
 * One-time probe: if collaboration tables (e.g. analysis_presence) return 500/404,
 * we disable all collaboration Supabase calls for this session so the console
 * stays clean and we don't spam the server.
 */
let cached: boolean | null = null;
let probePromise: Promise<boolean> | null = null;

export function isCollaborationAvailable(): boolean | null {
  return cached;
}

export function getCollaborationAvailable(): Promise<boolean> {
  if (cached === true) return Promise.resolve(true);
  if (cached === false) return Promise.resolve(false);
  if (probePromise) return probePromise;

  probePromise = (async () => {
    try {
      const { createClient } = await import('@/lib/supabase/client');
      const supabase = createClient();
      const { error } = await supabase
        .from('analysis_presence')
        .select('id')
        .limit(1)
        .maybeSingle();

      // PGRST116 = no rows (table exists, empty) - that's ok
      if (error && error.code !== 'PGRST116') {
        cached = false;
        return false;
      }
      cached = true;
      return true;
    } catch {
      cached = false;
      return false;
    }
  })();

  return probePromise;
}
