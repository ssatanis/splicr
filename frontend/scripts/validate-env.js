#!/usr/bin/env node

/**
 * Validates environment variables to catch common configuration errors
 * Run this before starting the dev server to catch issues early
 */

const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env.local');

function isValidJWT(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  // Check each part is valid base64url (no spaces, special chars except - and _)
  const base64urlPattern = /^[A-Za-z0-9_-]+$/;
  if (!parts.every(part => part.length > 0 && base64urlPattern.test(part))) {
    return false;
  }

  // Check signature doesn't start with sb_ (common copy-paste error)
  const signature = parts[2];
  if (signature.startsWith('sb_publishable_') || signature.startsWith('sb_secret_')) {
    return false;
  }

  // JWT signatures for HS256 should be at least 40 characters
  if (signature.length < 40) {
    return false;
  }

  return true;
}

function validateEnv() {
  console.log('🔍 Validating environment configuration...\n');

  if (!fs.existsSync(ENV_FILE)) {
    console.error('❌ .env.local file not found!');
    console.error('   Copy .env.example to .env.local and fill in your values\n');
    process.exit(1);
  }

  const envContent = fs.readFileSync(ENV_FILE, 'utf8');
  const lines = envContent.split('\n');
  const errors = [];
  const warnings = [];

  let supabaseUrl, anonKey, serviceKey, resendKey;

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    const trimmed = line.trim();

    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) return;

    const [key, ...valueParts] = trimmed.split('=');
    const value = valueParts.join('=').trim();

    // Store values for validation
    if (key === 'NEXT_PUBLIC_SUPABASE_URL') supabaseUrl = value;
    if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') anonKey = value;
    if (key === 'SUPABASE_SERVICE_ROLE_KEY') serviceKey = value;
    if (key === 'RESEND_API_KEY') resendKey = value;
  });

  // Validate Supabase URL
  if (!supabaseUrl) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL is missing');
  } else if (!supabaseUrl.startsWith('https://') || !supabaseUrl.includes('.supabase.co')) {
    errors.push('NEXT_PUBLIC_SUPABASE_URL should be a valid Supabase URL (https://xxx.supabase.co)');
  }

  // Validate Supabase Anon Key
  if (!anonKey) {
    errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing');
  } else if (!isValidJWT(anonKey)) {
    errors.push('NEXT_PUBLIC_SUPABASE_ANON_KEY is not a valid JWT token');
    errors.push('  → Get it from: Supabase Dashboard > Settings > API > anon/public key');
  }

  // Validate Supabase Service Role Key
  if (!serviceKey) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is missing');
  } else if (!isValidJWT(serviceKey)) {
    errors.push('SUPABASE_SERVICE_ROLE_KEY is not a valid JWT token');
    errors.push('  → Get it from: Supabase Dashboard > Settings > API > service_role key');
  }

  // Validate Resend API Key
  if (!resendKey) {
    warnings.push('RESEND_API_KEY is missing (email features will not work)');
  } else if (!resendKey.startsWith('re_')) {
    errors.push('RESEND_API_KEY should start with "re_"');
    errors.push('  → Get it from: https://resend.com/api-keys');
  }

  // Print results
  if (errors.length > 0) {
    console.log('❌ Environment validation failed:\n');
    errors.forEach(err => console.log(`   ${err}`));
    console.log('\n');
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.warn('⚠️  Warnings:\n');
    warnings.forEach(warn => console.warn(`   ${warn}`));
    console.warn('\n');
  }

  console.log('✅ Environment configuration is valid!\n');
}

validateEnv();
