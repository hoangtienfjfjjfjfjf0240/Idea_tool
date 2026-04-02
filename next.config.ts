import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow larger file uploads (videos up to 50MB)
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
