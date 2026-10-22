import QRCode from 'qrcode'
import { and, CONFIG, eq, getDb, groups, inArray, isNull, materials } from '@ikhimi/db'
import { AppHeader } from '@/components/AppHeader'
import { AssignmentEditor, type EditorExercise } from '@/components/AssignmentEditor'
import { SharePanel } from '@/components/SharePanel'
import { buildReport, loadExercises } from '@/server/assignments'
import { studentDue } from '@/server/deadline'
import { requireTeacherAssignment, shareUrl } from '@/server/pages'
import { examById } from '@ikhimi/ai'

/** "IELTS Academic · Band 6.5" for a draft written in a style: a catalog exam, or the owner's own methodology */
function examStyleLabel(meta: unknown) {
  const m = (meta ?? {}) as { exam?: { id: string; level: string; name?: string } }
  const name = examById(m.exam?.id)?.name ?? m.exam?.name
  return name ? `${name}${m.exam!.level ? ` · ${m.exam!.level}` : ''}` : null
}

export default async function AssignmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { a } = await requireTeacherAssignment((await params).id)
  const db = getDb()
  const rows = await loadExercises(db, a.id)
  const audioIds = [...new Set(rows.map((r) => r.audioMaterialId).filter((x): x is string => !!x))]
  const audioNames = new Map(
    audioIds.length ? (await db.select({ id: materials.id, name: materials.originalFilename }).from(materials).where(inArray(materials.id, audioIds))).map((m) => [m.id, m.name ?? '']) : [],
  )
  const exercises: EditorExercise[] = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    prompt: (r.prompt as { text?: string }).text ?? '',
    payload: r.payload as Record<string, unknown>,
    answerKey: r.answerKey as Record<string, unknown>,
    points: r.points,
    explanation: r.explanation,
    sourceRef: r.sourceRef,
    flags: r.verifyFlags,
    reviewNote: r.rationale,
    skill: r.skillTags[0] ?? 'grammar',
    audioLabel: r.audioLabel,
    audioUrl: r.audioMaterialId ? `/api/audio/${r.id}` : null,
    imageUrl: (r.payload as { imageId?: string }).imageId ? `/api/pictures/${r.id}` : null,
    audioName: r.audioMaterialId ? (audioNames.get(r.audioMaterialId) ?? null) : null,
    answerSource: r.answerSource,
  }))
  const skipped = ((a.generationMeta ?? {}) as { skipped?: { ref: string; reason: string }[] }).skipped ?? []

  const teacherGroups = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(and(eq(groups.teacherId, a.teacherId), isNull(groups.archivedAt), isNull(groups.deletedAt)))

  let share: React.ReactNode = null
  if (a.status !== 'draft') {
    const url = shareUrl(a.shareSlug)
    // High error correction so the centre cap mark doesn't break scanning (design spec §11)
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 0, width: 240, errorCorrectionLevel: 'H' })
    const report = await buildReport(db, a)
    const [g] = a.groupId ? await db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.id, a.groupId)).limit(1) : []
    share = <SharePanel assignmentId={a.id} url={url} qrSvg={qrSvg} counts={report.counts} group={g ?? null} dueDays={a.dueDays} groupDue={studentDue(a)?.toISOString() ?? null} otherGroups={teacherGroups.filter((x) => x.id !== a.groupId)} />
  }

  return (
    <>
      <AppHeader />
      <main>
        {share}
        <AssignmentEditor
          assignment={{
            id: a.id,
            title: a.title,
            instructions: a.instructions,
            rationale: ((a.generationMeta ?? {}) as { rationale?: string }).rationale ?? '',
            examStyle: examStyleLabel(a.generationMeta),
            estimatedMinutes: a.estimatedMinutes ?? 0,
            totalPoints: a.totalPoints ?? 0,
            status: a.status,
            showAnswersAfter: ((a.settings ?? {}) as { showAnswersAfter?: 'submit' | 'never' }).showAnswersAfter ?? 'submit',
          }}
          exercises={exercises}
          skipped={skipped}
          digitized={((a.generationMeta ?? {}) as { mode?: string }).mode === 'digitize'}
          maxAnswerPages={CONFIG.maxAnswerPages}
          groups={a.status === 'draft' ? teacherGroups : []}
        />
      </main>
    </>
  )
}
