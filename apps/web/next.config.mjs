/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@kku/ui', '@kku/design', '@kku/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
