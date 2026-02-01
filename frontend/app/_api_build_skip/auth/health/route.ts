import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/client'

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Supabase environment variables are not configured',
          details: {
            hasUrl: !!supabaseUrl,
            hasKey: !!supabaseKey,
          },
        },
        { status: 500 }
      )
    }

    // Test connection by checking if we can reach Supabase
    const supabase = createClient()
    const { error } = await supabase.auth.getSession()

    if (error) {
      return NextResponse.json(
        {
          status: 'error',
          message: 'Failed to connect to Supabase',
          error: error.message,
          troubleshooting: 'Check SUPABASE_SETUP.md for configuration instructions',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      status: 'ok',
      message: 'Supabase connection is working',
      supabaseUrl,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        troubleshooting: 'Check SUPABASE_SETUP.md for configuration instructions',
      },
      { status: 500 }
    )
  }
}
