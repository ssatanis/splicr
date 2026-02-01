module.exports = {
  // Enable environment variables in the renderer process
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Make environment variables available in the browser/Electron renderer
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },

  // Nextron renderer config
  rendererSrcDir: '.',

  // Main process entry
  mainSrcDir: 'main',

  // Build configuration
  build: {
    // Set environment variable for static export
    env: {
      ELECTRON_BUILD: 'true',
    },
  },
};
