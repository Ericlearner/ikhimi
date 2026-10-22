'use client'
import { useEffect } from 'react'

/** A file of an older deploy that no longer exists: the page was opened before a new version went live */
export const isStaleChunk = (e: unknown) => /ChunkLoadError|Loading chunk|Failed to load chunk|error loading dynamically imported module/i.test(String((e as { message?: string } | null)?.message ?? e))

/** Reload once to get the new version; never loop (a second failure within a minute shows the error) */
export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem('tl_chunk_reload') ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem('tl_chunk_reload', String(Date.now()))
  } catch {}
  location.reload()
  return true
}

export function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }
    const onError = (e: ErrorEvent | PromiseRejectionEvent) => {
      if (isStaleChunk('reason' in e ? e.reason : (e.error ?? e.message))) reloadForNewVersion()
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onError)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onError)
    }
  }, [])
  return null
}
