/**
 * Push notifications to the iOS app (APNs), next to the Telegram messages in notify.ts: new homework, due soon, a
 * teacher's reminder, a graded essay. A device is registered by the app after sign-in (api/push) and forgotten on
 * sign-out, account deletion, or when Apple says the token is gone. Tapping a notification opens its page in the app.
 */
import { connect, type ClientHttp2Session } from 'node:http2'
import { eq, inArray, pushDevices, type Db } from '@ikhimi/db'
import { appleConfig, signedToken, type AppleConfig } from './apple'

/** The device this app registered (api/push): signing out on it forgets the device (api/auth/signout) */
export const PUSH_COOKIE = 'tl_push'

export type PushMessage = { userId: string; body: string; url: string }
export type Pusher = { send(db: Db, messages: PushMessage[]): Promise<number> }

const HOST = { production: 'https://api.push.apple.com', sandbox: 'https://api.sandbox.push.apple.com' }

/** APNs wants the provider token renewed between 20 and 60 minutes */
let tokenCache: { at: number; token: string } | null = null
function providerToken(cfg: AppleConfig) {
  if (!tokenCache || Date.now() - tokenCache.at > 40 * 60_000) {
    tokenCache = { at: Date.now(), token: signedToken(cfg, { iss: cfg.teamId, iat: Math.floor(Date.now() / 1000) }) }
  }
  return tokenCache.token
}

function post(session: ClientHttp2Session, headers: Record<string, string>, body: string) {
  return new Promise<{ status: number; reason?: string }>((resolve) => {
    const req = session.request({ ':method': 'POST', ...headers })
    let status = 0
    let data = ''
    req.setTimeout(10_000, () => req.close())
    req.on('response', (h) => (status = Number(h[':status'] ?? 0)))
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      let reason: string | undefined
      try {
        reason = data ? (JSON.parse(data) as { reason?: string }).reason : undefined
      } catch {}
      resolve({ status, reason })
    })
    req.on('error', () => resolve({ status: 0 }))
    req.end(body)
  })
}

/** Which of these users have the app with notifications on */
export async function pushUserIds(db: Db, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set()
  const rows = await db.selectDistinct({ id: pushDevices.userId }).from(pushDevices).where(inArray(pushDevices.userId, userIds))
  return new Set(rows.map((r) => r.id))
}

/** The APNs sender, or null when the Apple key isn't set (nothing is sent then) */
export function pushSender(): Pusher | null {
  const cfg = appleConfig()
  if (!cfg) return null
  return {
    async send(db, messages) {
      if (!messages.length) return 0
      const devices = await db
        .select()
        .from(pushDevices)
        .where(inArray(pushDevices.userId, [...new Set(messages.map((m) => m.userId))]))
      const sessions = new Map<string, ClientHttp2Session>()
      const sessionFor = (env: 'sandbox' | 'production') => {
        let s = sessions.get(env)
        if (!s) {
          s = connect(HOST[env])
          s.on('error', (e) => console.warn('[push] connection', String(e).slice(0, 200)))
          sessions.set(env, s)
        }
        return s
      }
      let sent = 0
      try {
        for (const m of messages) {
          for (const d of devices.filter((x) => x.userId === m.userId)) {
            const payload = JSON.stringify({ aps: { alert: { title: "익히미", body: m.body }, sound: 'default' }, url: m.url })
            const res = await post(
              sessionFor(d.env),
              {
                ':path': `/3/device/${d.token}`,
                authorization: `bearer ${providerToken(cfg)}`,
                'apns-topic': cfg.bundleId,
                'apns-push-type': 'alert',
                'apns-priority': '10',
              },
              payload,
            )
            if (res.status === 200) sent++
            // The app was deleted or notifications were turned off for good: forget the device
            else if (res.status === 410 || res.reason === 'BadDeviceToken' || res.reason === 'Unregistered') {
              await db.delete(pushDevices).where(eq(pushDevices.token, d.token))
            } else console.warn('[push] not delivered', res.status, res.reason)
          }
        }
      } finally {
        for (const s of sessions.values()) s.close()
      }
      return sent
    },
  }
}
