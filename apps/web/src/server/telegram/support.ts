/**
 * 익히미 support bot (a separate bot from the login bot). Users write to it; every message is copied into
 * the admin chat (SUPPORT_ADMIN_CHAT_ID: a person or a group) under a header naming the sender. An admin
 * *replies* to that header or the copied message, and the bot copies the reply back to the user.
 * Text, photos, voice, files — anything Telegram can copy.
 */
import { eq, supportThreads, type Db } from '@ikhimi/db'
import type { TelegramBotApi } from './api'

export type SupportUpdate = {
  update_id: number
  message?: {
    message_id: number
    chat: { id: number; type: string }
    from?: { id: number; first_name?: string; last_name?: string; username?: string; language_code?: string }
    text?: string
    reply_to_message?: { message_id: number }
  }
}

const WELCOME = '안녕하세요! 익히미 고객센터예요.\n\n질문, 제안, 문제를 여기에 남겨 주세요. 사진이나 음성 메시지도 보낼 수 있어요. 곧 답해 드릴게요.'
const RECEIVED = '✅ 메시지를 받았어요. 답은 여기로 보내 드려요.'

/**
 * `shared`: the login bot also does support (no separate support bot). Then /start belongs to login,
 * and without an admin chat only /id answers (never a setup message to ordinary users).
 */
export async function handleSupportUpdate(db: Db, api: TelegramBotApi, u: SupportUpdate, adminChatId: string | undefined, opts: { shared?: boolean } = {}) {
  const m = u.message
  if (!m) return
  const chatId = String(m.chat.id)

  if (m.text === '/id') return api.sendMessage(chatId, `Chat id: ${chatId}\nSUPPORT_ADMIN_CHAT_ID=${chatId}`)
  if (opts.shared && !adminChatId) return

  // Not configured yet: tell whoever writes their chat id, so the owner can set SUPPORT_ADMIN_CHAT_ID
  if (!adminChatId) {
    await api.sendMessage(chatId, `Support bot is not configured yet. To make this chat the admin chat, set SUPPORT_ADMIN_CHAT_ID=${chatId} in Vercel and redeploy.`)
    return
  }

  if (chatId === adminChatId) {
    if (m.text === '/start' || m.text === '/id') return api.sendMessage(chatId, `Admin chat ✓ (id ${chatId}). 사용자에게 답하려면 그 메시지에 ‘답장(Reply)’하세요.`)
    const replyTo = m.reply_to_message?.message_id
    if (!replyTo) return
    const [thread] = await db.select().from(supportThreads).where(eq(supportThreads.adminMessageId, replyTo)).limit(1)
    if (!thread) return api.sendMessage(chatId, '⚠️ 이 메시지가 어느 사용자의 것인지 찾지 못했어요. 사용자 메시지의 머리글이나 메시지 자체에 답장하세요.')
    try {
      await api.call('copyMessage', { chat_id: thread.userChatId, from_chat_id: chatId, message_id: m.message_id })
      await api.call('setMessageReaction', { chat_id: chatId, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] }).catch(() => {})
    } catch (e) {
      await api.sendMessage(chatId, `⚠️ 보내지 못했어요: ${e instanceof Error ? e.message : '오류'}`)
    }
    return
  }

  // Only private chats with users (ignore groups the bot may be added to)
  if (m.chat.type !== 'private') return
  if (m.text === '/start' && !opts.shared) return api.sendMessage(chatId, WELCOME)

  const f = m.from
  const name = [f?.first_name, f?.last_name].filter(Boolean).join(' ') || 'User'
  const header = `👤 ${name}${f?.username ? ` (@${f.username})` : ''} · id ${chatId}${f?.language_code ? ` · ${f.language_code}` : ''}`
  const head = await api.call<{ message_id: number }>('sendMessage', { chat_id: adminChatId, text: header })
  const copy = await api.call<{ message_id: number }>('copyMessage', {
    chat_id: adminChatId,
    from_chat_id: chatId,
    message_id: m.message_id,
    reply_parameters: { message_id: head.message_id },
  })
  // Replying to either the header or the copy reaches the user
  await db
    .insert(supportThreads)
    .values([
      { adminMessageId: head.message_id, userChatId: chatId },
      { adminMessageId: copy.message_id, userChatId: chatId },
    ])
    .onConflictDoNothing()
  await api.sendMessage(chatId, RECEIVED)
}
