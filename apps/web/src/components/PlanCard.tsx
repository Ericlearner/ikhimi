'use client'
import { BookOpen, Image as ImageIcon, Minus, Plus, Sparkles, X } from 'lucide-react'
import { planItemCount, planMinutes, PLAN_LIMITS, vocabCounts, type HomeworkPlan, type PlanSection } from '@ikhimi/ai/plan-shape'
import type { MessageKey } from '@ikhimi/i18n'
import { Badge, ICON, IconButton, KindIcon, Switch } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

/** Kinds the teacher can add from the card (essay only through the message: it changes the whole homework) */
const ADDABLE = ['gap_fill', 'mcq_single', 'true_false', 'matching', 'ordering', 'short_answer', 'open_writing', 'shadowing'] as const

/**
 * Create mode's plan, as the assistant's reply in the chat (plan.ts): the parts with their exact counts, the
 * vocabulary repetition switch, and "만들기". Everything is already decided, so one click is enough; the
 * teacher can change counts, drop or add a part, or answer in the chat below.
 */
export function PlanCard({
  plan,
  onChange,
  onCreate,
  onBack,
  busy,
}: {
  plan: HomeworkPlan
  onChange: (p: HomeworkPlan) => void
  onCreate: () => void
  onBack: () => void
  /** Being written or re-planned: read-only */
  busy: boolean
}) {
  const { t } = useI18n()
  const total = planItemCount(plan)
  const vocab = vocabCounts(plan)
  const setSections = (sections: PlanSection[]) => onChange({ ...plan, sections: sections.map((s, i) => ({ ...s, id: `s${i + 1}` })) })
  const setCount = (si: number, ki: number, delta: number) => {
    const sections = plan.sections
      .map((s, i) => (i !== si ? s : { ...s, kinds: s.kinds.map((k, j) => (j !== ki ? k : { ...k, count: Math.max(0, Math.min(PLAN_LIMITS.perKind, k.count + delta)) })).filter((k) => k.count > 0) }))
      .filter((s) => s.kinds.length > 0)
    if (sections.length) setSections(sections)
  }
  const addKind = (kind: (typeof ADDABLE)[number]) => {
    if (plan.sections.length >= PLAN_LIMITS.sections) return
    const topic = [plan.title, ...plan.grammarPoints].join('; ')
    const about =
      kind === 'shadowing'
        ? `Shadowing on this homework's topic (${topic}): a short text at the students' level, read aloud sentence by sentence; the student says it along.`
        : `More practice of this homework's topic (${topic}), as ${kind} items the teacher added.`
    const skill = kind === 'shadowing' ? 'pronunciation' : kind === 'open_writing' ? 'writing' : 'grammar'
    setSections([...plan.sections, { id: '', title: t(`draft.kind.${kind}` as MessageKey), skill, kinds: [{ kind, count: kind === 'shadowing' ? 1 : 2 }], about, passage: false, pictures: false }])
  }

  return (
    <section aria-label={t('plan.label')} className="fade-in mr-auto w-full max-w-[92%] rounded-lg rounded-bl-sm border border-paper-300 bg-paper-50 p-4 shadow-e1">
      <p className="t-small flex items-center gap-1.5 font-medium text-orange-700">
        <Sparkles size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('plan.label')}
      </p>
      <h2 className="t-h3 mt-1">{plan.title}</h2>
      <p className="t-small t-num mt-0.5 text-ink-500">
        {[plan.level, t('plan.summary', { n: total, m: planMinutes(plan) })].filter(Boolean).join(' · ')}
      </p>
      {plan.grammarPoints.length > 0 && <p className="t-small mt-1 text-ink-500">{t('plan.grammar', { points: plan.grammarPoints.join(', ') })}</p>}

      <ol className="mt-3 flex flex-col gap-2">
        {plan.sections.map((s, si) => (
          <li key={si} className="rounded-md border border-paper-300 bg-paper-100 px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <p className="t-body font-medium">
                {si + 1}. {s.title}
              </p>
              <span className="flex shrink-0 items-center gap-1">
                {s.passage && <Badge icon={<BookOpen size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{t('plan.reading')}</Badge>}
                {s.pictures && <Badge icon={<ImageIcon size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{t('plan.pictures')}</Badge>}
                {!busy && plan.sections.length > 1 && (
                  <IconButton label={t('plan.removePart')} size={36} onClick={() => setSections(plan.sections.filter((_, i) => i !== si))}>
                    <X size={16} strokeWidth={ICON.strokeWidth} aria-hidden />
                  </IconButton>
                )}
              </span>
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-2">
              {s.kinds.map((k, ki) => (
                <li key={k.kind} className="t-small flex min-h-9 items-center gap-1.5 rounded-pill border border-paper-300 bg-paper-50 pl-3 pr-1 font-medium">
                  <KindIcon kind={k.kind} size={16} className="text-ink-500" />
                  {t(`draft.kind.${k.kind}` as MessageKey)}
                  {busy ? (
                    <span className="t-num pr-2">×{k.count}</span>
                  ) : (
                    <span className="flex items-center">
                      <IconButton label={`${t('plan.less')}: ${t(`draft.kind.${k.kind}` as MessageKey)}`} size={36} onClick={() => setCount(si, ki, -1)}>
                        <Minus size={14} strokeWidth={ICON.strokeWidth} aria-hidden />
                      </IconButton>
                      <span className="t-num w-5 text-center" aria-live="polite">
                        {k.count}
                      </span>
                      <IconButton
                        label={`${t('plan.more')}: ${t(`draft.kind.${k.kind}` as MessageKey)}`}
                        size={36}
                        onClick={() => setCount(si, ki, 1)}
                        disabled={total >= PLAN_LIMITS.items || k.count >= PLAN_LIMITS.perKind}
                      >
                        <Plus size={14} strokeWidth={ICON.strokeWidth} aria-hidden />
                      </IconButton>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {!busy && plan.sections.length < PLAN_LIMITS.sections && total < PLAN_LIMITS.items && (
        <label className="relative mt-2 inline-flex">
          <span className="t-small press inline-flex min-h-9 items-center gap-1.5 rounded-pill border border-dashed border-paper-400 px-3 font-medium text-ink-600 hover:bg-paper-200">
            <Plus size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('plan.addPart')}
          </span>
          <select
            aria-label={t('plan.addPart')}
            value=""
            onChange={(e) => e.target.value && addKind(e.target.value as (typeof ADDABLE)[number])}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">{t('plan.addPart')}</option>
            {ADDABLE.map((k) => (
              <option key={k} value={k}>
                {t(`draft.kind.${k}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
      )}

      {plan.words.length > 0 && (
        <div className="mt-3 border-t border-paper-300 pt-1">
          {busy ? (
            <p className="t-small py-2 text-ink-500">{plan.vocabRepetition ? t('plan.vocabOn', { n: vocab.meet + vocab.recall }) : `${t('plan.vocab')}: ${t('plan.vocabOff')}`}</p>
          ) : (
            <Switch
              checked={plan.vocabRepetition}
              onChange={(v) => onChange({ ...plan, vocabRepetition: v })}
              label={t('plan.vocab')}
              description={plan.vocabRepetition ? t('plan.vocabOn', { n: vocab.meet + vocab.recall }) : t('plan.vocabOff')}
            />
          )}
          {plan.vocabRepetition && <p className="t-small text-ink-400">{plan.words.slice(0, vocab.meet).map((w) => w.word).join(' · ')}</p>}
        </div>
      )}

      {!busy && (
        <>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button type="button" onClick={onBack} className="btn btn-ghost min-h-11 px-3">
              <span className="btn-label">{t('plan.back')}</span>
            </button>
            <button type="button" onClick={onCreate} className="btn btn-primary btn-pill min-h-12 px-6">
              <span className="btn-label">
                <Sparkles size={18} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('plan.create')}
              </span>
            </button>
          </div>
          <p className="t-small mt-2 text-ink-400">{t('plan.hint')}</p>
        </>
      )}
    </section>
  )
}
