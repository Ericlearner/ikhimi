import type { NextConfig } from 'next'

/** Files pdf.js reads from disk at run time, which the bundler's tracing can't see */
const PDFJS_FILES = [
  './node_modules/pdfjs-dist/package.json',
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  './node_modules/pdfjs-dist/standard_fonts/**',
  './node_modules/pdfjs-dist/cmaps/**',
  './node_modules/pdfjs-dist/wasm/**',
]

const config: NextConfig = {
  transpilePackages: ['@ikhimi/db', '@ikhimi/i18n', '@ikhimi/ai', '@ikhimi/ui'],
  // pdf.js and its canvas draw PDF pages for pictures (server/pdf-pages.ts): loaded from node_modules as they are
  serverExternalPackages: ['pg-boss', 'postgres', 'pdfjs-dist', '@napi-rs/canvas'],
  // …with the fonts, character maps and image decoders pdf.js reads from disk
  outputFileTracingIncludes: {
    '/api/generate': PDFJS_FILES,
  },
  poweredByHeader: false,
  // Android app verification (src/app/api/assetlinks)
  // The Android app download (/android): served as an app package, saved as a file
  async headers() {
    return [
      // Every page: HTTPS only, never inside another site's frame (clickjacking), no type sniffing, no full URLs to other sites
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(self)' },
        ],
      },
      {
        source: '/download/:file*.apk',
        headers: [
          { key: 'Content-Type', value: 'application/vnd.android.package-archive' },
          { key: 'Content-Disposition', value: 'attachment; filename="ikhimi.apk"' },
          { key: 'Cache-Control', value: 'public, max-age=300' },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      { source: '/.well-known/assetlinks.json', destination: '/api/assetlinks' },
      { source: '/.well-known/apple-app-site-association', destination: '/api/apple-app-site-association' },
    ]
  },
  // Standalone output for self-hosting (Docker image).
  output: 'standalone',
}

export default config
