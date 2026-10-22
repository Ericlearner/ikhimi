/**
 * Bank transfers (계좌이체), until a payment gateway is connected (DECISIONS.md BF; the provider id stays 'card'). A
 * buyer picks a plan in the Telegram bot, transfers the price to the owner's bank account, and sends the transfer
 * confirmation; it goes to the admins' chat with Approve / Reject, and approving turns the plan on through the same
 * payment records as a gateway would (revenue, teacher commission, Admin → Money).
 *
 * PAY_ACCOUNT_NUMBER (the account number, dashes allowed), PAY_BANK_NAME and PAY_ACCOUNT_HOLDER (예금주) turn it on.
 * Confirmations go to PAY_ADMIN_CHAT_ID (comma-separated chat ids; a group with the bot in it, or a person who has
 * started the bot), else to the owners' own Telegram (OWNER_PHONES who signed in with it). Unset PAY_ACCOUNT_NUMBER = no
 * bank transfers.
 */
import { and, inArray, isNull, users, type Db } from '@ikhimi/db'
import { ownerPhones } from '../admin/staff'

export function cardPayment() {
  const pretty = process.env.PAY_ACCOUNT_NUMBER?.trim() ?? ''
  const number = pretty.replace(/\D/g, '')
  if (!/^\d{8,20}$/.test(number)) return null
  return { number, pretty, bank: process.env.PAY_BANK_NAME?.trim() || null, holder: process.env.PAY_ACCOUNT_HOLDER?.trim() || null }
}

/** Where transfer confirmations go, and who may approve them */
export async function cardAdminChats(db: Db): Promise<string[]> {
  const set = (process.env.PAY_ADMIN_CHAT_ID ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (set.length) return set
  const phones = ownerPhones()
  if (!phones.length) return []
  const owners = await db
    .select({ chatId: users.telegramChatId })
    .from(users)
    .where(and(inArray(users.phone, phones), isNull(users.deletedAt)))
  return owners.map((o) => o.chatId).filter((c): c is string => !!c)
}
