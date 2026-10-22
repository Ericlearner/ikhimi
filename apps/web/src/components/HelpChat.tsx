'use client'
import { ArrowUp, Headset, MessageCircleQuestionMark, RotateCcw, Send, X } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MessageKey } from '@ikhimi/i18n'
import { Button, buttonClass, ICON, IconButton } from '@ikhimi/ui/components'
import { useI18n } from '@/i18n/client'
import type { HelpPlace } from '@/content/help-guide'

type Msg =
  | { role: 'teacher'; text: string }
  | { role: 'assistant'; text: string; links?: { href: string; label: string }[]; unknown?: boolean }
  /** What the chat itself says (sent to the team, a limit, an error): never sent to the AI */
  | { role: 'note'; text: string; tone?: 'warn'; telegram?: boolean }

const SUGGEST: Record<HelpPlace, MessageKey[]> = {
  home: ['help.suggest.home.1', 'help.suggest.home.2', 'help.suggest.home.3'],
  draft: ['help.suggest.draft.1', 'help.suggest.draft.2', 'help.suggest.draft.3'],
  report: ['help.suggest.report.1', 'help.suggest.report.2', 'help.suggest.home.3'],
  group: ['help.suggest.group.1', 'help.suggest.group.2', 'help.suggest.home.2'],
  course: ['help.suggest.course.1', 'help.suggest.course.2', 'help.suggest.home.1'],
  other: ['help.suggest.home.1', 'help.suggest.home.2', 'help.suggest.home.3'],
}

/** Which suggestions fit the page (the server works out the page again for the AI: content/help-guide.ts helpPlace) */
function placeOf(path: string): HelpPlace {
  if (path === '/app') return 'home'
  if (/^\/app\/a\/[^/]+\/report$/.test(path)) return 'report'
  if (/^\/app\/a\/[^/]+$/.test(path)) return 'draft'
  if (path.startsWith('/app/groups')) return 'group'
  if (path.startsWith('/app/courses')) return 'course'
  return 'other'
}

/**
 * How far up the corner button must sit: above whatever is docked at the bottom of the screen (the apps' tab bar, the
 * draft's publish bar, the composer on a phone), so it never covers a button there.
 */
function useBottomClearance() {
  const [px, setPx] = useState(0)
  const measure = useCallback(() => {
    const h = window.innerHeight
    let top = h
    document.querySelectorAll<HTMLElement>('.app-tabbar, [data-bottom-dock]').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (r.height && r.bottom >= h - 4 && r.top < h) top = Math.min(top, r.top)
    })
    setPx(Math.max(0, Math.round(h - top)))
  }, [])
  useEffect(() => {
    let frame = 0
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    later()
    const ro = new ResizeObserver(later)
    ro.observe(document.body)
    window.addEventListener('scroll', later, { passive: true })
    window.addEventListener('resize', later)
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      window.removeEventListener('scroll', later)
      window.removeEventListener('resize', later)
    }
  }, [measure])
  return px
}

/**
 * The teachers' help chat (DECISIONS.md BN): a small button in the corner of every teacher page opens a chat that
 * answers how to use 익히미, from the guide. The conversation stays in this tab (sessionStorage); the server keeps
 * only each question's topic. "Jamoaga yozish" sends the conversation to the team in Telegram.
 */
