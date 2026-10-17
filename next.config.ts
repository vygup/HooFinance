import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  // Browser tests must not replace the running developer server's build/cache.
  distDir: process.env.FINANCE_E2E === 'true' ? 'build/e2e-next' : '.next',
  poweredByHeader: false,
  // Request URLs and Server Action arguments can contain auth secrets in dev.
  logging: { incomingRequests: false, serverFunctions: false },
};
export default nextConfig;
