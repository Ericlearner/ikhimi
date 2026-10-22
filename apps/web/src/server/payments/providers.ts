import type { PaymentProvider, ProviderId } from './core'

/**
 * A real payment gateway (e.g. Toss Payments) goes here once its merchant account exists: an adapter with `enabled()`
 * reading its keys and `checkoutUrl()`, a callback route under /api/payments/<id> that calls markPaid / markCancelled,
 * and its id added to the payment_provider enum. Until then nothing is sold (the plans pages say so), except with the
 * test provider.
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

export const PROVIDERS: Record<ProviderId, PaymentProvider> = { test: testProvider }

/** Real gateways first; the test one only when nothing real is connected (no gateway yet) */
export function enabledProviders(): PaymentProvider[] {
  const real: PaymentProvider[] = []
  return real.length ? real : [testProvider].filter((p) => p.enabled())
}
