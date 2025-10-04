/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },

  // Experimental features for better performance with large files
  experimental: {
    serverComponentsExternalPackages: [],
  },

  // Increase timeouts for long-running downloads
  serverRuntimeConfig: {
    maxDuration: 300, // 5 minutes for API routes
  },

  // Configure webpack for better handling of large files
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Increase Node.js memory limit for server-side processing
      config.performance = {
        ...config.performance,
        maxAssetSize: 100 * 1024 * 1024, // 100MB
        maxEntrypointSize: 100 * 1024 * 1024, // 100MB
      };
    }
    return config;
  },
};

module.exports = nextConfig;
