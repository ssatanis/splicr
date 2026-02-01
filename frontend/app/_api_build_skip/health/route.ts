import { NextResponse } from 'next/server'

/**
 * Health check endpoint for monitoring
 * No authentication required
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'SplicR API',
    version: '1.0.0',
  })
}
