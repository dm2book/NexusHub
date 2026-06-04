/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@memeforge/shared'],
  // The embedded Express API (mounted at /api/v1 via a Route Handler) pulls in
  // Node-only packages; keep them external so Next doesn't try to bundle them.
  experimental: {
    serverComponentsExternalPackages: [
      '@memeforge/api',
      '@prisma/client',
      '.prisma/client',
      'prisma',
      'bcryptjs',
      'jsonwebtoken',
      'nodemailer',
      'web-push',
      'ws',
      'discord.js',
      'node-cron',
      'pino',
      'pino-pretty',
      'express',
    ],
  },
  webpack: (config) => {
    // The shared package uses ESM ".js" import specifiers that point at ".ts"
    // sources; let webpack resolve them when transpiling the workspace package.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
    ];
  },
};

export default nextConfig;
