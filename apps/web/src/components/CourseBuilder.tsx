'use client'
import { ArrowDown, ArrowUp, BookOpenCheck, Check, CheckCircle2, Clock, Copy, CornerUpLeft, ExternalLink, Eye, Pencil, Plus, Send, Trash2, Video } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Badge, Button, ICON, IconButton, Input, SegmentedControl, Switch, Textarea, useToast } from '@ikhimi/ui/components'
import { play } from '@ikhimi/ui/sound'
import { fieldClass } from '@/components/GroupDetailsFields'
import { useI18n } from '@/i18n/client'
import { postJson } from '@/lib/client'
import { parseVideoUrl } from '@/lib/video'

type Visibility = 'private' | 'unlisted' | 'marketplace'
type CourseForm = { id: string; slug: string; url: string; title: string; description: string; cefrLevel: string; visibility: Visibility; paid: boolean; price: string }
type Review = { status: 'draft' | 'pending' | 'approved' | 'returned'; note: string | null }
type Lesson = { id: string; title: string; videoUrl: string; videoNote: string; assignmentId: string; isPreview: boolean }
type LessonDraft = Omit<Lesson, 'id'>

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']
const label = 't-small flex flex-col gap-1 font-medium text-ink-500'
const emptyLesson = (): LessonDraft => ({ title: '', videoUrl: '', videoNote: '', assignmentId: '', isPreview: false })

