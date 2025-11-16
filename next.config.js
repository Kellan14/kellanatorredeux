/** @type {import('next').NextConfig} */
const nextConfig = {
  // Force App Router only - no Pages Router
  // experimental: {
  //   typedRoutes: true,
  // },

  // Use standalone output to avoid build trace issues
  output: 'standalone',

  // Suppress Pages Router file generation
  poweredByHeader: false,

  // Optimize for production
  reactStrictMode: true,
  swcMinify: true,

  // Handle images if needed
  images: {
    domains: [],
    unoptimized: true, // Set to false if you want Next.js image optimization
  },

  // Ignore TypeScript errors during build (remove if you want strict checking)
  typescript: {
    ignoreBuildErrors: false,
  },

  // Ignore ESLint during build (remove if you want linting)
  eslint: {
    ignoreDuringBuilds: false,
  },
}

module.exports = nextConfig
