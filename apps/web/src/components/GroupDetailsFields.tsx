'use client'
import { Input, Textarea } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'

export type GroupDetailsValue = {
  name: string
  cefrLevel: string
  startDate: string
  expectedStudents: string
  description: string
}

export const emptyGroupDetails = (cefrLevel = ''): GroupDetailsValue => ({ name: '', cefrLevel, startDate: '', expectedStudents: '', description: '' })

/** The form value as the API expects it (empty fields → null). */
export function groupDetailsPayload(v: GroupDetailsValue) {
  const n = Number.parseInt(v.expectedStudents, 10)
  return {
    name: v.name.trim(),
    cefrLevel: v.cefrLevel || null,
    startDate: v.startDate || null,
    expectedStudents: Number.isFinite(n) && n > 0 ? n : null,
    description: v.description.trim() || null,
  }
}

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
export const fieldClass = 't-body min-h-12 w-full rounded-lg border border-paper-300 bg-paper-50 px-3 text-ink-700 focus:border-ink-700 focus:outline-none'

/** Name, level, start date, planned size, note. Organisation only — the AI never sees these. */
export function GroupDetailsFields({ value, onChange, autoFocus }: { value: GroupDetailsValue; onChange: (v: GroupDetailsValue) => void; autoFocus?: boolean }) {
  const { t } = useI18n()
  const set = <K extends keyof GroupDetailsValue>(k: K, v: GroupDetailsValue[K]) => onChange({ ...value, [k]: v })
  const label = 't-small flex flex-col gap-1 font-medium text-ink-500'
  return (
    <div className="flex flex-col gap-3">
      <label className={label}>
        {t('group.name')}
        <Input value={value.name} onChange={(e) => set('name', e.target.value)} placeholder={t('publish.newGroup')} maxLength={60} autoFocus={autoFocus} />
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={label}>
          {t('group.level')}
          <select value={value.cefrLevel} onChange={(e) => set('cefrLevel', e.target.value)} className={fieldClass}>
            <option value="">—</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {t('group.startDate')}
          <input type="date" value={value.startDate} onChange={(e) => set('startDate', e.target.value)} className={fieldClass} />
        </label>
        <label className={label}>
          {t('group.expected')}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={500}
            value={value.expectedStudents}
            onChange={(e) => set('expectedStudents', e.target.value)}
            className={`${fieldClass} t-num`}
          />
        </label>
      </div>
      <label className={label}>
        {t('group.description')}
        <Textarea value={value.description} onChange={(e) => set('description', e.target.value)} placeholder={t('group.descriptionPlaceholder')} maxLength={500} minRows={2} />
      </label>
      <p className="t-small text-ink-400">{t('group.detailsHint')}</p>
    </div>
  )
}
