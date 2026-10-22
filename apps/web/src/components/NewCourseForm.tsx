'use client'
import { Plus } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ICON, Input } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

/** One field to start; everything else is filled in on the course page. */
export function NewCourseForm() {
  const { t } = useI18n()
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const create = async () => {
    if (!title.trim()) return
    setBusy(true)
    const { ok, json } = await postJson('/api/courses', { title })
    setBusy(false)
    if (!ok) return setError(true)
    router.push(`/app/courses/${json.id}`)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void create()
      }}
      className="flex flex-col gap-2 sm:flex-row"
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('course.titlePlaceholder')} aria-label={t('course.title')} maxLength={120} className="flex-1" />
      <Button type="submit" loading={busy} disabled={!title.trim()} icon={<Plus size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
        {t('course.create')}
      </Button>
      {error && (
        <p role="alert" className="t-small text-error-600">
          {t('error.generic')}
        </p>
      )}
    </form>
  )
}
