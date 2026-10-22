/**
 * Business defaults the founder has not decided yet. Every [DECIDE] in the build spec lives here,
 * so changing one is a one-line diff. See DECISIONS.md for the questions behind each value.
 */
export const CONFIG = {
  /** [DECIDE #8] Assignments a teacher may generate per day */
  generationDailyCapPerTeacher: 20,
  /** Book pages (photos + PDF pages) one generation may read. Was 6 on the free AI tier (DECISIONS.md AO). */
  maxMaterialPages: 12,
  /** Copying from a book: the answer pages the teacher adds beside them, read for the answers only (DECISIONS.md BM) */
  maxAnswerPages: 4,
  /** [DECIDE #9] Accept ≤1-char typos in gap-fill for words longer than this (null = off) */
  gapFillTypoToleranceMinWordLength: 4 as number | null,
  /** [DECIDE #4] Students see the class leaderboard by default */
  studentLeaderboardDefault: false,
  /** [DECIDE #10] Delete attempts this many months after a student's last activity */
  studentDataRetentionMonths: 24,
  /** [DECIDE #2] Under this age, guardianPhone is required at signup */
  guardianRequiredUnderAge: 14,
  /** [DECIDE #7] How course lessons are released in a run */
  courseLessonRelease: 'manual' as 'manual' | 'scheduled' | 'on_completion',
  /**
   * Student plans (what each includes: packages/ai/src/plans.ts). The prices are edited in Admin → Money and kept
   * in app_settings; these are the defaults until then (DECISIONS.md AZ). Type: Pricing in @ikhimi/ai.
   */
  pricing: {
    /** Per student per month, integer won */
    monthly: { pro: 9_900, vip: 14_900 } as { pro: number | null; vip: number | null },
    /** Percent off by months bought at once (the keys are the months on sale) */
    periodDiscount: { '1': 0, '3': 10, '6': 15, '12': 25 } as Record<string, number>,
    /** A teacher's package: this much more off */
    teacherDiscount: 10,
    /** A student's own purchase: this share goes to their teacher */
    teacherCommission: 10,
    /** Students who register until the end of this day (Seoul) get VIP for vipGiftDays, then Free until they pay */
    vipGiftUntil: '2026-12-31' as string | null,
    vipGiftDays: 7,
  },
  plans: {
    /** Most seats in one teacher package */
    maxSeats: 500,
  },
  /** Paid online courses (DECISIONS.md BL): the teacher's share of each sale, and the price range a teacher may set */
  courses: {
    teacherSharePercent: 60,
    minPriceKrw: 10_000,
    maxPriceKrw: 2_000_000,
  },
  /** The AI tutor (VIP): replies per wrong answer, the first explanation and 4 button presses (simpler, example, practice) */
  tutorNotesPerAnswer: 5,
  /** The teachers' help chat (DECISIONS.md BN): questions a day, conversations sent on to the team a day, rows kept */
  help: { questionsPerDay: 40, handoffsPerDay: 3, keepDays: 90 },
  /** [DECIDE #6] iOS: web-only subscriptions, Android first */
  iosInAppPurchase: false,
  /** [DECIDE #5] ASR for teacher lesson audio may use an external API; student speech never leaves */
  asr: { lessonAudio: 'external' as 'external' | 'self_hosted', studentSpeech: 'self_hosted' as const },
  /** [DECIDE #12] Public origin used in share links / QR codes */
  publicOrigin: process.env.PUBLIC_ORIGIN ?? 'https://ikhimi.kr',
} as const

/** Auth limits (§16) — security requirements, not business decisions. */
export const AUTH = {
  otpLength: 6,
  otpTtlSeconds: 5 * 60,
  otpMaxSendsPerPhone: 3,
  otpSendWindowSeconds: 15 * 60,
  otpResendCooldownSeconds: 60,
  otpMaxVerifyAttempts: 5,
  otpMaxSendsPerIp: 10,
  /** A device stays signed in: a year from the last renewal, renewed about monthly while it's used */
  sessionTtlDays: 365,
  sessionRefreshWhenDaysLeft: 335,
} as const

/** Upload limits (§16). */
export const UPLOAD_LIMITS = {
  image: { maxBytes: 15 * 1024 * 1024, mime: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] },
  audio: {
    maxBytes: 100 * 1024 * 1024,
    mime: ['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'],
  },
  pdf: { maxBytes: 50 * 1024 * 1024, mime: ['application/pdf'] },
  doc: {
    maxBytes: 20 * 1024 * 1024,
    mime: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
  },
} as const
export type UploadKind = keyof typeof UPLOAD_LIMITS

export function uploadKindForMime(mime: string): UploadKind | null {
  for (const [kind, spec] of Object.entries(UPLOAD_LIMITS) as [UploadKind, (typeof UPLOAD_LIMITS)[UploadKind]][]) {
    if ((spec.mime as readonly string[]).includes(mime)) return kind
  }
  return null
}
