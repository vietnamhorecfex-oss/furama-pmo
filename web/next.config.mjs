/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // shared/ is a workspace package compiled on the fly
  transpilePackages: ['@furama/shared'],
  experimental: { instrumentationHook: false },
};
export default nextConfig;
