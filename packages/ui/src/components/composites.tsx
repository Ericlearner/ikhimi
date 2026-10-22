'use client'
import {
  ArrowLeftRight,
  AudioLines,
  BookOpen,
  CircleDot,
  Columns3,
  Combine,
  Headphones,
  Layers,
  ListChecks,
  ListMusic,
  ListOrdered,
  Mic,
  PackageOpen,
  PenLine,
  PencilLine,
  Repeat2,
  SpellCheck,
  Tag,
  TextCursorInput,
  ToggleLeft,
  type LucideIcon,
} from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { avatarFill, initials } from '../avatar'
import { ILLUSTRATIONS } from './illustrations'
import { Button } from './primitives'

/** Lucide defaults from the spec: stroke 1.75, round caps/joins, currentColor. */
export const ICON = { strokeWidth: 1.75, absoluteStrokeWidth: false } as const

/** Fixed icon per exercise kind (spec §4), used in editor, report and player alike. */
export const KIND_ICONS: Record<string, LucideIcon> = {
  mcq_single: CircleDot,
  mcq_multi: ListChecks,
  gap_fill: TextCursorInput,
  gap_fill_bank: PackageOpen,
  true_false: ToggleLeft,
  matching: ArrowLeftRight,
  ordering: ListOrdered,
  short_answer: PencilLine,
  listen_mcq: Headphones,
  listen_gap_fill: AudioLines,
  listen_order: ListMusic,
  reading_passage: BookOpen,
  error_correction: SpellCheck,
  sentence_transform: Repeat2,
  word_formation: Combine,
  categorize: Columns3,
  open_writing: PenLine,
  shadowing: AudioLines,
  speaking_record: Mic,
  label_image: Tag,
  flashcard_review: Layers,
}

export function KindIcon({ kind, size = 20, className }: { kind: string; size?: number; className?: string }) {
  const I = KIND_ICONS[kind] ?? CircleDot
  return <I size={size} strokeWidth={ICON.strokeWidth} className={className} aria-hidden />
}

export function Avatar({ id, name, size = 40, className }: { id: string; name: string | null; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-paper-50 ${className ?? ''}`}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `var(${avatarFill(id)})` }}
    >
      {initials(name)}
    </span>
  )
}

export function EmptyState({
  illustration = 'book',
  title,
  action,
}: {
  illustration?: keyof typeof ILLUSTRATIONS
  title: string
  action?: { label: string; onClick?: () => void; href?: string }
}) {
  const Illo = ILLUSTRATIONS[illustration]
  return (
    <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
      <Illo size={112} />
      <p className="t-body-lg measure text-ink-500">{title}</p>
      {action &&
        (action.href ? (
          <a href={action.href} className="btn btn-primary btn-md">
            <span className="btn-label">{action.label}</span>
          </a>
        ) : (
          <Button onClick={action.onClick}>{action.label}</Button>
        ))}
    </div>
  )
}

// ─── Toast ──────────────────────────────────────────────────────────────────

type ToastItem = { id: number; text: string; action?: { label: string; run: () => void } }
const ToastCtx = createContext<(text: string, action?: ToastItem['action']) => void>(() => {})

/** Bottom-center on mobile, bottom-right on desktop, 3.2 s, ink fill (spec §9). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const n = useRef(0)
  const show = useCallback((text: string, action?: ToastItem['action']) => {
    const id = ++n.current
    setItems((xs) => [...xs.slice(-2), { id, text, action }])
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 md:items-end md:pr-6">
        {items.map((t) => (
          <div key={t.id} className="slide-down pointer-events-auto flex max-w-md items-center gap-4 rounded-md bg-ink-700 px-4 py-3 text-paper-50 shadow-e4">
            <span className="t-body">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="t-h3 text-orange-400 underline-offset-2 hover:underline"
                onClick={() => {
                  t.action!.run()
                  setItems((xs) => xs.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)
