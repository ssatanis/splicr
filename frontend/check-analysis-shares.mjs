#!/usr/bin/env node

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local
const envPath = new URL('.env.local', import.meta.url);
const envContent = readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    const [, key, value] = match;
    env[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
  }
});

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function checkSchema() {
  console.log('\n🔍 Checking analysis_shares schema...\n');

  const { data, error } = await supabase
    .from('analysis_shares')
    .select('*')
    .limit(1);

  if (error) {
    console.log('   ❌ Error:', error.message);
  } else {
    console.log('   ✅ Table exists');
    console.log('   📋 Sample row:', data[0] || '(no data yet)');
  }

  console.log();
}

checkSchema().catch(console.error);
