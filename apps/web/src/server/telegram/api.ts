/** Minimal Telegram Bot API client (free). */
export type ReplyMarkup =
  | { keyboard: { text: string; request_contact?: boolean }[][]; resize_keyboard?: boolean; one_time_keyboard?: boolean }
  | { remove_keyboard: true }
  | { inline_keyboard: InlineButton[][] }

/** A button under a message: sends `callback_data` back to the bot, opens `url`, or copies `copy_text` */
export type InlineButton = { text: string; callback_data: string } | { text: string; url: string } | { text: string; copy_text: { text: string } }

export interface BotApi {
  sendMessage(chatId: string, text: string, replyMarkup?: ReplyMarkup): Promise<void>
}

export class TelegramBotApi implements BotApi {
  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`)
    return json.result as T
  }

  async sendMessage(chatId: string, text: string, replyMarkup?: ReplyMarkup) {
    await this.call('sendMessage', { chat_id: chatId, text, ...(replyMarkup && { reply_markup: replyMarkup }) })
  }

  async answerCallback(id: string, text?: string) {
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(text && { text }) })
  }

  /** A copy of a message (a payment receipt, a channel post) in another chat, with a caption and buttons of its own */
  async copyMessage(toChatId: string, fromChatId: string, messageId: number, caption?: string, replyMarkup?: ReplyMarkup) {
    await this.call('copyMessage', { chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId, ...(caption && { caption }), ...(replyMarkup && { reply_markup: replyMarkup }) })
  }

  /** A picture already on Telegram (its file_id), with a caption and buttons */
  async sendPhoto(chatId: string, fileId: string, caption: string, replyMarkup?: ReplyMarkup) {
    await this.call('sendPhoto', { chat_id: chatId, photo: fileId, caption, ...(replyMarkup && { reply_markup: replyMarkup }) })
  }

  /** Swaps a message's buttons (none: takes them away) */
  async editButtons(chatId: string, messageId: number, replyMarkup?: ReplyMarkup) {
    await this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: replyMarkup ?? { inline_keyboard: [] } })
  }
}

/** The subset of a Telegram Update we handle. */
export type TgUpdate = {
  update_id: number
  message?: {
    message_id?: number
    chat: { id: number; type: string }
    from?: { id: number; language_code?: string; first_name?: string }
    text?: string
    /** A photo's text */
    caption?: string
    contact?: { phone_number: string; user_id?: number; first_name?: string; last_name?: string }
    /** A picture (a payment receipt screenshot), in several sizes */
    photo?: { file_id: string }[]
    /** A file sent as a document (a PDF receipt) */
    document?: { file_id: string; mime_type?: string }
  }
  /** An inline button was pressed */
  callback_query?: {
    id: string
    from: { id: number; first_name?: string }
    data?: string
    message?: { message_id: number; chat: { id: number; type: string } }
  }
}
