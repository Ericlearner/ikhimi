'use client'
import { useEffect } from 'react'
import { pushToken } from '@/lib/ios-app'

/**
 * Signed in, in the iOS app: this iPhone gets the account's notifications. The app asks for permission the first
 * time; afterwards it just hands over the token, which is re-sent on each visit (it moves to whoever signed in last).
 */
export function IosAppPush() {
  useEffect(() => {
    let done = false
    void pushToken().then((device) => {
      if (!device || done) return
      void fetch('/api/push', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(device) }).catch(() => {})
    })
    return () => {
      done = true
    }
  }, [])
  return null
}
