import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import type { MessageKey } from '@ikhimi/i18n'
import { ProgressBar, TaskIcon, TemperatureProvider, type TaskIconName } from '@ikhimi/ui/components'
import { AndroidDownload } from '@/components/AndroidDownload'
import { AppHeader } from '@/components/AppHeader'
import { band, CARD, CARD_HOT, SKILL_ICON } from '@/components/work/bands'
import { ChangeChip } from '@/components/work/ResultsCharts'
import { ScoreRing } from '@/components/work/ScoreRing'
import { ClassCard, type ClassHomework, type WorkItem } from '@/components/work/WorkCharts'
import { DueChip } from '@/components/work/DueChip'
import { JoinGroup } from '@/components/work/JoinGroup'
import { getT } from '@/i18n/server'
import { studentCourses } from '@/server/courses'
import { studentHomeworkByCourse } from '@/server/profiles'
import { getSession } from '@/server/request'
import { reviewSummary, syncReview } from '@/server/review'
import { studentDashboard, type StudentDashboard } from '@/server/student-dashboard'
import { studentStreak, type Streak } from '@/server/streak'

type T = Awaited<ReturnType<typeof getT>>['t']

/**
 * "내 숙제" (My work), the page students see most: only what matters now, in pictures. ⭐ and 🔥, the next
 * homework, a card per class (tap to see its homework), old mistakes, and a short "Natijalarim" that opens the full
 * analytics in Profile.
 */
