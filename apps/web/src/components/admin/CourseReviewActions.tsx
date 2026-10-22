'use client'
import { Check, CornerUpLeft } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, ICON, Textarea, useToast } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'

/** Approve a course (it opens to everyone it's meant for), or return it to the teacher with a note */
export function CourseReviewActions({ courseId, status }: { courseId: string; status: 'draft' | 'pending' | 'approved' | 'returned' }) {
  const { t } = useI18n()
  const router = useRouter()
  const toast = useToast()
  const [note, setNote] = useState('')
  const [returning, setReturning] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const decide = async (decision: 'approve' | 'return') => {
    setBusy(decision)
    const { ok, json } = await postJson(`/api/admin/courses/${courseId}`, { decision, note: decision === 'return' ? note : null })
    setBusy(null)
    if (!ok) return toast(json.error === 'reauth' ? t('admin.verify.title') : t('error.generic'))
    toast(t(decision === 'approve' ? 'adminCourses.approvedToast' : 'adminCourses.returnedToast'))
    setReturning(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border-2 border-orange-500 bg-orange-100 p-4">
      <p className="t-small text-ink-700">{t(status === 'approved' ? 'adminCourses.publishedHint' : 'adminCourses.checkHint')}</p>
      {returning ? (
        <>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('adminCourses.notePlaceholder')} minRows={2} maxRows={8} maxLength={2000} autoFocus />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => decide('return')} loading={busy === 'return'} icon={<CornerUpLeft size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
              {t(status === 'approved' ? 'adminCourses.unpublish' : 'adminCourses.return')}
            </Button>
            <Button variant="ghost" onClick={() => setReturning(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status !== 'approved' && (
            <Button onClick={() => decide('approve')} loading={busy === 'approve'} icon={<Check size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
              {t('adminCourses.approve')}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setReturning(true)} icon={<CornerUpLeft size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
            {t(status === 'approved' ? 'adminCourses.unpublish' : 'adminCourses.return')}
          </Button>
        </div>
      )}
    </div>
  )
}