export function CourseBuilder({
  course,
  review,
  rules,
  lessons,
  homework,
  groups,
  linkedGroupIds,
}: {
  course: CourseForm
  /** The admin's approval, needed once to open the course to others (DECISIONS.md BL) */
  review: Review
  /** Paid courses: the lowest price, and the teacher's share of each sale */
  rules: { minPriceKrw: number; maxPriceKrw: number; sharePercent: number }
  lessons: Lesson[]
  homework: { id: string; title: string }[]
  groups: { id: string; name: string }[]
  linkedGroupIds: string[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const toast = useToast()
  const [form, setForm] = useState(course)
  const [savingDetails, setSavingDetails] = useState(false)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [copied, setCopied] = useState(false)
  const [linked, setLinked] = useState(linkedGroupIds)
  const [submitting, setSubmitting] = useState(false)
  const dirty = JSON.stringify(form) !== JSON.stringify(course)
  const price = Number(form.price.replace(/\D/g, ''))
  const badPrice = form.paid && (!price || price < rules.minPriceKrw || price > rules.maxPriceKrw)
  const published = form.visibility !== 'private' && review.status === 'approved'

  const saveDetails = async () => {
    setSavingDetails(true)
    const { ok } = await postJson(
      `/api/courses/${course.id}`,
      { title: form.title, description: form.description, cefrLevel: form.cefrLevel || null, visibility: form.visibility, priceKrw: form.paid ? price : null },
      'PATCH',
    )
    setSavingDetails(false)
    if (!ok) return toast(t('error.generic'))
    toast(t('course.saved'))
    router.refresh()
  }

  const submit = async () => {
    setSubmitting(true)
    const { ok, json } = await postJson(`/api/courses/${course.id}/submit`, {})
    setSubmitting(false)
    if (!ok) return toast(t(json.error === 'no_lessons' ? 'courseReview.needLesson' : 'error.generic'))
    play('publish.success')
    router.refresh()
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(course.url)
      play('copy')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const move = async (i: number, d: -1 | 1) => {
    const ids = lessons.map((l) => l.id)
    ;[ids[i], ids[i + d]] = [ids[i + d]!, ids[i]!]
    await postJson(`/api/courses/${course.id}/lessons/order`, { ids })
    router.refresh()
  }

  const remove = async (id: string) => {
    const res = await fetch(`/api/courses/${course.id}/lessons/${id}`, { method: 'DELETE' })
    if (!res.ok) return toast(t('error.generic'))
    router.refresh()
  }

  const toggleGroup = async (id: string) => {
    const next = linked.includes(id) ? linked.filter((x) => x !== id) : [...linked, id]
    setLinked(next)
    const { ok } = await postJson(`/api/courses/${course.id}/groups`, { groupIds: next }, 'PUT')
    if (!ok) {
      setLinked(linked)
      toast(t('error.generic'))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Public link: works for others once the admin approved the course */}
      {published && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
          <span className="t-small font-medium text-ink-500">{t('course.link')}</span>
          <code className="t-body break-all rounded-md bg-paper-200 px-3 py-2 font-semibold text-ink-800">{course.url}</code>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={copy} icon={copied ? <Check size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> : <Copy size={16} strokeWidth={ICON.strokeWidth} aria-hidden />}>
              {copied ? t('share.copied') : t('action.copyLink')}
            </Button>
            <a href={`/course/${course.slug}`} target="_blank" rel="noopener" className="btn btn-ghost btn-sm">
              <span className="btn-label">
                <ExternalLink size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('course.view')}
              </span>
            </a>
          </div>
        </section>
      )}

      {/* Details */}
      <section className="flex flex-col gap-3 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
        <h2 className="t-h2">{t('course.details')}</h2>
        <label className={label}>
          {t('course.title')}
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={120} />
        </label>
        <label className={label}>
          {t('course.description')}
          <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={t('course.descriptionPlaceholder')} minRows={3} maxRows={10} maxLength={4000} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={label}>
            {t('course.level')}
            <select value={form.cefrLevel} onChange={(e) => setForm({ ...form, cefrLevel: e.target.value })} className={fieldClass}>
              <option value="">—</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <span className="t-small font-medium text-ink-500">{t('course.visibility')}</span>
          <SegmentedControl
            label={t('course.visibility')}
            value={form.visibility}
            onChange={(v) => setForm({ ...form, visibility: v })}
            options={(['private', 'unlisted', 'marketplace'] as const).map((v) => ({ value: v, label: t(`course.visibility.${v}`) }))}
          />
          <span className="t-small text-ink-400">{t(`course.visibilityHint.${form.visibility}`)}</span>
        </div>
        {/* Plan-covered or paid: only matters for a course open to others */}
        {form.visibility !== 'private' && (
          <div className="flex flex-col gap-2">
            <span className="t-small font-medium text-ink-500">{t('courseSale.pricing')}</span>
            <SegmentedControl
              label={t('courseSale.pricing')}
              value={form.paid ? 'paid' : 'plan'}
              onChange={(v) => setForm({ ...form, paid: v === 'paid' })}
              options={[
                { value: 'plan', label: t('courseSale.planCovered') },
                { value: 'paid', label: t('courseSale.paid') },
              ]}
            />
            <span className="t-small text-ink-400">{form.paid ? t('courseSale.paidHint', { n: rules.sharePercent }) : t('courseSale.planCoveredHint')}</span>
            {form.paid && (
              <label className={label}>
                {t('courseSale.price')}
                <span className="flex items-center gap-2">
                  <Input
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value.replace(/[^\d\s]/g, '') })}
                    inputMode="numeric"
                    placeholder="150 000"
                    invalid={!!form.price && badPrice}
                    className="max-w-48"
                  />
                  <span className="t-body text-ink-700">원</span>
                </span>
                <span className={`font-normal ${form.price && badPrice ? 'text-error-600' : 'text-ink-400'}`}>
                  {t('courseSale.priceHint', { min: rules.minPriceKrw.toLocaleString('ru-RU'), n: rules.sharePercent, share: price && !badPrice ? Math.round((price * rules.sharePercent) / 100).toLocaleString('ru-RU') : '—' })}
                </span>
              </label>
            )}
          </div>
        )}
        <Button onClick={saveDetails} loading={savingDetails} disabled={!dirty || !form.title.trim() || badPrice} className="self-start">
          {t('action.save')}
        </Button>
      </section>

      {/* Publishing: the admin approves a course once before others can see it */}
      {course.visibility !== 'private' && (
        <section
          className={`flex flex-col gap-2 rounded-2xl border-2 p-4 ${review.status === 'approved' ? 'border-success-600 bg-success-100' : review.status === 'returned' ? 'border-orange-500 bg-orange-100' : 'border-paper-300 bg-paper-50'}`}
        >
          {review.status === 'approved' ? (
            <p className="t-body flex items-start gap-2 text-ink-800">
              <CheckCircle2 size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-success-600" aria-hidden /> {t('courseReview.approved')}
            </p>
          ) : review.status === 'pending' ? (
            <p className="t-body flex items-start gap-2 text-ink-800">
              <Clock size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-orange-700" aria-hidden /> {t('courseReview.pending')}
            </p>
          ) : (
            <>
              {review.status === 'returned' && (
                <p className="t-body flex items-start gap-2 text-ink-800">
                  <CornerUpLeft size={20} strokeWidth={ICON.strokeWidth} className="mt-0.5 shrink-0 text-orange-700" aria-hidden />
                  <span>
                    {t('courseReview.returned')}
                    {review.note && <span className="mt-1 block whitespace-pre-line text-ink-700">«{review.note}»</span>}
                  </span>
                </p>
              )}
              <p className="t-small text-ink-500">{t('courseReview.why')}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={submit} loading={submitting} disabled={dirty || lessons.length === 0} icon={<Send size={18} strokeWidth={ICON.strokeWidth} aria-hidden />}>
                  {review.status === 'returned' ? t('courseReview.resubmit') : t('courseReview.submit')}
                </Button>
                {/* How students will see it (the owner can open it before approval) */}
                <a href={`/course/${course.slug}`} target="_blank" rel="noopener" className="btn btn-ghost btn-md">
                  <span className="btn-label">
                    <ExternalLink size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('course.view')}
                  </span>
                </a>
              </div>
              {lessons.length === 0 && <p className="t-small text-ink-400">{t('courseReview.needLesson')}</p>}
            </>
          )}
        </section>
      )}

      {/* Lessons */}
      <section className="flex flex-col gap-3">
        <h2 className="t-h1">{t('course.lessons')}</h2>
        {lessons.length === 0 && editing !== 'new' && <p className="t-body rounded-2xl border-2 border-paper-300 bg-paper-50 p-4 text-ink-500">{t('course.noLessons')}</p>}
        <ol className="flex flex-col gap-2">
          {lessons.map((l, i) =>
            editing === l.id ? (
              <li key={l.id}>
                <LessonForm courseId={course.id} lessonId={l.id} initial={l} homework={homework} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={l.id} className="group flex flex-col gap-2 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
                <div className="flex items-start gap-3">
                  <span className="t-h3 t-num w-6 shrink-0 text-ink-500">{i + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <span className="t-h3">{l.title}</span>
                    <span className="flex flex-wrap gap-1.5">
                      {l.videoUrl && <Badge icon={<Video size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{t('lesson.video.badge')}</Badge>}
                      {l.assignmentId && (
                        <Badge icon={<BookOpenCheck size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>{homework.find((h) => h.id === l.assignmentId)?.title ?? t('lesson.homework')}</Badge>
                      )}
                      {l.isPreview && (
                        <Badge tone="orange" icon={<Eye size={14} strokeWidth={ICON.strokeWidth} aria-hidden />}>
                          {t('lesson.preview')}
                        </Badge>
                      )}
                    </span>
                  </div>
                  <span className="flex shrink-0 gap-0.5">
                    <IconButton label={t('action.edit')} size={36} onClick={() => setEditing(l.id)}>
                      <Pencil size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={`↑ ${i + 1}`} size={36} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={`↓ ${i + 1}`} size={36} disabled={i === lessons.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                    <IconButton label={t('action.delete')} size={36} onClick={() => remove(l.id)} className="hover:text-error-600">
                      <Trash2 size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
                    </IconButton>
                  </span>
                </div>
              </li>
            ),
          )}
        </ol>
        {editing === 'new' ? (
          <LessonForm courseId={course.id} initial={emptyLesson()} homework={homework} onDone={() => setEditing(null)} />
        ) : (
          <Button variant="secondary" onClick={() => setEditing('new')} icon={<Plus size={18} strokeWidth={ICON.strokeWidth} aria-hidden />} className="self-start">
            {t('course.addLesson')}
          </Button>
        )}
      </section>

      {/* Groups get it free */}
      {groups.length > 0 && (
        <section className="flex flex-col gap-2 rounded-2xl border-2 border-paper-300 bg-paper-50 p-4">
          <h2 className="t-h3">{t('course.groups')}</h2>
          <p className="t-small text-ink-500">{t('course.groupsHint')}</p>
          <ul className="flex flex-col gap-1">
            {groups.map((g) => (
              <li key={g.id}>
                <label className="t-body flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="checkbox" checked={linked.includes(g.id)} onChange={() => toggleGroup(g.id)} className="size-5 accent-orange-500" />
                  {g.name}
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function LessonForm({
  courseId,
  lessonId,
  initial,
  homework,
  onDone,
}: {
  courseId: string
  lessonId?: string
  initial: LessonDraft
  homework: { id: string; title: string }[]
  onDone: () => void
}) {
  const { t } = useI18n()
  const router = useRouter()
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const video = parseVideoUrl(v.videoUrl)
  const badVideo = !!v.videoUrl.trim() && !video

  const save = async () => {
    setBusy(true)
    setError(null)
    const body = { title: v.title, videoUrl: v.videoUrl || null, videoNote: v.videoNote || null, assignmentId: v.assignmentId || null, isPreview: v.isPreview }
    const { ok } = lessonId ? await postJson(`/api/courses/${courseId}/lessons/${lessonId}`, body, 'PATCH') : await postJson(`/api/courses/${courseId}/lessons`, body)
    setBusy(false)
    if (!ok) return setError(t('error.generic'))
    onDone()
    router.refresh()
  }

  return (
    <div className="slide-down flex flex-col gap-3 rounded-lg border-2 border-orange-500 bg-paper-50 p-4 shadow-e2">
      <label className={label}>
        {t('lesson.title')}
        <Input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} maxLength={160} autoFocus />
      </label>
      <label className={label}>
        {t('lesson.video')}
        <Input value={v.videoUrl} onChange={(e) => setV({ ...v, videoUrl: e.target.value })} placeholder="https://youtu.be/…" inputMode="url" invalid={badVideo} />
        <span className={`font-normal ${badVideo ? 'text-error-600' : 'text-ink-400'}`}>{badVideo ? t('lesson.videoBad') : t('lesson.videoHint')}</span>
      </label>
      {video && (
        <div className="aspect-video w-full overflow-hidden rounded-md bg-ink-900">
          <iframe src={video.embedUrl} title={v.title || 'video'} className="size-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen loading="lazy" />
        </div>
      )}
      <label className={label}>
        {t('lesson.notes')}
        <Textarea value={v.videoNote} onChange={(e) => setV({ ...v, videoNote: e.target.value })} minRows={3} maxRows={12} maxLength={8000} />
      </label>
      <label className={label}>
        {t('lesson.homework')}
        <select value={v.assignmentId} onChange={(e) => setV({ ...v, assignmentId: e.target.value })} className={fieldClass}>
          <option value="">{t('lesson.noHomework')}</option>
          {homework.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title}
            </option>
          ))}
        </select>
        <span className="font-normal text-ink-400">{t('lesson.homeworkHint')}</span>
      </label>
      <Switch checked={v.isPreview} onChange={(c) => setV({ ...v, isPreview: c })} label={t('lesson.preview')} description={t('lesson.previewHint')} />
      {error && (
        <p role="alert" className="t-small text-error-600">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={save} loading={busy} disabled={!v.title.trim() || badVideo}>
          {t('action.save')}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
