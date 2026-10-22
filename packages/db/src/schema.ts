/**
 * 익히미 data model (§7). All ids are ULIDs. Column names are snake_case in SQL
 * (drizzle `casing: 'snake_case'`), camelCase in TypeScript.
 *
 * Money is stored as integer KRW everywhere (never floats, never tiyin) — see DECISIONS.md.
 */
import { sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core'
import { newId } from './ids'

/** Embedding width for methodologyDocs. Must match the self-hosted embedding model (Phase 1). */
export const EMBEDDING_DIMENSIONS = 1024

// ─── helpers ────────────────────────────────────────────────────────────────

const id = () => text().primaryKey().$defaultFn(newId)
const ts = () => timestamp({ withTimezone: true, mode: 'date' })
const timestamps = {
  createdAt: ts().notNull().defaultNow(),
  updatedAt: ts()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}
const softDelete = { deletedAt: ts() }

// ─── enums ──────────────────────────────────────────────────────────────────

export const userRole = pgEnum('user_role', ['teacher', 'student', 'admin'])
export const uiLocale = pgEnum('ui_locale', ['ko'])
export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'invited', 'removed'])
export const materialKind = pgEnum('material_kind', ['image', 'audio', 'pdf', 'doc', 'link', 'text'])
export const processingStatus = pgEnum('processing_status', [
  'pending_upload',
  'uploaded',
  'processing',
  'ready',
  'failed',
])
export const pairingReason = pgEnum('pairing_reason', ['filename', 'ocr_label', 'manual', 'ai'])
export const conversationStatus = pgEnum('conversation_status', ['active', 'archived'])
export const messageRole = pgEnum('message_role', ['teacher', 'assistant', 'system'])
export const assignmentStatus = pgEnum('assignment_status', ['draft', 'published', 'closed'])
export const gradingMode = pgEnum('grading_mode', ['auto', 'ai', 'manual'])
export const attemptStatus = pgEnum('attempt_status', ['in_progress', 'submitted', 'graded'])
export const courseVisibility = pgEnum('course_visibility', ['private', 'unlisted', 'marketplace'])
/** 'test' simulates a provider end to end; never enabled in production unless PAYMENT_TEST_ENABLED=1 */
/** 'card': a bank transfer (계좌이체) to the owner's account, approved by hand in Telegram (server/payments/card.ts). Add a real
 * payment gateway (e.g. Toss Payments) here when one is connected. */
export const paymentProvider = pgEnum('payment_provider', ['test', 'card'])
export const subscriptionStatus = pgEnum('subscription_status', [
  'trial',
  'pending',
  'active',
  'grace',
  'expired',
  'cancelled',
])
export const paymentStatus = pgEnum('payment_status', ['created', 'pending', 'paid', 'cancelled', 'failed', 'refunded'])

// ─── identity ───────────────────────────────────────────────────────────────

/** Per-user settings (design spec §12); stored server-side so they follow the user across devices. */
export type UserPrefs = {
  theme?: 'system' | 'light' | 'dark'
  sound?: 'off' | 'quiet' | 'normal'
  /** Learners: UI SFX pack for homework sounds */
  soundPack?: 'arcade' | 'rubber' | 'glass' | 'soft' | 'organic' | 'zen'
  /** Teachers: the single opt-in cue for "homework is ready" (§8) */
  generationChime?: boolean
  motion?: 'system' | 'reduce' | 'full'
  textSize?: 'normal' | 'large' | 'larger'
  notifications?: Record<string, boolean>
}

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Primary role (first one the account had). Authorization uses the session's active role. */
    role: userRole().notNull(),
    /** All roles this phone holds — a teacher can also be a learner (§12 dual role) */
    roles: text().array().$type<('teacher' | 'student' | 'admin')[]>().notNull().default(sql`'{}'::text[]`),
    prefs: jsonb().$type<UserPrefs>().notNull().default({}),
    /** E.164, e.g. +821012345678 */
    phone: text().notNull(),
    phoneVerifiedAt: ts(),
    fullName: text(),
    uiLocale: uiLocale().notNull().default('ko'),
    avatarUrl: text(),
    telegramChatId: text(),
    /** scrypt hash (server/auth/password.ts); null = no password, sign in with Telegram, a code, Apple or Google */
    passwordHash: text(),
    passwordSetAt: ts(),
    lastActiveAt: ts(),
    /** Blocked by staff (admin panel): no sign-in, existing sessions end */
    blockedAt: ts(),
    blockedReason: text(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('users_phone_uq').on(t.phone)],
)

export type SignInMethod = 'otp' | 'telegram' | 'password' | 'apple' | 'google'

