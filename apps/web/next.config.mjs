/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ninesixteen/brand"],
  experimental: {
    optimizePackageImports: ["firebase"],
  },
};

export default nextConfig;
