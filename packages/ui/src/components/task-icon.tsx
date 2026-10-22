import { TASK_ICONS, type TaskIconName } from '../task-icons.generated'

export type { TaskIconName }

/**
 * Colourful Fluent Emoji for learner-facing homework (Iconify fluent-emoji-flat, bundled offline).
 * The UI chrome keeps Lucide line icons; these give each exercise type and reward its own character.
 */
export function TaskIcon({ name, size = 28, className, label }: { name: TaskIconName; size?: number; className?: string; label?: string }) {
  const icon = TASK_ICONS[name]
  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      className={className}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      // Static, build-time SVG from the icon set — never user content
      dangerouslySetInnerHTML={{ __html: icon.body }}
    />
  )
}

/** One icon per exercise kind (listening items use the headphone instead) */
export const KIND_TASK_ICON: Record<string, TaskIconName> = {
  mcq_single: 'bullseye',
  mcq_multi: 'check-mark-button',
  true_false: 'balance-scale',
  gap_fill: 'pencil',
  matching: 'puzzle-piece',
  ordering: 'input-numbers',
  short_answer: 'writing-hand',
  open_writing: 'memo',
  shadowing: 'headphone',
}
