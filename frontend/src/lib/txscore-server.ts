
import { TxScoreClient } from '../../../sdk/typescript/txscore-client';

// Singleton instance for server-side usage
// This uses the Service Role key to bypass RLS for public data
// For user-specific operations, we should use the user's session client (not this one)

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL');
}

export const txScoreClient = new TxScoreClient(supabaseUrl, supabaseServiceKey);
