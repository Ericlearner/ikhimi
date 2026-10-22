import { cardPayment } from './card'
import type { PaymentProvider, ProviderId } from './core'

/**
 * A real payment gateway (e.g. Toss Payments) goes here once its merchant account exists: an adapter with `enabled()`
 * reading its keys and `checkoutUrl()`, a callback route under /api/payments/<id> that calls markPaid / markCancelled,
 * and its id added to the payment_provider enum. Until then: bank transfers in the bot, and the test provider.
 */

/**
 * A pretend provider to try the whole purchase flow before a real merchant account exists.
 * Always on in development; in production only with PAYMENT_TEST_ENABLED=1 (anyone could "pay" with it).
 * Test payments are excluded from revenue.
 */
export const testProvider: PaymentProvider = {
  id: 'test',
  label: '테스트 결제',
  enabled: () => process.env.NODE_ENV !== 'production' || process.env.PAYMENT_TEST_ENABLED === '1',
  checkoutUrl: ({ paymentId }) => `/pay/test/${paymentId}`,
}

/**
 * A bank transfer to the owner's account, paid and approved in the Telegram bot (card.ts, telegram/shop.ts): the way to
 * sell before a gateway is connected. Not a website checkout: the website sends buyers to the bot.
 */
export const cardProvider: PaymentProvider = {
  id: 'card',
  label: '계좌이체',
  enabled: () => !!cardPayment(),
  checkoutUrl: () => {
    const bot = process.env.TELEGRAM_BOT_USERNAME
    return bot ? `https://t.me/${bot}?start=plan` : 'https://t.me'
  },
}

/**
 * The website's way to pay while no gateway is connected but bank transfers are on: the bot's username (the plans page
 * links to its shop). Null once a gateway is connected: the normal checkout is back by itself.
 */
export function payInTelegram(): string | null {
  const bot = process.env.TELEGRAM_BOT_USERNAME
  return bot && cardProvider.enabled() && !enabledProviders().length ? bot : null
}

export const PROVIDERS: Record<ProviderId, PaymentProvider> = { test: testProvider, card: cardProvider }

/** Real gateways first; the test one only when nothing real is connected (no gateway yet) */
export function enabledProviders(): PaymentProvider[] {
  const real: PaymentProvider[] = []
  return real.length ? real : [testProvider].filter((p) => p.enabled())
}
