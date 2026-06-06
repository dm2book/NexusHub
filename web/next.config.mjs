/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Product covers are first-party SVGs in /public — serve them directly.
  images: { unoptimized: true, dangerouslyAllowSVG: true },
  // The premium frontend talks to the existing ForgeMarket API. Set
  // NEXT_PUBLIC_API_URL (e.g. https://your-api.vercel.app). When unset, the UI
  // falls back to bundled sample products so it always looks complete.
};

export default nextConfig;