export const sessions = pgTable(
  'sessions',
  {
    /** sha256(token) hex — the raw token only ever lives in the cookie */
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: ts().notNull(),
    /** Active role for this session (dual-role accounts switch in the avatar menu) */
    activeRole: userRole(),
    /** How this session signed in; the admin panel refuses a Telegram-link one (phishable). Null: before 0019 */
    method: text().$type<SignInMethod>(),
    userAgent: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/** Wrong passwords, the rate-limit ledger for password sign-in (server/auth/password.ts). Pruned by the daily job. */
export const passwordFailures = pgTable(
  'password_failures',
  {
    id: id(),
    phone: text().notNull(),
    /** sha256(ip + pepper) */
    ipHash: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('password_failures_phone_idx').on(t.phone, t.createdAt), index('password_failures_ip_idx').on(t.ipHash, t.createdAt)],
)

/** One row per SMS sent. Doubles as the rate-limit ledger (§16). */
export const otpCodes = pgTable(
  'otp_codes',
  {
    id: id(),
    phone: text().notNull(),
    /** sha256(code + pepper) — never store the code itself */
    codeHash: text().notNull(),
    /** sha256(ip + pepper), for enumeration detection */
    ipHash: text(),
    expiresAt: ts().notNull(),
    attempts: smallint().notNull().default(0),
    consumedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('otp_phone_created_idx').on(t.phone, t.createdAt), index('otp_ip_created_idx').on(t.ipHash, t.createdAt)],
)

/**
 * "Log in with Telegram" (free bot flow). The browser holds a random token; the user opens
 * t.me/<bot>?start=<token>, shares their own contact, and the bot marks the row approved with the
 * Telegram-verified phone. The browser then exchanges the token for a session, exactly once.
 */
export const telegramLoginStatus = pgEnum('telegram_login_status', ['pending', 'approved', 'consumed'])
export const telegramLogins = pgTable(
  'telegram_logins',
  {
    id: id(),
    /** sha256(token) hex — the raw token lives only in the browser and the t.me link */
    tokenHash: text().notNull(),
    status: telegramLoginStatus().notNull().default('pending'),
    uiLocale: uiLocale().notNull().default('ko'),
    telegramChatId: text(),
    telegramUserId: text(),
    phone: text(),
    ipHash: text(),
    /** sha256 of the one-time sign-in link the bot sends once the number is shared (for a browser that was lost) */
    linkHash: text(),
    /** What the browser asked for, so the bot's link continues the same way: the role (a homework link: student) */
    asRole: text().$type<'teacher' | 'student'>(),
    /** …and the page to go to after signing in */
    next: text(),
    expiresAt: ts().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('telegram_logins_token_uq').on(t.tokenHash),
    uniqueIndex('telegram_logins_link_uq').on(t.linkHash),
    index('telegram_logins_chat_idx').on(t.telegramChatId, t.createdAt),
    index('telegram_logins_ip_idx').on(t.ipHash, t.createdAt),
  ],
)

/**
 * Sign in with Apple (the iOS app): which account an Apple ID opens. A new account's phone column is `apple:<Apple user
 * id>` until the person links Telegram (then their real number). The refresh token lets deleting the account revoke
 * Apple's link (App Store rule 5.1.1).
 */
export const appleAccounts = pgTable(
  'apple_accounts',
  {
    userId: text()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    sub: text().notNull(),
    refreshToken: text(),
    updatedAt: ts().notNull().defaultNow(),
  },
  // One Apple ID opens one account, also after it was linked to a Telegram number (server/auth/link.ts)
  (t) => [uniqueIndex('apple_accounts_sub_uq').on(t.sub)],
)

/**
 * Sign in with Google (the website): which account a Google account opens. A new account's phone column is
 * `google:<Google user id>` until the person links Telegram and the number joins it (server/auth/link.ts).
 */
export const googleAccounts = pgTable(
  'google_accounts',
  {
    userId: text()
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    sub: text().notNull(),
    email: text(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [uniqueIndex('google_accounts_sub_uq').on(t.sub)],
)

/** iPhones that get push notifications (APNs), one row per device token. Signing out on the device removes it. */
export const pushDevices = pgTable(
  'push_devices',
  {
    token: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'sandbox': a build run from Xcode; 'production': TestFlight and the App Store */
    env: text().$type<'sandbox' | 'production'>().notNull(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [index('push_devices_user_idx').on(t.userId)],
)

export const teacherProfiles = pgTable('teacher_profiles', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  schoolName: text(),
  subjects: text().array().notNull().default(sql`'{}'::text[]`),
  defaultContentLanguage: text(),
  defaultCefrLevel: text(),
  /** Prefill for the composer chips (§12 teaching defaults) */
  teachingDefaults: jsonb()
    .$type<{
      difficulty?: number
      minutes?: number
      showAnswersAfter?: 'submit' | 'never'
      strictness?: 'lenient' | 'standard' | 'strict'
      typoTolerance?: boolean
    }>()
    .notNull()
    .default({}),
  onboardedAt: ts(),
  /** Staff override of CONFIG.generationDailyCapPerTeacher; null = the default */
  dailyCap: integer(),
  /** Staff "reset today's limit": generations before this moment don't count toward the daily cap */
  capResetAt: ts(),
  ...timestamps,
})

export const studentProfiles = pgTable('student_profiles', {
  userId: text()
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  birthYear: smallint(),
  /** Required if under 14 — [DECIDE] #2, see DECISIONS.md */
  guardianPhone: text(),
  ...timestamps,
})

// ─── classes ────────────────────────────────────────────────────────────────

export const groups = pgTable(
  'groups',
  {
    id: id(),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    name: text().notNull(),
    subject: text().notNull(),
    contentLanguage: text().notNull(),
    cefrLevel: text(),
    /** Organisation-only details (never sent to the AI): when the group starts, planned size, teacher's note */
    startDate: date({ mode: 'string' }),
    expectedStudents: smallint(),
    description: text(),
    joinCode: text().notNull(),
    /** Per-group leaderboard toggle — [DECIDE] #4, default off */
    studentsSeeLeaderboard: boolean().notNull().default(false),
    archivedAt: ts(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('groups_teacher_idx').on(t.teacherId), uniqueIndex('groups_join_code_uq').on(t.joinCode)],
)

export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    groupId: text()
      .notNull()
      .references(() => groups.id),
    studentId: text()
      .notNull()
      .references(() => users.id),
    status: enrollmentStatus().notNull().default('active'),
    joinedAt: ts().notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [uniqueIndex('enrollments_group_student_uq').on(t.groupId, t.studentId), index('enrollments_group_idx').on(t.groupId)],
)

// ─── materials ──────────────────────────────────────────────────────────────

export const materials = pgTable(
  'materials',
  {
    id: id(),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    groupId: text().references(() => groups.id),
    kind: materialKind().notNull(),
    originalFilename: text(),
    storageKey: text(),
    mimeType: text(),
    bytes: integer(),
    durationSec: real(),
    extractedText: text(),
    extractedStructure: jsonb(),
    detectedLabels: jsonb().$type<{ track?: number; unit?: number; lesson?: number; exercise?: string }>(),
    processingStatus: processingStatus().notNull().default('pending_upload'),
    processingError: text(),
    /** sha256 of file bytes — ingestion cache key (§8.2) */
    contentHash: text(),
    /** 'answers': a book's answer pages, read once for the answer keys and then removed (DECISIONS.md BM) */
    purpose: text().$type<'answers'>(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('materials_content_hash_idx').on(t.contentHash), index('materials_teacher_idx').on(t.teacherId)],
)

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

/**
 * File bytes stored in Postgres when no S3 store is configured (e.g. a Vercel deployment).
 * Images are resized on the phone before upload, so rows stay small (~200–600 KB).
 */
export const materialBlobs = pgTable('material_blobs', {
  materialId: text()
    .primaryKey()
    .references(() => materials.id, { onDelete: 'cascade' }),
  data: bytea().notNull(),
  createdAt: ts().notNull().defaultNow(),
})

export const materialLinks = pgTable('material_links', {
  id: id(),
  audioMaterialId: text()
    .notNull()
    .references(() => materials.id),
  sourceMaterialId: text()
    .notNull()
    .references(() => materials.id),
  confidence: real().notNull(),
  reason: pairingReason().notNull(),
  confirmedByTeacher: boolean().notNull().default(false),
  ...timestamps,
})

// ─── authoring ──────────────────────────────────────────────────────────────

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    groupId: text().references(() => groups.id),
    title: text(),
    status: conversationStatus().notNull().default('active'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('conversations_teacher_idx').on(t.teacherId)],
)

export const messages = pgTable(
  'messages',
  {
    id: id(),
    conversationId: text()
      .notNull()
      .references(() => conversations.id),
    role: messageRole().notNull(),
    body: text().notNull(),
    attachments: text().array().notNull().default(sql`'{}'::text[]`),
    generatedAssignmentId: text(),
    ...timestamps,
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId)],
)

export const assignments = pgTable(
  'assignments',
  {
    id: id(),
    conversationId: text().references(() => conversations.id),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    groupId: text().references(() => groups.id),
    courseId: text(),
    orderIndex: integer(),
    title: text().notNull(),
    instructions: text(),
    instructionLocale: uiLocale().notNull(),
    contentLanguage: text().notNull(),
    subject: text(),
    cefrLevel: text(),
    difficulty: smallint(),
    estimatedMinutes: smallint(),
    totalPoints: integer(),
    status: assignmentStatus().notNull().default('draft'),
    publishedAt: ts(),
    /**
     * How long each student has (DECISIONS.md BK): days from when the homework reached them (published, or when they
     * joined the group, if later), to the end of that day in Seoul. null = no deadline.
     */
    dueDays: smallint(),
    /** The deadline of the students who were in the group when it was published (kept with dueDays; display only) */
    dueAt: ts(),
    shareSlug: text().notNull(),
    settings: jsonb().notNull().default({}),
    generationMeta: jsonb().notNull().default({}),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('assignments_share_slug_uq').on(t.shareSlug), index('assignments_group_idx').on(t.groupId)],
)

export const assignmentBlocks = pgTable(
  'assignment_blocks',
  {
    id: id(),
    assignmentId: text()
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    orderIndex: integer().notNull(),
    type: text().$type<'prose' | 'media' | 'video' | 'exercise'>().notNull(),
    payload: jsonb().notNull().default({}),
    ...timestamps,
  },
  (t) => [index('assignment_blocks_assignment_idx').on(t.assignmentId)],
)

export const exercises = pgTable(
  'exercises',
  {
    id: id(),
    assignmentId: text()
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    blockId: text().references(() => assignmentBlocks.id, { onDelete: 'set null' }),
    orderIndex: integer().notNull(),
    kind: text().notNull(),
    points: integer().notNull().default(1),
    prompt: jsonb().notNull(),
    payload: jsonb().notNull().default({}),
    answerKey: jsonb().notNull(),
    rationale: text(),
    gradingMode: gradingMode().notNull().default('auto'),
    skillTags: text().array().notNull().default(sql`'{}'::text[]`),
    methodTags: text().array().notNull().default(sql`'{}'::text[]`),
    sourceMaterialId: text().references(() => materials.id),
    sourceRef: text(),
    /** Listening: the book's label for the recording ("Track 1.12", "CD1-05"); set when the item needs audio */
    audioLabel: text(),
    /** Listening: the uploaded recording. audioLabel set + this null = waiting for the teacher's audio */
    audioMaterialId: text().references(() => materials.id, { onDelete: 'set null' }),
    aiConfidence: real(),
    /**
     * Copied from a book: where the answer came from: the book's answer pages, the recording, or the AI's own solving
     * (DECISIONS.md BM). A book answer is never replaced by what the AI hears in the audio.
     */
    answerSource: text().$type<'answer_key' | 'audio' | 'ai'>(),
    /** Verification warnings shown to the teacher as amber badges (§8.6), e.g. solve_back_disagrees */
    verifyFlags: text().array().notNull().default(sql`'{}'::text[]`),
    /** Student-facing explanation shown after submit */
    explanation: text(),
    teacherEdited: boolean().notNull().default(false),
    ...timestamps,
  },
  (t) => [index('exercises_assignment_idx').on(t.assignmentId)],
)

// ─── doing the work ─────────────────────────────────────────────────────────

export const attempts = pgTable(
  'attempts',
  {
    id: id(),
    assignmentId: text()
      .notNull()
      .references(() => assignments.id),
    studentId: text()
      .notNull()
      .references(() => users.id),
    status: attemptStatus().notNull().default('in_progress'),
    startedAt: ts().notNull().defaultNow(),
    submittedAt: ts(),
    gradedAt: ts(),
    /** Real engaged time, not wall clock (§11.2) */
    activeSeconds: integer().notNull().default(0),
    score: real(),
    maxScore: real(),
    percent: real(),
    autoGradedCount: integer().notNull().default(0),
    aiGradedCount: integer().notNull().default(0),
    manualPendingCount: integer().notNull().default(0),
    /** The student's plan when they last opened or submitted it: they see and are scored on its items (null = all, before plans) */
    plan: text().$type<'free' | 'pro' | 'vip'>(),
    integrityFlags: jsonb().notNull().default({}),
    deviceInfo: jsonb(),
    ...timestamps,
  },
  (t) => [
    // One attempt per student per assignment. Retries (if enabled later) will need an attemptNumber column.
    uniqueIndex('attempts_assignment_student_uq').on(t.assignmentId, t.studentId),
    index('attempts_assignment_status_idx').on(t.assignmentId, t.status),
    index('attempts_student_idx').on(t.studentId),
  ],
)

export const responses = pgTable(
  'responses',
  {
    id: id(),
    attemptId: text()
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    exerciseId: text()
      .notNull()
      .references(() => exercises.id),
    value: jsonb(),
    audioStorageKey: text(),
    isCorrect: boolean(),
    pointsAwarded: real(),
    aiFeedback: text(),
    /** The AI tutor's replies to this wrong answer (VIP), oldest first; a practice item's answer stays here (TutorNote in @ikhimi/ai) */
    tutor: jsonb().$type<
      {
        text: string
        example: string | null
        mode?: 'explain' | 'simpler' | 'example' | 'practice'
        practice?: { question: string; options: string[] | null; answers: string[]; why: string; given?: string; right?: boolean } | null
      }[]
    >(),
    teacherFeedback: text(),
    teacherOverrode: boolean().notNull().default(false),
    timeSpentSec: integer().notNull().default(0),
    /** Last-write-wins reconciliation key for offline sync (§16) */
    revisionCount: integer().notNull().default(0),
    /** Set when instant feedback was shown (§9); the answer is locked from then on */
    checkedAt: ts(),
    firstAnswerValue: jsonb(),
    ...timestamps,
  },
  (t) => [
    index('responses_attempt_idx').on(t.attemptId),
    uniqueIndex('responses_attempt_exercise_uq').on(t.attemptId, t.exerciseId),
  ],
)

/**
 * A student's old mistakes, asked again a few days later ("Xatolar ustida ishlash"): the same auto-graded item, never
 * scored. Right moves it further out (3 → 7 → 21 days), then it's done; wrong brings it back in 2 days.
 */
export const reviewItems = pgTable(
  'review_items',
  {
    id: id(),
    studentId: text()
      .notNull()
      .references(() => users.id),
    exerciseId: text()
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    /** 0 = not yet answered right in review; each right answer moves one step out */
    step: smallint().notNull().default(0),
    dueAt: ts().notNull(),
    lastRight: boolean(),
    doneAt: ts(),
    ...timestamps,
  },
  (t) => [uniqueIndex('review_items_student_exercise_uq').on(t.studentId, t.exerciseId), index('review_items_student_due_idx').on(t.studentId, t.dueAt)],
)

/**
 * A read-only progress page for a student's parents (/parent/<token>), made by one of the student's teachers.
 * It shows only that teacher's homework; the teacher can turn the link off.
 */
export const parentLinks = pgTable(
  'parent_links',
  {
    id: id(),
    token: text().notNull(),
    studentId: text()
      .notNull()
      .references(() => users.id),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    revokedAt: ts(),
    lastViewedAt: ts(),
    ...timestamps,
  },
  (t) => [uniqueIndex('parent_links_token_uq').on(t.token), index('parent_links_student_idx').on(t.studentId, t.teacherId)],
)

// ─── courses ────────────────────────────────────────────────────────────────

export const courses = pgTable(
  'courses',
  {
  id: id(),
  teacherId: text()
    .notNull()
    .references(() => users.id),
  /** Public address: /course/<slug> */
  slug: text().notNull(),
  title: text().notNull(),
  description: text(),
  subject: text(),
  contentLanguage: text(),
  cefrLevel: text(),
  coverUrl: text(),
  lessonCount: integer().notNull().default(0),
  visibility: courseVisibility().notNull().default('private'),
  /**
   * Paid course (DECISIONS.md BL): integer won, bought once for life; a buyer does its homework on VIP, anyone else
   * only its Free items (vocabulary). null = plan-covered: its homework follows each student's own plan.
   */
  priceKrw: integer(),
  /**
   * Publishing to anyone outside the teacher's groups (by link or in the catalog) needs the admin's approval, once:
   * draft → pending (sent) → approved, or returned with a note. Once approved, changes need no new approval.
   */
  reviewStatus: text().$type<'draft' | 'pending' | 'approved' | 'returned'>().notNull().default('draft'),
  reviewNote: text(),
  submittedAt: ts(),
  approvedAt: ts(),
  approvedBy: text().references(() => users.id),
  /**
   * What the teacher chose on Create's plan card for this course (vocabulary repetition, kinds they add or remove),
   * so the next plan for it starts there. Per course: one teacher teaches different classes differently.
   */
  planPrefs: jsonb().$type<{ vocabRepetition?: boolean; kindBias?: Record<string, number> }>(),
  ...timestamps,
  ...softDelete,
  },
  (t) => [uniqueIndex('courses_slug_uq').on(t.slug), index('courses_teacher_idx').on(t.teacherId)],
)

export const courseLessons = pgTable('course_lessons', {
  id: id(),
  courseId: text()
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  orderIndex: integer().notNull(),
  title: text().notNull(),
  assignmentTemplateId: text().references(() => assignments.id),
  /** YouTube or Vimeo link (no video is stored by us) */
  videoUrl: text(),
  /** Lesson notes shown under the video */
  videoNote: text(),
  /** Free preview: visible to anyone before buying */
  isPreview: boolean().notNull().default(false),
  ...timestamps,
})

export const courseRuns = pgTable('course_runs', {
  id: id(),
  courseId: text()
    .notNull()
    .references(() => courses.id),
  groupId: text()
    .notNull()
    .references(() => groups.id),
  startedAt: ts().notNull().defaultNow(),
  currentLessonIndex: integer().notNull().default(0),
  ...timestamps,
})

// ─── billing ────────────────────────────────────────────────────────────────

/**
 * A teacher's package of student plans: `seats` students get Pro or VIP until periodEnd. A student of the
 * package's group takes a seat when they open homework (a subscription with packageId), until the seats run out.
 */
export const planPackages = pgTable(
  'plan_packages',
  {
    id: id(),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    plan: text().$type<'pro' | 'vip'>().notNull(),
    seats: integer().notNull(),
    months: integer().notNull(),
    /** The class whose students take the seats; null until the teacher picks one */
    groupId: text().references(() => groups.id),
    status: subscriptionStatus().notNull(),
    provider: paymentProvider(),
    priceKrw: integer().notNull(),
    periodStart: ts(),
    periodEnd: ts(),
    ...timestamps,
  },
  (t) => [index('plan_packages_teacher_idx').on(t.teacherId), index('plan_packages_group_idx').on(t.groupId)],
)

/**
 * What a student has: a course (courseId set) or a plan ('pro' | 'vip', courseId null). A plan comes from the
 * student's own purchase (provider set), a teacher's package (packageId set) or staff (neither).
 */
export const subscriptions = pgTable('subscriptions', {
  id: id(),
  studentId: text()
    .notNull()
    .references(() => users.id),
  courseId: text().references(() => courses.id),
  groupId: text().references(() => groups.id),
  packageId: text().references(() => planPackages.id),
  /** Plans bought by the student: how long it runs once paid */
  months: integer(),
  plan: text().notNull(),
  status: subscriptionStatus().notNull(),
  provider: paymentProvider(),
  providerRef: text(),
  priceKrw: integer().notNull(),
  periodStart: ts(),
  periodEnd: ts(),
  autoRenew: boolean().notNull().default(false),
  ...timestamps,
})

export const payments = pgTable(
  'payments',
  {
    id: id(),
    /** What is paid for: a student's subscription, or a teacher's package (exactly one is set) */
    subscriptionId: text().references(() => subscriptions.id),
    packageId: text().references(() => planPackages.id),
    provider: paymentProvider().notNull(),
    providerTxnId: text().notNull(),
    amountKrw: integer().notNull(),
    status: paymentStatus().notNull(),
    raw: jsonb().notNull(),
    /** A student's own plan purchase: their teacher, who earns `commissionKrw` of it once it's paid (paid out by hand) */
    commissionTeacherId: text().references(() => users.id),
    commissionKrw: integer(),
    ...timestamps,
  },
  // Idempotency: one row per provider transaction (§14)
  (t) => [uniqueIndex('payments_provider_txn_uq').on(t.provider, t.providerTxnId), index('payments_commission_teacher_idx').on(t.commissionTeacherId)],
)

// ─── support ────────────────────────────────────────────────────────────────

/** Support bot: which user a message in the admin chat belongs to, so a reply finds its way back */
export const supportThreads = pgTable('support_threads', {
  id: id(),
  adminMessageId: integer().notNull(),
  userChatId: text().notNull(),
  ...timestamps,
}, (t) => [uniqueIndex('support_threads_admin_msg_uq').on(t.adminMessageId)])

/**
 * The teachers' help chat (DECISIONS.md BN): one row per question, only what Admin's "most asked" list and the daily
 * limit need. Never the conversation: that stays in the teacher's browser. Rows older than 90 days go in the daily job.
 */
export const helpQuestions = pgTable(
  'help_questions',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** The guide topic that answered it; 'unknown' (about 익히미, not in the guide) or 'off_topic' */
    topic: text().notNull(),
    /** An 'unknown' question in a few Korean words, so the same question asked differently counts once */
    gist: text(),
    /** The teacher sent the conversation on to the team (Telegram support) */
    handoff: boolean().notNull().default(false),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('help_questions_user_idx').on(t.userId, t.createdAt), index('help_questions_created_idx').on(t.createdAt)],
)

// ─── pedagogy KB ────────────────────────────────────────────────────────────

export const methodologyDocs = pgTable('methodology_docs', {
  id: id(),
  subject: text().notNull(),
  title: text().notNull(),
  body: text().notNull(),
  sourceRef: text(),
  embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
  tags: text().array().notNull().default(sql`'{}'::text[]`),
  locale: text().notNull().default('en'),
  ...timestamps,
})

// ─── staff & operations (admin panel) ───────────────────────────────────────

/**
 * Roles the owner defines for assistants, each a set of permissions (apps/web/src/server/admin/permissions.ts).
 * Owners themselves are named by the OWNER_PHONES setting, not stored here, so nobody can lock them out.
 */
export const staffRoles = pgTable('staff_roles', {
  id: id(),
  name: text().notNull(),
  permissions: text().array().notNull().default(sql`'{}'::text[]`),
  ...timestamps,
})

/** An assistant: added by phone number, before or after they first sign in */
export const staffMembers = pgTable(
  'staff_members',
  {
    id: id(),
    /** E.164; matched against the signed-in user's phone */
    phone: text().notNull(),
    name: text(),
    roleId: text()
      .notNull()
      .references(() => staffRoles.id),
    addedBy: text().references(() => users.id),
    revokedAt: ts(),
    ...timestamps,
  },
  (t) => [uniqueIndex('staff_members_phone_uq').on(t.phone)],
)

/** Settings the owner edits in the admin panel (the plan prices…): one JSON value per key, defaults in CONFIG */
export const appSettings = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().$type<Record<string, unknown>>().notNull(),
  updatedBy: text().references(() => users.id),
  updatedAt: ts().notNull().defaultNow(),
})

/** Every staff action that changes something or reveals personal data */
export const adminAudit = pgTable(
  'admin_audit',
  {
    id: id(),
    actorId: text()
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    targetType: text(),
    targetId: text(),
    details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('admin_audit_created_idx').on(t.createdAt)],
)

/** One row per AI call: what it was for, which model, tokens and time. The cost basis. */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: id(),
    userId: text(),
    /** generate | regenerate | grade_writing | grade_essay | listening | check | … */
    purpose: text().notNull(),
    /** The generation run, assignment or attempt it belongs to */
    refId: text(),
    task: text(),
    model: text().notNull(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    thoughtsTokens: integer().notNull().default(0),
    durationMs: integer().notNull().default(0),
    ok: boolean().notNull().default(true),
    error: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('ai_calls_created_idx').on(t.createdAt), index('ai_calls_ref_idx').on(t.refId)],
)