export function HelpChat({ userId, supportUrl }: { userId: string; supportUrl: string }) {
  const { t } = useI18n()
  const path = usePathname()
  const clearance = useBottomClearance()
  const storeKey = `tl_help:${userId}`
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'ask' | 'handoff' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const fab = useRef<HTMLButtonElement>(null)

  // The conversation survives moving between pages and reloads in this tab, not a new browser session
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storeKey)
      if (saved) setMsgs(JSON.parse(saved) as Msg[])
    } catch {}
  }, [storeKey])
  useEffect(() => {
    try {
      if (msgs.length) sessionStorage.setItem(storeKey, JSON.stringify(msgs.slice(-30)))
      else sessionStorage.removeItem(storeKey)
    } catch {}
  }, [msgs, storeKey])

  useLayoutEffect(() => {
    if (open) list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [open, msgs, busy, confirming])

  useEffect(() => {
    if (!open) return
    input.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      fab.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  /** The conversation the AI and the team see: questions and answers only */
  const history = (upTo: Msg[]) =>
    upTo.filter((m): m is Exclude<Msg, { role: 'note' }> => m.role !== 'note').slice(-8).map((m) => ({ role: m.role, text: m.text }))

  const ask = async (question: string) => {
    const q = question.trim()
    if (!q || busy) return
    const before = msgs
    setMsgs([...before, { role: 'teacher', text: q }])
    setText('')
    setConfirming(false)
    setBusy('ask')
    try {
      const res = await fetch('/api/help', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, history: history(before), path }),
      })
      const body = (await res.json().catch(() => ({}))) as { answer?: string; topic?: string; links?: { href: string; label: string }[]; left?: number; limit?: number }
      if (res.status === 429) {
        setMsgs((m) => [...m, { role: 'note', tone: 'warn', text: t('help.chat.limit', { n: body.limit ?? '' }) }])
        return
      }
      if (!res.ok || !body.answer) throw new Error(String(res.status))
      const next: Msg[] = [{ role: 'assistant', text: body.answer, links: body.links, unknown: body.topic === 'unknown' }]
      if (typeof body.left === 'number' && body.left <= 5) next.push({ role: 'note', text: t('help.chat.left', { n: body.left }) })
      setMsgs((m) => [...m, ...next])
    } catch {
      setMsgs((m) => [...m, { role: 'note', tone: 'warn', text: t('help.chat.busy') }])
    } finally {
      setBusy(null)
    }
  }

  /** The last question and what came before it, to the team */
  const handOff = async () => {
    const all = text.trim() ? [...msgs, { role: 'teacher' as const, text: text.trim() }] : msgs
    const lastQ = all.findLastIndex((m) => m.role === 'teacher')
    if (lastQ < 0) {
      setConfirming(false)
      setMsgs((m) => [...m, { role: 'note', text: t('help.handoff.needQuestion') }])
      input.current?.focus()
      return
    }
    setBusy('handoff')
    try {
      const res = await fetch('/api/help/handoff', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: (all[lastQ] as { text: string }).text, history: history(all.slice(0, lastQ)), path }),
      })
      const body = (await res.json().catch(() => ({}))) as { reach?: 'telegram' | 'phone'; limit?: number }
      const note: Msg = res.ok
        ? { role: 'note', text: t(body.reach === 'telegram' ? 'help.handoff.sentTelegram' : 'help.handoff.sentPhone') }
        : res.status === 429
          ? { role: 'note', tone: 'warn', telegram: true, text: t('help.handoff.limit', { n: body.limit ?? '' }) }
          : { role: 'note', tone: 'warn', telegram: true, text: t('help.handoff.unavailable') }
      setMsgs([...all, note])
      if (res.ok) setText('')
    } catch {
      setMsgs((m) => [...m, { role: 'note', tone: 'warn', telegram: true, text: t('help.handoff.unavailable') }])
    } finally {
      setBusy(null)
      setConfirming(false)
    }
  }

  const lastIsUnknown = (() => {
    const last = msgs.at(-1)
    return last?.role === 'assistant' && !!last.unknown
  })()
  const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches

  return (
    <>
      {!open && (
        <button
          ref={fab}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('help.chat.open')}
          title={t('help.chat.open')}
          aria-haspopup="dialog"
          style={{ bottom: `calc(${clearance}px + 1rem + ${clearance ? '0px' : 'env(safe-area-inset-bottom)'})` }}
          className="press fixed right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-paper-300 bg-paper-50 text-orange-700 shadow-lg transition-[bottom] hover:bg-paper-100 print:hidden"
        >
          <MessageCircleQuestionMark size={26} strokeWidth={ICON.strokeWidth} aria-hidden />
        </button>
      )}
      {open && (
        <div
          role="dialog"
          aria-label={t('help.chat.title')}
          style={{ bottom: `max(${clearance}px, 0px)` }}
          className="slide-down fixed inset-x-0 z-50 flex h-[min(80dvh,600px)] flex-col overflow-hidden rounded-t-xl border border-paper-300 bg-paper-50 shadow-2xl sm:inset-x-auto sm:right-4 sm:mb-4 sm:w-[380px] sm:rounded-xl print:hidden"
        >
          <header className="flex items-center gap-2 border-b border-paper-300 px-3 py-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-700" aria-hidden>
              <MessageCircleQuestionMark size={18} strokeWidth={ICON.strokeWidth} />
            </span>
            <h2 className="t-h3 min-w-0 flex-1 truncate">{t('help.chat.title')}</h2>
            {msgs.length > 0 && (
              <IconButton label={t('help.chat.new')} size={36} onClick={() => (setMsgs([]), setConfirming(false))} disabled={!!busy}>
                <RotateCcw size={18} strokeWidth={ICON.strokeWidth} aria-hidden />
              </IconButton>
            )}
            <IconButton label={t('help.chat.close')} size={36} onClick={() => (setOpen(false), requestAnimationFrame(() => fab.current?.focus()))}>
              <X size={20} strokeWidth={ICON.strokeWidth} aria-hidden />
            </IconButton>
          </header>

          <div ref={list} className="flex flex-1 flex-col gap-3 overflow-y-auto px-3 py-3" aria-live="polite">
            <p className="t-body max-w-[90%] self-start rounded-lg rounded-tl-sm bg-paper-200 px-3 py-2 text-ink-800">{t('help.chat.hello')}</p>
            {msgs.length === 0 && (
              <div className="flex flex-col items-start gap-2">
                {SUGGEST[placeOf(path)].map((k) => (
                  <button key={k} type="button" onClick={() => ask(t(k))} className="press t-small rounded-full border border-paper-300 bg-paper-50 px-3 py-1.5 text-left font-medium text-orange-700 hover:bg-orange-100">
                    {t(k)}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === 'teacher' ? (
                <p key={i} className="t-body max-w-[85%] self-end whitespace-pre-line rounded-lg rounded-tr-sm bg-orange-100 px-3 py-2 text-ink-800">
                  {m.text}
                </p>
              ) : m.role === 'assistant' ? (
                <div key={i} className="flex max-w-[90%] flex-col gap-2 self-start">
                  <p className="t-body whitespace-pre-line rounded-lg rounded-tl-sm bg-paper-200 px-3 py-2 text-ink-800">{m.text}</p>
                  {!!m.links?.length && (
                    <div className="flex flex-wrap gap-2">
                      {m.links.map((l) => (
                        <Link
                          key={l.href}
                          href={l.href}
                          onClick={() => narrow() && setOpen(false)}
                          className={buttonClass({ size: 'sm', pill: true })}
                        >
                          <span className="btn-label">{l.label} →</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div key={i} className={`t-small flex flex-col items-start gap-2 self-center rounded-md px-3 py-2 text-center ${m.tone === 'warn' ? 'bg-warn-100 text-warn-600' : 'text-ink-500'}`}>
                  <span>{m.text}</span>
                  {m.telegram && (
                    <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="btn btn-telegram btn-sm self-center">
                      <span className="btn-label">
                        <Send size={16} strokeWidth={ICON.strokeWidth} aria-hidden /> {t('help.writeUs')}
                      </span>
                    </a>
                  )}
                </div>
              ),
            )}
            {busy === 'ask' && (
              <p className="t-small self-start text-ink-500" role="status">
                {t('help.chat.thinking')}
                <span className="tutor-dots" aria-hidden>
                  <span>.</span>
                  <span>.</span>
                  <span>.</span>
                </span>
              </p>
            )}
            {lastIsUnknown && !busy && !confirming && (
              <Button variant="secondary" size="sm" className="self-start" icon={<Headset size={16} strokeWidth={ICON.strokeWidth} aria-hidden />} onClick={() => setConfirming(true)}>
                {t('help.handoff.button')}
              </Button>
            )}
            {confirming && (
              <div className="flex flex-col gap-2 rounded-lg border border-paper-300 bg-paper-100 px-3 py-2">
                <p className="t-small text-ink-700">{t('help.handoff.confirm')}</p>
                <div className="flex gap-2">
                  <Button size="sm" loading={busy === 'handoff'} onClick={handOff}>
                    {t('help.handoff.send')}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy === 'handoff'} onClick={() => setConfirming(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <form
            className="flex flex-col gap-1.5 border-t border-paper-300 px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2"
            onSubmit={(e) => {
              e.preventDefault()
              void ask(text)
            }}
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void ask(text)
                  }
                }}
                rows={1}
                maxLength={1000}
                placeholder={t('help.chat.placeholder')}
                aria-label={t('help.chat.placeholder')}
                className="t-body max-h-32 min-h-11 flex-1 resize-none rounded-md border border-paper-300 bg-paper-50 px-3 py-2 [field-sizing:content]"
              />
              <button type="submit" disabled={!text.trim() || !!busy} aria-label={t('compose.send')} title={t('compose.send')} className="btn btn-primary btn-pill min-h-11 w-11 shrink-0 px-0">
                <span className="btn-label">
                  <ArrowUp size={20} strokeWidth={2.25} aria-hidden />
                </span>
              </button>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="t-caption text-ink-400">{t('help.chat.ai')}</span>
              {!confirming && (
                <button type="button" onClick={() => setConfirming(true)} disabled={!!busy} className="t-small shrink-0 font-medium text-ink-500 underline-offset-2 hover:text-ink-800 hover:underline">
                  {t('help.handoff.button')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </>
  )
}
