/**
 * Demo tenant (§18). Phase 0 seeds people and classes; assignments, attempts and the saved
 * course are added as those features land (Phase 1 / 4).
 *
 * Idempotent: safe to re-run. Phone numbers use the 010-0000-xxxx range, kept for demo data.
 */
import { createDb, enrollments, groups, newJoinCode, teacherProfiles, users } from '../src/index'
import { eq } from 'drizzle-orm'

const db = createDb()

const FIRST = [
  '민준', '서연', '도윤', '서윤', '시우', '지우', '하준', '하은', '주원', '지민',
  '지호', '수아', '예준', '채원', '유준', '지유', '건우', '윤서', '우진', '다은',
  '선우', '은서', '연우', '예은', '서준', '소윤', '현우', '민서', '정우', '하린',
  '승우', '지아', '이준', '수빈', '준서', '예린', '태윤', '가은',
]
const LAST = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임']
const surname = (_first: string, i: number) => LAST[i % LAST.length]!

async function upsertUser(v: typeof users.$inferInsert) {
  const [existing] = await db.select().from(users).where(eq(users.phone, v.phone)).limit(1)
  if (existing) return existing
  const [u] = await db.insert(users).values(v).returning()
  return u!
}

const teacher = await upsertUser({
  role: 'teacher',
  phone: 'seed:teacher',
  // Signing in with Google as this email opens the demo teacher (server/auth/users.ts)
  email: process.env.SEED_TEACHER_EMAIL?.trim().toLowerCase() || null,
  fullName: '김지은',
  uiLocale: 'ko',
})
await db
  .insert(teacherProfiles)
  .values({ userId: teacher.id, subjects: ['english'], defaultContentLanguage: 'en', defaultCefrLevel: 'B1', onboardedAt: new Date() })
  .onConflictDoNothing()

const groupDefs = [
  { name: '중1 A반', cefrLevel: 'A2', size: 14 },
  { name: '중3 B반', cefrLevel: 'B1', size: 16 },
  { name: '성인 회화 중급', cefrLevel: 'B1', size: 8 },
]

let n = 0
for (const def of groupDefs) {
  let [g] = await db.select().from(groups).where(eq(groups.name, def.name)).limit(1)
  g ??= (
    await db
      .insert(groups)
      .values({ teacherId: teacher.id, name: def.name, subject: 'english', contentLanguage: 'en', cefrLevel: def.cefrLevel, joinCode: newJoinCode() })
      .returning()
  )[0]!
  for (let i = 0; i < def.size; i++, n++) {
    const first = FIRST[n]!
    const s = await upsertUser({
      role: 'student',
      phone: `seed:student-${n + 1}`,
      fullName: `${surname(first, n)}${first}`,
      uiLocale: 'ko',
    })
    await db.insert(enrollments).values({ groupId: g.id, studentId: s.id }).onConflictDoNothing()
  }
}

console.log(`Seeded teacher ${teacher.fullName} (${teacher.email ?? 'set SEED_TEACHER_EMAIL to sign in as them'}), ${groupDefs.length} groups, ${n} students`)
process.exit(0)
