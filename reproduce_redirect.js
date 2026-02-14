
const RESET_REDIRECT_PATH = '/auth/callback?next=/auth/reset-password';

function getResetRedirectUrl(mockEnvUrl, mockHost) {
    let base = mockEnvUrl || '';

    if (!base) {
        // Fallback for Vercel or local env
        const host = mockHost;
        const protocol = host && host.includes('localhost') ? 'http' : 'https';
        base = host ? `${protocol}://${host}` : 'https://splicr.org';
    }

    return base.replace(/\/$/, '') + RESET_REDIRECT_PATH;
}

console.log('Test 1 (Env Var Set):', getResetRedirectUrl('https://app.splicr.org', undefined));
console.log('Test 2 (Env Var Trailing Slash):', getResetRedirectUrl('https://app.splicr.org/', undefined));
console.log('Test 3 (No Env, Localhost):', getResetRedirectUrl(undefined, 'localhost:3000'));
console.log('Test 4 (No Env, Vercel URL):', getResetRedirectUrl(undefined, 'splicr-app.vercel.app'));
console.log('Test 5 (No Env, No Host):', getResetRedirectUrl(undefined, undefined));
