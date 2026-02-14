import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Optimized configuration for faster builds */
  
  // Disable source maps in production to reduce build time
  productionBrowserSourceMaps: false,
  
  // Enable experimental optimizations for package imports
  experimental: {
    optimizePackageImports: ["ag-grid-react", "ag-grid-community"],
  },
  
  // Security headers for HTTPS enforcement and mixed content prevention
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Enforce HTTPS
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          },
          // Prevent mixed content (HTTP resources in HTTPS page)
          // Allow internal backend API on HTTP for development/internal networks
          {
            key: 'Content-Security-Policy',
            value: 'upgrade-insecure-requests; default-src https: data: blob: wss:; script-src https: \'unsafe-inline\' \'unsafe-eval\'; style-src https: \'unsafe-inline\'; img-src https: data:; font-src https: data:; connect-src https: wss: https://172.31.39.68:*; frame-ancestors \'self\';'
          },
          // Block page from being embedded
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          // Enable XSS protection
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          // Referrer policy
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          // Permissions policy
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=()'
          }
        ]
      }
    ];
  },

  // Redirect HTTP to HTTPS in production
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [
          {
            type: 'header',
            key: 'x-forwarded-proto',
            value: 'http'
          }
        ],
        permanent: true,
        destination: 'https://:host/:path*'
      }
    ];
  }
};

export default nextConfig;
