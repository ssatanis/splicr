const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Use frontend as root for file tracing (avoids multiple lockfile warning)
  outputFileTracingRoot: __dirname,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  images: {
    domains: [],
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
        destination: '/app',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
