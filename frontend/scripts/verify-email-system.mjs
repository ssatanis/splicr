#!/usr/bin/env node

/**
 * Email Notification System - Verification Script
 * 
 * Run this to verify the email system is properly set up
 * Usage: node scripts/verify-email-system.mjs
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log('🔍 Verifying Email Notification System...\n');

let passed = 0;
let failed = 0;

function check(name, condition, errorMsg = '') {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    if (errorMsg) console.log(`   → ${errorMsg}`);
    failed++;
  }
}

// Check files exist
console.log('📁 Checking Files...');
check(
  'Email types',
  existsSync(join(projectRoot, 'lib/email/types.ts')),
  'Missing: lib/email/types.ts'
);
check(
  'Email service',
  existsSync(join(projectRoot, 'lib/email/service.ts')),
  'Missing: lib/email/service.ts'
);
check(
  'Email template',
  existsSync(join(projectRoot, 'lib/email/templates/analysis-complete.tsx')),
  'Missing: lib/email/templates/analysis-complete.tsx'
);
check(
  'Send completion API',
  existsSync(join(projectRoot, 'app/api/notifications/send-completion/route.ts')),
  'Missing: app/api/notifications/send-completion/route.ts'
);
check(
  'Test API',
  existsSync(join(projectRoot, 'app/api/notifications/test/route.ts')),
  'Missing: app/api/notifications/test/route.ts'
);
check(
  'Settings UI',
  existsSync(join(projectRoot, 'components/settings/notification-settings.tsx')),
  'Missing: components/settings/notification-settings.tsx'
);
check(
  'Email preview',
  existsSync(join(projectRoot, 'emails/preview.tsx')),
  'Missing: emails/preview.tsx'
);
check(
  'Database migration',
  existsSync(join(projectRoot, '../supabase/migrations/20260203000000_email_notifications.sql')),
  'Missing: supabase/migrations/20260203000000_email_notifications.sql'
);

console.log('\n📦 Checking Dependencies...');
try {
  const packageJson = await import(join(projectRoot, 'package.json'), {
    assert: { type: 'json' }
  });
  const deps = packageJson.default.dependencies || {};
  
  check('resend', deps.resend !== undefined, 'Run: npm install resend');
  check('@react-email/components', deps['@react-email/components'] !== undefined, 'Run: npm install @react-email/components');
  check('@react-email/render', deps['@react-email/render'] !== undefined, 'Run: npm install @react-email/render');
} catch (err) {
  console.log(`❌ Failed to read package.json: ${err.message}`);
  failed += 3;
}

console.log('\n⚙️  Checking Environment...');
check(
  'RESEND_API_KEY',
  process.env.RESEND_API_KEY !== undefined,
  'Add RESEND_API_KEY to .env.local'
);
check(
  'NEXT_PUBLIC_APP_URL',
  process.env.NEXT_PUBLIC_APP_URL !== undefined,
  'Add NEXT_PUBLIC_APP_URL to .env.local (optional for local dev)'
);

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

if (failed === 0) {
  console.log('🎉 All checks passed! Email system is ready.');
  console.log('\n📝 Next steps:');
  console.log('   1. Apply database migration in Supabase Dashboard');
  console.log('   2. Verify domain in Resend Dashboard');
  console.log('   3. Test with: curl -X POST http://localhost:3000/api/notifications/test \\');
  console.log('      -H "Content-Type: application/json" \\');
  console.log('      -d \'{"email":"your@email.com"}\'');
  console.log('   4. Integrate into your analysis workflow\n');
} else {
  console.log('⚠️  Some checks failed. Please fix the issues above.\n');
  process.exit(1);
}
