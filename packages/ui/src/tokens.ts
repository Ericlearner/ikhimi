/**
 * Brand values for places CSS can't reach (theme-color meta, native icons, manifest).
 * The UI itself uses tokens.css; keep these in sync with it.
 */
export const brand = {
  navy: '#2C3E50',
  navyDeep: '#1F2D3A',
  orange: '#FAA261',
  orangeSoft: '#FAC068',
  /** Daylight paper (--paper-100) and lamplight (dark --paper-100) — browser chrome colours */
  paper100: '#FAF7F2',
  lamplight: '#1A242E',
} as const

/** App icon tile: orange mark on navy, corner radius 22% of the tile (§4). */
export const appIcon = { field: brand.navy, mark: brand.orange, cornerRadiusRatio: 0.22 } as const
