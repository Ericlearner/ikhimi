import type { MetadataRoute } from 'next'

/** Installable PWA (§15): students get an "app" without the stores. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '익히미',
    short_name: '익히미',
    description: '숙제를 3분 만에 만들어요',
    start_url: '/app',
    display: 'standalone',
    background_color: '#1F2D3A',
    theme_color: '#2C3E50',
    lang: 'ko',
    // PNGs for Android and the app stores (scripts/app-icons.mjs), the SVG for browsers that take it
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/brand/app-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
