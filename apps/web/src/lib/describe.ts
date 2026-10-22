import { describeAnswer, describeResponse, type ExerciseKind } from '@ikhimi/ai'
import type { MessageKey } from '@ikhimi/i18n'

type T = (k: MessageKey, v?: Record<string, string | number>) => string

/** true/false/not_given are data values; show them in the reader's language. */
export const localizeTf = (t: T, v: string | null | undefined) =>
  v === 'true' || v === 'false' || v === 'not_given' ? t(`tf.${v}` as MessageKey) : (v ?? '—')

export const answerText = (t: T, kind: string, payload: unknown, key: unknown) =>
  kind === 'true_false' ? localizeTf(t, describeAnswer('true_false', payload, key)) : describeAnswer(kind as ExerciseKind, payload, key)

export const responseText = (t: T, kind: string, payload: unknown, value: unknown) =>
  kind === 'shadowing' && value === true
    ? t('shadow.notChecked')
    : kind === 'true_false' ? localizeTf(t, describeResponse('true_false', payload, value)) : describeResponse(kind as ExerciseKind, payload, value)
