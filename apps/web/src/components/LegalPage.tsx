import { AppHeader } from '@/components/AppHeader'
import { legalDoc, type DocId } from '@/content/legal'
import { SITE } from '@/content/site'
import { getT } from '@/i18n/server'

/** Shared layout for privacy, terms, about and help: readable measure, numbered sections, version line. */
export async function LegalPage({ id, children }: { id: DocId; children?: React.ReactNode }) {
  const { locale, t } = await getT()
  const doc = legalDoc(id, locale)
  const versioned = id === 'privacy' || id === 'terms'
  return (
    <>
      <AppHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 pb-16">
        <div>
          <h1 className="t-display-1">{doc.title}</h1>
          {versioned && (
            <p className="t-small t-num mt-2 text-ink-500">{t('legal.version', { v: SITE.legalVersion, date: SITE.legalUpdated })}</p>
          )}
          <hr className="rule-gold mt-4 w-16" />
        </div>
        {versioned && <p className="t-small rounded-md border border-warn-600 bg-warn-100 px-4 py-3 text-warn-600">{t('legal.draft')}</p>}
        <p className="t-body-lg measure text-ink-700">{doc.intro}</p>
        {children}
        {doc.sections.map((s) => (
          <section key={s.h} className="measure flex flex-col gap-2">
            <h2 className="t-h2">{s.h}</h2>
            {s.p.map((para, i) => (
              <p key={i} className="t-body text-ink-700">
                {para}
              </p>
            ))}
          </section>
        ))}
      </main>
    </>
  )
}
