const path = require('path');

// Check if we're building for Electron (static export)
const isElectronBuild = process.env.ELECTRON_BUILD === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Use frontend as root for file tracing (required when building from monorepo root)
  outputFileTracingRoot: path.join(__dirname, '../'),
  // Use consistent build ID for Electron builds to avoid path issues
  generateBuildId: isElectronBuild ? async () => 'electron-build' : undefined,
  // Conditional static export for Electron builds
  output: isElectronBuild ? 'export' : undefined,
  // Disable image optimization for static export
  images: isElectronBuild ? {
    unoptimized: true,
  } : {
    remotePatterns: [
      { protocol: 'https', hostname: 'ui-avatars.com', pathname: '/**' },
    ],
  },
  outputFileTracingIncludes: {
    '/api/**/*': ['./data/libraries/**/*'],
  },
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  transpilePackages: ['@splicr/txscore-sdk'],
  webpack: (config) => {
    // react-plotly.js expects 'plotly.js/dist/plotly'; we use plotly.js-dist-min
    config.resolve.alias['plotly.js/dist/plotly'] = path.resolve(
      __dirname,
      'node_modules/plotly.js-dist-min/plotly.min.js'
    );
    // Add alias for @sdk to resolve to ../sdk/typescript
    config.resolve.alias['@sdk'] = path.resolve(__dirname, '../sdk/typescript');
    // Force resolution of @supabase/supabase-js to the frontend's installed version
    config.resolve.alias['@supabase/supabase-js'] = path.resolve(
      __dirname,
      'node_modules/@supabase/supabase-js'
    );
    return config;
  },
  turbopack: {
    // Use package name so Turbopack resolves via node_modules (avoids server-relative path error)
    resolveAlias: {
      'plotly.js/dist/plotly': 'plotly.js-dist-min',
      '@sdk': path.resolve(__dirname, '../sdk/typescript'),
      '@supabase/supabase-js': './node_modules/@supabase/supabase-js',
    },
  },
  // Redirects only work in non-static builds
  async redirects() {
    if (isElectronBuild) {
      return [];
    }
    return [
      {
        source: '/favicon.ico',
        destination: '/faviconslicr.png',
        permanent: false,
      },
      {
        source: '/',
        destination: '/dashboard',
        permanent: false,
      },
      { source: '/login', destination: '/auth/sign-in', permanent: true },
      { source: '/register', destination: '/auth/sign-up', permanent: true },
      { source: '/app', destination: '/upload', permanent: true },
      { source: '/app/dashboard', destination: '/dashboard', permanent: true },
      { source: '/app/analyses', destination: '/analyses', permanent: true },
      { source: '/app/reports', destination: '/reports', permanent: true },
      { source: '/app/settings', destination: '/settings', permanent: true },
      { source: '/app/results/:id', destination: '/results/:id', permanent: true },
    ];
  },
};

module.exports = nextConfig;
