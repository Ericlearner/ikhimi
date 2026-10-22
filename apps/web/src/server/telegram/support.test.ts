import { expect, it } from 'vitest'
import { createTestDb } from '@ikhimi/db/testing'
import type { TelegramBotApi } from './api'
import { handleSupportUpdate } from './support'

function fakeApi() {
  const calls: { method: string; params: Record<string, unknown> }[] = []
  let n = 100
  const api = {
    async call(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params })
      return { message_id: ++n }
    },
    async sendMessage(chat_id: string, text: string) {
      calls.push({ method: 'sendMessage', params: { chat_id, text } })
    },
  }
  return { api: api as unknown as TelegramBotApi, calls }
}

it('user message → admin chat; admin reply → back to the user', async () => {
  const db = await createTestDb()
  const { api, calls } = fakeApi()
  const ADMIN = '-1001'
  await handleSupportUpdate(db, api, { update_id: 1, message: { message_id: 5, chat: { id: 42, type: 'private' }, from: { id: 42, first_name: 'Aziz', username: 'aziz' }, text: 'Kira olmayapman' } }, ADMIN)
  expect(calls[0]).toMatchObject({ method: 'sendMessage', params: { chat_id: ADMIN, text: expect.stringContaining('Aziz (@aziz) · id 42') } })
  expect(calls[1]).toMatchObject({ method: 'copyMessage', params: { chat_id: ADMIN, from_chat_id: '42', message_id: 5 } })
  const copyId = 102

  calls.length = 0
  await handleSupportUpdate(db, api, { update_id: 2, message: { message_id: 9, chat: { id: -1001, type: 'group' }, text: 'Qayta urinib ko‘ring', reply_to_message: { message_id: copyId } } }, ADMIN)
  expect(calls[0]).toMatchObject({ method: 'copyMessage', params: { chat_id: '42', from_chat_id: ADMIN, message_id: 9 } })

  // A reply to something unknown is not delivered anywhere
  calls.length = 0
  await handleSupportUpdate(db, api, { update_id: 3, message: { message_id: 10, chat: { id: -1001, type: 'group' }, text: 'x', reply_to_message: { message_id: 999 } } }, ADMIN)
  expect(calls.some((c) => c.method === 'copyMessage')).toBe(false)
})

it('shared with the login bot: /start is left to login, no admin chat means silence, /id always answers', async () => {
  const db = await createTestDb()
  const { api, calls } = fakeApi()
  const msg = (text: string) => ({ update_id: 1, message: { message_id: 1, chat: { id: 7, type: 'private' }, from: { id: 7 }, text } })
  await handleSupportUpdate(db, api, msg('Salom'), undefined, { shared: true })
  expect(calls).toHaveLength(0)
  await handleSupportUpdate(db, api, msg('/id'), undefined, { shared: true })
  expect(calls[0]).toMatchObject({ params: { text: expect.stringContaining('SUPPORT_ADMIN_CHAT_ID=7') } })
  calls.length = 0
  await handleSupportUpdate(db, api, msg('Savolim bor'), '-100', { shared: true })
  expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'copyMessage', 'sendMessage'])
})

it('routes login messages to login and the rest to support', async () => {
  const { isLoginUpdate } = await import('./index')
  const u = (m: object) => ({ message: { chat: { type: 'private' }, ...m } })
  expect(isLoginUpdate(u({ text: '/start abc123' }))).toBe(true)
  expect(isLoginUpdate(u({ contact: { phone_number: '1' } }))).toBe(true)
  expect(isLoginUpdate(u({ text: 'Kira olmayapman' }))).toBe(false)
  // A number typed by hand goes to login (which shows the share button), not to support
  expect(isLoginUpdate(u({ text: '+998505030974' }))).toBe(true)
  expect(isLoginUpdate(u({ text: '90 123 45 67' }))).toBe(true)
  expect(isLoginUpdate(u({ text: 'Raqamim 901234567, kira olmayapman' }))).toBe(false)
  expect(isLoginUpdate(u({ text: '12345' }))).toBe(false)
  // The admin answering a user with a number is support
  expect(isLoginUpdate({ message: { chat: { id: 424242, type: 'private' }, text: '+998901234567' } }, '424242')).toBe(false)
  expect(isLoginUpdate({ message: { chat: { id: 5, type: 'private' }, text: '+998901234567' } }, '424242')).toBe(true)
  expect(isLoginUpdate({ message: { chat: { type: 'group' }, text: '/start' } })).toBe(false)
})
