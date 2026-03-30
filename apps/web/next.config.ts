import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  transpilePackages: ['@boilerplate/ui', '@boilerplate/auth', '@boilerplate/billing'],
}

export default nextConfig
