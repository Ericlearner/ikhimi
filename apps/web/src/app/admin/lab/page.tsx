import { asc, getDb, isNotNull, isNull, methodologies } from '@ikhimi/db'
import { EXAMS, examById, LAB_LIMITS, labCoverage, LANGUAGE_NAME, type LabTask, type LanguageCode } from '@ikhimi/ai'
import { formatDate } from '@ikhimi/i18n'
import { Badge } from '@ikhimi/ui/components'
import { LabMethodologyForm, LabPicker, LabWorkspace, type ChatMessage, type PickerItem } from '@/components/admin/Lab'
import { pageStaff } from '@/server/admin/guard'
import { examMethodology, labThread } from '@/server/lab'

const CARD = 'rounded-2xl border-2 border-paper-300 bg-paper-50'

/**
 * The Lab (DECISIONS.md BG, BH): the owner improves one methodology at a time — a catalog exam (IELTS, TOEFL…) or
 * one of their own — by showing it real samples, giving it resources and talking to it. Only what the owner applies
 * is kept, and the brain shows how much of it is understood; Create aims the homework at it whenever a teacher picks
 * that style. The owner's private workshop, always in English.
 */
export default async function AdminLab({ searchParams }: { searchParams: Promise<{ m?: string; new?: string }> }) {
  const db = getDb()
  await pageStaff(db, 'staff')
  const sp = await searchParams
  const [own, known] = await Promise.all([
    db.select().from(methodologies).where(isNull(methodologies.examId)).orderBy(asc(methodologies.name)),
    db.select({ examId: methodologies.examId, points: methodologies.points, tasks: methodologies.tasks, samples: methodologies.samples }).from(methodologies).where(isNotNull(methodologies.examId)),
  ])
  // The picker shows how much each one understands, once its brain shows
  const brain = (m: { points: typeof methodologies.$inferSelect.points; tasks: typeof methodologies.$inferSelect.tasks; samples: typeof methodologies.$inferSelect.samples }) => {
    const c = labCoverage({ points: m.points, tasks: m.tasks as LabTask[], samples: m.samples })
    return { points: m.points.length, brain: c.ready ? c.pct : null }
  }
  const exams = new Map(known.map((k) => [k.examId!, brain(k)]))
  const items: PickerItem[] = [
    ...EXAMS.map((e) => ({ id: e.id, name: e.name, language: e.language, own: false, visible: true, ...(exams.get(e.id) ?? { points: 0, brain: null }) })),
    ...own.map((o) => ({ id: o.id, name: o.name, language: o.language, own: true, visible: o.visible, ...brain(o) })),
  ].sort((a, b) => order(a.language) - order(b.language))

  const creating = sp.new === '1'
  const wanted = sp.m ?? EXAMS[0]!.id
  const m = creating ? null : examById(wanted) ? await examMethodology(db, wanted) : (own.find((o) => o.id === wanted) ?? (await examMethodology(db, EXAMS[0]!.id)))
  const exam = m?.examId ? examById(m.examId) : null
  const { thread, history } = m ? await labThread(db, m.id) : { thread: [], history: [] }
  const messages: ChatMessage[] = thread.map((x) => ({ id: x.id, role: x.role, text: x.text, files: x.files, sample: x.sample, proposal: x.proposal as ChatMessage['proposal'] }))

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="t-body max-w-3xl text-ink-700">
        Pick a methodology, show it {LAB_LIMITS.samples} real samples (past exams), then feed it books and guides. The Lab keeps only what’s new and useful, in our own words, after you apply it; the files are deleted once read. When a
        teacher picks that style in Create, the homework aims at what it knows, with easier steps and preparation for lower levels.
      </p>
      <LabPicker items={items} current={m && !creating ? (m.examId ?? m.id) : null} />

      {creating || !m ? (
        <section className={`flex flex-col gap-3 p-4 ${CARD}`}>
          <h2 className="t-h2">New methodology</h2>
          <LabMethodologyForm />
        </section>
      ) : (
        <>
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="t-h1">{m.name}</h2>
              <Badge>{LANGUAGE_NAME[m.language as LanguageCode] ?? m.language}</Badge>
              {exam ? <Badge>Exam style</Badge> : <Badge tone="orange">Yours</Badge>}
              {!exam && <Badge tone={m.visible ? 'success' : 'neutral'}>{m.visible ? 'Teachers can pick it' : 'Hidden from teachers'}</Badge>}
              <span className="t-small t-num text-ink-500">Used in {m.usedCount} homework{m.usedCount === 1 ? '' : 's'}</span>
            </div>
            {exam && (
              <details className="t-small max-w-3xl text-ink-500">
                <summary className="cursor-pointer">What the writers already know about {exam.name} (built in)</summary>
                <p className="mt-2 whitespace-pre-wrap">{exam.guidance}</p>
              </details>
            )}
            {!exam && (
              <details className={`max-w-3xl p-4 ${CARD}`}>
                <summary className="t-h3 cursor-pointer">Settings</summary>
                <div className="mt-3">
                  <LabMethodologyForm initial={{ id: m.id, name: m.name, language: m.language, levels: m.levels, about: m.about, visible: m.visible }} />
                </div>
              </details>
            )}
          </header>
          <LabWorkspace
            key={m.id}
            methodologyId={m.id}
            name={m.name}
            exam={!!exam}
            messages={messages}
            points={m.points}
            tasks={m.tasks as LabTask[]}
            samples={m.samples}
            history={history.map((h) => ({ id: h.id, note: h.note, at: formatDate(h.createdAt) }))}
          />
        </>
      )}
    </div>
  )
}

/** English first, then the order of the catalog's languages */
const LANGS = ['en', 'ja', 'zh', 'de', 'fr', 'es', 'ru', 'tr', 'ar', 'ko']
const order = (l: string) => (LANGS.indexOf(l) + 1 || 99)
