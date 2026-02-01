const path = require('path');

// Check if we're building for Electron (static export)
const isElectronBuild = process.env.ELECTRON_BUILD === 'true';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Use frontend as root for file tracing (required when building from monorepo root)
  outputFileTracingRoot: __dirname,
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
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  webpack: (config) => {
    // react-plotly.js expects 'plotly.js/dist/plotly'; we use plotly.js-dist-min
    config.resolve.alias['plotly.js/dist/plotly'] = path.resolve(
      __dirname,
      'node_modules/plotly.js-dist-min/plotly.min.js'
    );
    return config;
  },
  turbopack: {
    // Use package name so Turbopack resolves via node_modules (avoids server-relative path error)
    resolveAlias: {
      'plotly.js/dist/plotly': 'plotly.js-dist-min',
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
