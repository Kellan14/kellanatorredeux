/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    domains: ['localhost'],
    formats: ['image/avif', 'image/webp'],
  },
  experimental: {
    outputFileTracingIgnores: ['mnp-data-archive/**/*'],
  },
}

module.exports = nextConfig
