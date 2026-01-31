const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Use frontend as root for file tracing (required when building from monorepo root)
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'ui-avatars.com', pathname: '/**' },
    ],
  },
  webpack: (config) => {
    // react-plotly.js expects 'plotly.js/dist/plotly'; we use plotly.js-dist-min
    config.resolve.alias['plotly.js/dist/plotly'] = path.resolve(
      __dirname,
      'node_modules/plotly.js-dist-min/plotly.min.js'
    );
    return config;
  },
  async redirects() {
    return [
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