type LabArea = 'general' | 'reading' | 'listening' | 'writing' | 'speaking' | 'vocabulary' | 'grammar' | 'pronunciation'
type LabSlot = 'format' | 'build' | 'traps' | 'prep' | 'marking'

/** One thing the Lab learned about a methodology, in our own words (packages/ai lab.ts): about one task, or general */
export type MethodologyPoint = { id: string; area: LabArea; text: string; task?: string; slot?: LabSlot }

/** A task type the real test asks, learned from real samples (DECISIONS.md BH) */
export type MethodologyTask = { id: string; area: LabArea; name: string; format: string; kinds: string[]; buildable: boolean; note: string }

/** A real sample the Lab read (a past test), and the tasks it had; only its name is kept, never the file */
export type MethodologySample = { at: string; name: string; tasks: string[] }

type TaskFields = { area: LabArea; name: string; format: string; kinds: string[]; buildable: boolean; note: string; why: string }

/** A change the Lab's AI proposed in the chat; the owner applies some or all of it, or dismisses it */
export type LabProposal = {
  ops: (
    | { op: 'add'; area: LabArea; text: string; why: string; task?: string; slot?: LabSlot }
    | { op: 'update'; id: string; area: LabArea; text: string; why: string; task?: string; slot?: LabSlot }
    | { op: 'remove'; id: string; why: string }
    | ({ op: 'task_add'; key: string } & TaskFields)
    | ({ op: 'task_update'; id: string } & TaskFields)
    | { op: 'task_remove'; id: string; why: string }
  )[]
  status: 'open' | 'applied' | 'dismissed'
  /** Which ops the owner applied */
  applied?: number[]
  /** A real sample: applying the proposal counts it, with the known tasks it had */
  sample?: { name: string; seen: string[] }
}

