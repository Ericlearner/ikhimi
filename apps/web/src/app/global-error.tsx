'use client'
import { useEffect } from 'react'
import { isStaleChunk, reloadForNewVersion } from '@/components/RegisterSW'

/**
 * Last-resort screen when the whole app fails. After a deploy, a page opened earlier can ask for files the new
 * version no longer has: then it reloads once to get the new version instead of showing this.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isStaleChunk(error)
  useEffect(() => {
    if (stale) reloadForNewVersion()
  }, [stale])
  return (
    <html lang="ko">
      <body style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: 0, background: '#faf7f2', color: '#1f2430' }}>
        <div style={{ textAlign: 'center', padding: 24, maxWidth: 420 }}>
          <p style={{ fontSize: 20, fontWeight: 600, margin: '0 0 8px' }}>{stale ? '익히미가 업데이트됐어요' : '문제가 생겼어요'}</p>
          <p style={{ margin: '0 0 20px', color: '#5b6170' }}>{stale ? '페이지를 새로고침하세요.' : '다시 시도해 주세요.'}</p>
          <button
            onClick={() => (stale ? location.reload() : reset())}
            style={{ padding: '12px 20px', borderRadius: 10, border: 0, background: '#f08a24', color: '#1f2430', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}
          >
            {stale ? '새로고침' : '다시 시도'}
          </button>
        </div>
      </body>
    </html>
  )
}
