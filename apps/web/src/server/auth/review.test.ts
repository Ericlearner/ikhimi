import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import { teacherProfiles, users, type Db } from '@ikhimi/db'
import { studentPlan } from '../plans'
import { prepareReviewAccount, REVIEW_NAME, reviewCodeMatches, reviewLogin } from './review'
import { findOrCreateUserByPhone } from './users'

let db: Db
const saved = { phone: process.env.REVIEW_LOGIN_PHONE, code: process.env.REVIEW_LOGIN_CODE }
beforeEach(async () => {
  db = await createTestDb()
  process.env.REVIEW_LOGIN_PHONE = '+998 90 000 00 00'
  process.env.REVIEW_LOGIN_CODE = '482913'
})
afterEach(() => {
  process.env.REVIEW_LOGIN_PHONE = saved.phone
  process.env.REVIEW_LOGIN_CODE = saved.code
})

describe('store review login', () => {
  it('accepts only its own code for its own number', () => {
    expect(reviewLogin()).toEqual({ phone: '+998900000000', code: '482913' })
    expect(reviewCodeMatches('+998900000000', '482913')).toBe(true)
    expect(reviewCodeMatches('+998900000000', '000000')).toBe(false)
    expect(reviewCodeMatches('+998901234567', '482913')).toBe(false)
    process.env.REVIEW_LOGIN_CODE = ''
    expect(reviewLogin()).toBeNull()
    expect(reviewCodeMatches('+998900000000', '482913')).toBe(false)
  })

  it('opens a ready account: name, teacher and student sides, VIP', async () => {
    const { user } = await findOrCreateUserByPhone(db, { phone: '+998900000000', uiLocale: 'ko' })
    await prepareReviewAccount(db, user.id)
    await prepareReviewAccount(db, user.id)
    const [u] = await db.select().from(users)
    expect(u).toMatchObject({ fullName: REVIEW_NAME, roles: ['teacher', 'student'] })
    expect(await db.select().from(teacherProfiles)).toHaveLength(1)
    expect(await studentPlan(db, user.id)).toBe('vip')
  })
})