/**
 * The owner's Lab (DECISIONS.md BG): a methodology is a catalog exam style (exams.ts, `examId`) or one the owner made.
 * Each has one body of knowledge the owner improves from resources in the Lab chat; Create's writers follow it when a
 * teacher picks the style. The owner's own ones appear in teachers' Style list once `visible`.
 */
export const methodologies = pgTable(
  'methodologies',
  {
    id: id(),
    /** The catalog exam it improves (ielts_academic…); null for the owner's own methodology */
    examId: text(),
    /** What teachers see in the Style list (an exam's catalog name for exams) */
    name: text().notNull(),
    /** ISO code of the language taught: the Style list shows it only for that language */
    language: text().notNull(),
    /** The owner's own: what teachers pick as the level, the first one by default */
    levels: text().array().notNull().default(sql`'{}'::text[]`),
    /** The owner's own: what it is, in English, for the writers (an exam's description is in exams.ts) */
    about: text().notNull().default(''),
    /** What the Lab learned, in our own words; never a resource's text */
    points: jsonb().$type<MethodologyPoint[]>().notNull().default([]),
    /** The blueprint: the task types the real test asks, from real samples */
    tasks: jsonb().$type<MethodologyTask[]>().notNull().default([]),
    /** The real samples read (names and the tasks they had) */
    samples: jsonb().$type<MethodologySample[]>().notNull().default([]),
    /** The owner's own: shown in teachers' Style list */
    visible: boolean().notNull().default(false),
    /** Homeworks written in this style */
    usedCount: integer().notNull().default(0),
    ...timestamps,
  },
  (t) => [uniqueIndex('methodologies_exam_uq').on(t.examId)],
)

