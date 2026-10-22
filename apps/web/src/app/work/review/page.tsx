import { redirect } from 'next/navigation'
import { getDb } from '@ikhimi/db'
import { TemperatureProvider } from '@ikhimi/ui/components'
import { ReviewRunner } from '@/components/ReviewRunner'
import { getSession } from '@/server/request'
import { dueReview, syncReview } from '@/server/review'

/** "Xatolar ustida ishlash": the student's old mistakes due again, one at a time, never scored */
export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  // Opened from the mistakes page (the apps' Xatolar tab): back there, not to My work
  const fromMistakes = (await searchParams).from === 'mistakes'
  const session = await getSession()
  if (!session) redirect('/signin?as=student&next=/work/review')
  const db = getDb()
  await syncReview(db, session.user.id)
  const items = await dueReview(db, session.user.id)
  // Nothing this student can review right now: the mistakes page says why (when the next come, what a plan opens)
  if (!items.length) redirect('/work/mistakes')
  return (
    <TemperatureProvider value="warm">
      <ReviewRunner items={items} back={fromMistakes ? { href: '/work/mistakes', label: 'review.backMistakes' } : undefined} />
    </TemperatureProvider>
  )
}