export default async function MyWork() {
  const session = await getSession()
  if (!session) redirect('/signin?as=student&next=/work')
  const { t } = await getT()
  const db = getDb()
  const d = await studentDashboard(db, session.user)
  if (!d.progress) redirect('/')
  const myCourses = await studentCourses(db, session.user.id)
  const byClass = await studentHomeworkByCourse(db, session.user.id)
  // Old mistakes due again ("Xatolar ustida ishlash"): new ones join the list first
  await syncReview(db, session.user.id)
  const review = await reviewSummary(db, session.user.id)
  const streak = await studentStreak(db, session.user.id)

  // A card per class; homework from a link outside any class goes in one more card
  const classes: ClassHomework[] = byClass.courses.map((c) => ({ id: c.id, name: c.name, teacherName: c.teacherName, items: c.items.map((i) => ({ ...i, group: c.name })) }))
  if (byClass.outside.length) classes.push({ id: 'outside', name: t('work.otherHomework'), teacherName: null, items: byClass.outside.map((i) => ({ ...i, group: null })) })
  // The one to do next: started first, then the nearest deadline
  const next =
    classes
      .flatMap((c) => c.items)
      .filter((i) => i.status !== 'done')
      .sort((a, b) => (b.status === 'in_progress' ? 1 : 0) - (a.status === 'in_progress' ? 1 : 0) || (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity))[0] ?? null
  const anyHomework = classes.some((c) => c.items.length > 0)
  // The personal best place (a class whose teacher shows the ranking)
  const bestPlace = d.places.length ? d.places.reduce((a, b) => (b.place < a.place ? b : a)) : null

  return (
    <TemperatureProvider value="warm">
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6 pb-24">
        <h1 className="t-display-2">{t('nav.myWork')}</h1>
        {/* ⭐ 🔥 🏆: right answers, days in a row, and the best place in a class that shows its ranking */}
        <div className={`-mt-2 grid gap-2 ${bestPlace ? 'grid-cols-3' : 'grid-cols-2'}`}>
          <StarsCard stars={d.results.stars} t={t} />
          <StreakCard streak={streak} t={t} />
          {bestPlace && <PlaceCard place={bestPlace} t={t} />}
        </div>

        {next ? (
          <NextHomework item={next} t={t} />
        ) : (
          anyHomework && (
            <section className={`flex items-center gap-3 p-4 ${CARD}`}>
              <TaskIcon name="party-popper" size={40} />
              <span className="t-h3">{t('work.allDone')}</span>
            </section>
          )
        )}

        <section className="flex flex-col gap-3">
          <h2 className="t-h2">{t('work.homework')}</h2>
          {classes.length === 0 ? (
            <div className={`flex flex-col items-center gap-3 p-6 text-center ${CARD}`}>
              <TaskIcon name="books" size={48} />
              <p className="t-body text-ink-500">{t('work.empty')}</p>
            </div>
          ) : (
            classes.map((c) => <ClassCard key={c.id} c={c} />)
          )}
          {/* Join a group by its code: open straight away while there is no class yet (kept in place, so it still says
              which group was joined after the page refreshes) */}
          <JoinGroup open={classes.length === 0} />
        </section>

        {(review.due > 0 || review.next) && <ReviewCard due={review.due} t={t} />}

        {(d.trend.average ?? d.results.accuracy) !== null && (
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="t-h2">{t('work.results')}</h2>
              <Link href="/profile#analitika" className="t-small font-semibold text-ink-500 hover:text-ink-800">
                {t('work.details')} →
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Stat icon="memo" value={String(d.progress.completed)} label={t('work.statHomework')} />
              <Stat icon="stopwatch" value={shortDuration(d.progress.totalMinutes, t)} label={t('work.statTime')} />
              <Stat icon="bullseye" value={d.results.accuracy === null ? '—' : `${d.results.accuracy}%`} label={t('work.statCorrect')} />
            </div>
            <ResultsSummary d={d} t={t} />
          </section>
        )}

        {/* Online courses (bought, or free through a class): the only place the word "course" is used */}
        {myCourses.length > 0 && (
          <section className="flex flex-col gap-3">
            <h2 className="t-h2">{t('work.onlineCourses')}</h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {myCourses.map((c) => (
                <li key={c.id}>
                  <Link href={`/course/${c.slug}`} className={`press flex h-full flex-col gap-2 p-4 hover:bg-paper-200 ${CARD}`}>
                    <span className="flex items-center gap-2">
                      <TaskIcon name="graduation-cap" size={24} />
                      <span className="t-h3 min-w-0 flex-1 truncate">{c.title}</span>
                    </span>
                    {c.homework > 0 && (
                      <span className="flex items-center gap-2">
                        <span className="flex-1">
                          <ProgressBar value={c.done} max={c.homework} label={t('course.progress', { done: c.done, total: c.homework })} />
                        </span>
                        <span className="t-small t-num text-ink-500">
                          {c.done}/{c.homework}
                        </span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* The app download: last, so the homework comes first */}
        <AndroidDownload />
      </main>
    </TemperatureProvider>
  )
}

/** ⭐ every right answer ever (it only goes up), and this week's */
function StarsCard({ stars, t }: { stars: { total: number; thisWeek: number }; t: T }) {
  return (
    <div className={`relative flex min-w-0 flex-col gap-1.5 p-3 ${CARD}`} title={t('work.starsHint')}>
      {/* This week's, small in the corner */}
      {stars.thisWeek > 0 && <span className="t-caption t-num absolute right-2 top-1.5 font-bold text-score-strong">+{stars.thisWeek}</span>}
      <span className="flex items-center gap-1.5">
        <TaskIcon name="glowing-star" size={28} />
        <span className="t-h2 t-num leading-none">{stars.total.toLocaleString('ru-RU')}</span>
      </span>
      <span className="t-small truncate text-ink-500">{t('work.starsLabel')}</span>
    </div>
  )
}

/** 🔥 days in a row, and this week's seven dots (today ringed) */
function StreakCard({ streak, t }: { streak: Streak; t: T }) {
  const names = t('work.weekdays').split(',')
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 p-3 ${streak.today ? CARD_HOT : CARD}`} title={t('work.streakHint')}>
      <span className="flex items-center gap-1.5">
        <TaskIcon name="fire" size={28} className={streak.today ? '' : 'opacity-50 grayscale'} />
        <span className="t-h2 t-num leading-none" aria-label={t('work.streakLabel', { n: streak.days })}>
          {streak.days}
        </span>
      </span>
      <span className="flex min-h-5 items-center">
        <ol className="flex gap-1" aria-label={t('work.streakHint')}>
          {streak.week.map((d, i) => (
            <li
              key={d.day}
              title={names[i]}
              aria-label={`${names[i]}${d.active ? ' ✓' : ''}`}
              className={`size-2 rounded-full ${d.active ? 'bg-orange-500' : d.future ? 'border border-paper-400' : 'bg-paper-300'} ${d.isToday ? 'ring-2 ring-ink-700 ring-offset-1 ring-offset-paper-50' : ''}`}
            />
          ))}
        </ol>
      </span>
    </div>
  )
}

/** The one thing to do now */
function NextHomework({ item, t }: { item: WorkItem; t: T }) {
  return (
    <section className={`flex flex-col gap-3 p-5 ${CARD_HOT}`}>
      <div className="flex items-center justify-between gap-2">
        <TaskIcon name="rocket" size={32} />
        <DueChip dueAt={item.dueAt} />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="t-h2">{item.title}</span>
        {item.group && <span className="t-small text-ink-500">{item.group}</span>}
      </div>
      <Link href={`/t/${item.slug}`} className="btn btn-primary btn-lg w-full">
        <span className="btn-label">{t(item.status === 'in_progress' ? 'course.continue' : 'course.start')} →</span>
      </Link>
    </section>
  )
}

/** Old mistakes, with the 🦉 */
function ReviewCard({ due, t }: { due: number; t: T }) {
  return (
    <Link href={due > 0 ? '/work/review' : '/work/mistakes'} className={`press flex items-center gap-4 p-4 ${due > 0 ? `${CARD_HOT} bg-gradient-to-r from-orange-100 to-paper-50` : CARD}`}>
      <TaskIcon name="owl" size={56} />
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="t-h3">{t('review.title')}</span>
        {due > 0 ? (
          <span className="btn btn-primary btn-md self-start">
            <span className="btn-label">
              {t('review.start')} · <span className="t-num">{due}</span>
            </span>
          </span>
        ) : (
          <span className="t-small text-ink-500">{t('work.reviewLater')}</span>
        )}
      </span>
    </Link>
  )
}

/**
 * The short results card: the average in a ring, up or down, one sentence, the best skill and the one to work on.
 * The whole card opens the full analytics in Profile.
 */
function ResultsSummary({ d, t }: { d: StudentDashboard; t: T }) {
  const avg = d.trend.average ?? d.results.accuracy
  if (avg === null) return null
  const { change } = d.trend
  const message: MessageKey =
    change !== null && change > 0 ? 'work.msgUp' : change !== null && change < 0 ? 'work.msgDown' : ({ strong: 'work.msgStrong', mid: 'work.msgMid', low: 'work.msgLow' } as const)[band(avg)]
  const chip = `t-small inline-flex min-w-0 items-center gap-1.5 rounded-pill border-2 border-paper-300 bg-paper-50 px-2.5 py-1 font-semibold`
  return (
    <Link href="/profile#analitika" className={`press flex flex-col gap-3 p-4 hover:bg-paper-200 ${CARD}`}>
      <span className="flex items-center gap-4">
        <ScoreRing percent={avg} size={84}>
          <span className="t-h3 t-num">{avg}%</span>
        </ScoreRing>
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <ChangeChip change={change} title={t('work.changeHint')} />
          <span className="t-body text-ink-700">{t(message)}</span>
        </span>
      </span>
      {(d.best || d.weak) && (
        <span className="flex flex-wrap gap-2">
          {d.best && (
            <span className={chip} title={t('work.strengths')}>
              <TaskIcon name="flexed-biceps" size={16} />
              <TaskIcon name={SKILL_ICON[d.best.skill] ?? 'star'} size={16} />
              <span className="truncate">{t(`skill.${d.best.skill}` as MessageKey)}</span>
              <span className="t-num">{d.best.percent}%</span>
            </span>
          )}
          {d.weak && (
            <span className={chip} title={t('work.attention')}>
              <TaskIcon name="bullseye" size={16} />
              <TaskIcon name={SKILL_ICON[d.weak.skill] ?? 'star'} size={16} />
              <span className="truncate">{t(`skill.${d.weak.skill}` as MessageKey)}</span>
              <span className="t-num">{d.weak.percent}%</span>
            </span>
          )}
        </span>
      )}
    </Link>
  )
}

/** 🏆 the best place in a class with a visible ranking: the place big, the class small */
function PlaceCard({ place, t }: { place: StudentDashboard['places'][number]; t: T }) {
  return (
    <Link
      href="/profile#analitika"
      className={`press flex min-w-0 flex-col gap-1.5 p-3 ${place.place <= 3 ? CARD_HOT : CARD}`}
      title={`${t('work.placeLabel', { place: place.place, group: place.groupName })} · ${t('work.placeHint', { of: place.of })}`}
    >
      <span className="flex items-center gap-1.5">
        <TaskIcon name={place.place === 1 ? 'trophy' : 'sports-medal'} size={28} />
        <span className="t-h2 t-num leading-none">{place.place}</span>
      </span>
      <span className="t-small truncate text-ink-500">{place.groupName}</span>
    </Link>
  )
}

function Stat({ icon, value, label }: { icon: TaskIconName; value: string; label: string }) {
  return (
    <div className={`flex min-w-0 flex-col items-center gap-1 p-3 text-center ${CARD}`}>
      <TaskIcon name={icon} size={28} />
      <span className="t-h3 t-num whitespace-nowrap leading-tight">{value}</span>
      <span className="t-small text-ink-500">{label}</span>
    </div>
  )
}

/** Short enough for a third of a phone: "45분", "74분", then whole hours "3시간"; nothing recorded: "—" */
function shortDuration(minutes: number, t: T) {
  if (minutes <= 0) return '—'
  if (minutes < 100) return t('work.minutes', { n: minutes })
  return t('work.hours', { n: Math.round(minutes / 60) })
}