/** Every change to a methodology's knowledge, with the knowledge before it: the newest can be undone */
export const methodologyVersions = pgTable(
  'methodology_versions',
  {
    id: id(),
    methodologyId: text()
      .notNull()
      .references(() => methodologies.id, { onDelete: 'cascade' }),
    before: jsonb().$type<MethodologyPoint[]>().notNull(),
    /** The tasks and samples before it (null on changes made before the blueprint existed) */
    beforeBlueprint: jsonb().$type<{ tasks: MethodologyTask[]; samples: MethodologySample[] }>(),
    /** What changed, for the history list: "+2 ~1 −0 · from the chat" */
    note: text().notNull(),
    createdBy: text().references(() => users.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('methodology_versions_m_idx').on(t.methodologyId, t.createdAt)],
)

/**
 * A whole book on its way to the Gemini Files API for the owner's Lab (DECISIONS.md BJ): the browser sends it in parts
 * under Vercel's request limit, and they are passed on to Google in the sizes Google asks for. `buffer` holds what
 * hasn't been passed on yet (under one Google part); `sent` is how much has. Deleted once the Lab has read the book.
 */
export const labUploads = pgTable('lab_uploads', {
  id: id(),
  ownerId: text()
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  filename: text().notNull(),
  mimeType: text().notNull(),
  bytes: integer().notNull(),
  /** Google's resumable upload address (a secret: only the server sees it) */
  uploadUrl: text().notNull(),
  granularity: integer().notNull(),
  sent: integer().notNull().default(0),
  buffer: bytea().notNull(),
  /** Once uploaded: Google's file name (files/…) and address */
  fileName: text(),
  fileUri: text(),
  createdAt: ts().notNull().defaultNow(),
})

/** The Lab chat, one thread per methodology. Files given are named here and deleted once read */
export const labMessages = pgTable(
  'lab_messages',
  {
    id: id(),
    methodologyId: text()
      .notNull()
      .references(() => methodologies.id, { onDelete: 'cascade' }),
    role: text().$type<'owner' | 'ai'>().notNull(),
    text: text().notNull(),
    files: text().array().notNull().default(sql`'{}'::text[]`),
    /** The owner sent a real sample (a past test), not a resource */
    sample: boolean().notNull().default(false),
    proposal: jsonb().$type<LabProposal>(),
    createdBy: text().references(() => users.id),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('lab_messages_m_idx').on(t.methodologyId, t.createdAt)],
)

/**
 * Telegram messages already sent, so each goes out once (new homework, due tomorrow, the teacher's reminder, alerts
 * to the owner). One row per key, e.g. "new:<assignment>:<student>"; rows older than 60 days are removed daily.
 */
export const notificationLog = pgTable(
  'notification_log',
  {
    key: text().primaryKey(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('notification_log_created_idx').on(t.createdAt)],
)

/** One row per homework generation: outcome, time, pictures, review. What the health page reads. */
export const generationRuns = pgTable(
  'generation_runs',
  {
    id: id(),
    teacherId: text()
      .notNull()
      .references(() => users.id),
    assignmentId: text(),
    mode: text().notNull(),
    /** new | refine | single */
    kind: text().notNull(),
    status: text().$type<'running' | 'ok' | 'failed'>().notNull().default('running'),
    errorCode: text(),
    errorDetail: text(),
    durationMs: integer(),
    items: integer(),
    materials: integer().notNull().default(0),
    /** Items the AI pointed at a picture / found by the locator / attached / removed without one */
    picturesPointed: integer().notNull().default(0),
    picturesLocated: integer().notNull().default(0),
    picturesAttached: integer().notNull().default(0),
    picturesRemoved: integer().notNull().default(0),
    /** ran | skipped_slow | failed | off */
    review: text(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [index('generation_runs_created_idx').on(t.createdAt)],
)
