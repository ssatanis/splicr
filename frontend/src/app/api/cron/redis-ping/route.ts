/**
 * Cron: Redis ping via Upstash REST API
 *
 * Runs periodically (e.g. every 5 min) to generate activity in Upstash Monitor.
 * Uses @upstash/redis REST client — serverless-friendly, no persistent TCP.
 *
 * Requires: UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN (Vercel env)
 * Optional: CRON_SECRET for auth (Vercel sets Authorization: Bearer <CRON_SECRET>)
 */

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

export async function GET(request: NextRequest) {
  // Require CRON_SECRET when set (Vercel cron sends Authorization: Bearer <CRON_SECRET>)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const restUrl = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const restToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (!restUrl || !restToken) {
    return NextResponse.json(
      { ok: false, error: 'UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required' },
      { status: 500 }
    );
  }

  try {
    const redis = new Redis({ url: restUrl, token: restToken });
    const pong = await redis.ping();
    return NextResponse.json({
      ok: true,
      redis: pong,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Redis ping failed:', msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
