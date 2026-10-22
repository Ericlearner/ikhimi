/**
 * Phone + password sign-in. The number is proved once (Telegram or a code); then the person sets a password in Profile
 * and can sign in with it. Hashed with scrypt (salted, slow); 5 wrong tries per number and 20 per IP in 15 minutes,
 * then a pause. Setting a password ends the account's other sessions. A forgotten password: sign in the usual way and
 * set a new one.
 */
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { and, eq, gt, lt, ne, passwordFailures, sessions, sql, users, type Db } from '@ikhimi/db'
import { hashWithPepper } from './otp'

export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128
const MAX_FAILS_PER_PHONE = 5
const MAX_FAILS_PER_IP = 20
const WINDOW_MS = 15 * 60 * 1000
/** A session this young may set a new password without the old one (signing in again is how a forgotten one is reset) */
export const RESET_WINDOW_MS = 15 * 60 * 1000

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 32 }
const derive = (password: string, salt: Buffer, o: { N: number; r: number; p: number; keylen: number }) =>
  new Promise<Buffer>((resolve, reject) => {
    const opts: ScryptOptions = { N: o.N, r: o.r, p: o.p, maxmem: 256 * o.N * o.r }
    scrypt(password.normalize('NFKC'), salt, o.keylen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  })

/** `scrypt$N$r$p$salt$hash` (base64url), so the cost can be raised later without breaking old hashes */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, PARAMS)
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), key.toString('base64url')].join('$')
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$')
  if (kind !== 'scrypt' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64url')
  const got = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(n), r: Number(r), p: Number(p), keylen: want.length })
  return got.length === want.length && timingSafeEqual(got, want)
}

/** Spent on a number with no password, so the answer takes as long as a real check */
let dummyHash: Promise<string> | null = null

const COMMON = new Set([
  '12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'password', 'password1', 'qwertyui', 'qwerty123', '1q2w3e4r', 'parol123', 'parolparol', 'ikhimi123', 'iloveyou',
])

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'is_phone'

/** Long enough, not one of the first guesses, not the phone number */
export function passwordProblem(password: string, phone: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN) return 'too_short'
  if (password.length > PASSWORD_MAX) return 'too_long'
  const lower = password.toLowerCase()
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return 'too_common'
  const digits = phone.replace(/\D/g, '')
  if (/^\d+$/.test(password) && digits.endsWith(password.slice(-9))) return 'is_phone'
  return null
}

/**
 * After the number is proved with Telegram or a code (the first time, or a forgotten password): the sign-in page goes on
 * to setting a password, then one sign-in with it, which the device remembers. Not for the stores' review login.
 */
export function passwordStep(user: { phone: string; passwordHash: string | null }, opts: { review?: boolean } = {}) {
  if (opts.review || !/^\+\d+$/.test(user.phone)) return {}
  return { needsPassword: true, hasPassword: !!user.passwordHash, phone: user.phone }
}

export type PasswordSignIn =
  | { ok: true; user: typeof users.$inferSelect }
  | { ok: false; reason: 'invalid' | 'blocked' }
  | { ok: false; reason: 'rate_limited'; retryAfterSeconds: number }

export async function signInWithPassword(
  deps: { db: Db; pepper: string; now?: () => Date },
  input: { phone: string; password: string; ip: string | null },
): Promise<PasswordSignIn> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()
  const since = new Date(now.getTime() - WINDOW_MS)
  const ipHash = input.ip ? hashWithPepper(input.ip, deps.pepper) : null
  const count = async (where: ReturnType<typeof eq>) => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(passwordFailures).where(and(where, gt(passwordFailures.createdAt, since)))
    return row?.n ?? 0
  }
  if ((await count(eq(passwordFailures.phone, input.phone))) >= MAX_FAILS_PER_PHONE || (ipHash && (await count(eq(passwordFailures.ipHash, ipHash))) >= MAX_FAILS_PER_IP)) {
    return { ok: false, reason: 'rate_limited', retryAfterSeconds: WINDOW_MS / 1000 }
  }

  const [user] = await db.select().from(users).where(eq(users.phone, input.phone)).limit(1)
  const ok = user?.passwordHash
    ? await verifyPassword(user.passwordHash, input.password)
    : await verifyPassword(await (dummyHash ??= hashPassword(randomBytes(12).toString('hex'))), input.password).then(() => false)
  if (!ok || !user) {
    await db.insert(passwordFailures).values({ phone: input.phone, ipHash, createdAt: now })
    return { ok: false, reason: 'invalid' }
  }
  if (user.blockedAt) return { ok: false, reason: 'blocked' }
  await db.delete(passwordFailures).where(eq(passwordFailures.phone, input.phone))
  // Signing in within 30 days of deleting the account restores it (spec §12)
  if (user.deletedAt) {
    await db.update(users).set({ deletedAt: null }).where(eq(users.id, user.id))
    user.deletedAt = null
  }
  return { ok: true, user }
}

export type SetPassword = { ok: true } | { ok: false; reason: PasswordProblem | 'wrong_current' | 'current_required' | 'no_phone' }

/**
 * Profile: set or change the password. Changing one needs the current password, unless the session is new (the
 * person just signed in another way, which is how a forgotten password is replaced). Other sessions end.
 */
export async function setPassword(
  db: Db,
  session: { sessionId: string; createdAt: Date },
  input: { userId: string; password: string; current?: string },
  now = new Date(),
): Promise<SetPassword> {
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1)
  if (!user || !/^\+\d+$/.test(user.phone)) return { ok: false, reason: 'no_phone' }
  const problem = passwordProblem(input.password, user.phone)
  if (problem) return { ok: false, reason: problem }
  const fresh = now.getTime() - session.createdAt.getTime() < RESET_WINDOW_MS
  if (user.passwordHash && !fresh) {
    if (!input.current) return { ok: false, reason: 'current_required' }
    if (!(await verifyPassword(user.passwordHash, input.current))) return { ok: false, reason: 'wrong_current' }
  }
  await db.update(users).set({ passwordHash: await hashPassword(input.password), passwordSetAt: now }).where(eq(users.id, user.id))
  // Anyone else signed in to this account (an old phone, someone who knew the old password) is signed out
  await db.delete(sessions).where(and(eq(sessions.userId, user.id), ne(sessions.id, session.sessionId)))
  return { ok: true }
}

/** The daily job: failures older than a day no longer count for anything */
export async function prunePasswordFailures(db: Db, now = new Date()) {
  await db.delete(passwordFailures).where(lt(passwordFailures.createdAt, new Date(now.getTime() - 24 * 3600 * 1000)))
}
