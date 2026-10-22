import Link from 'next/link'
import { Fragment } from 'react'

/**
 * Put links inside a translated sentence: pass the sentence with {name} slots already filled by
 * `\u0000name\u0000` markers (see `slot`) and a map of name → link.
 */
export const slot = (name: string) => `\u0000${name}\u0000`
export function LinkedText({ text, links }: { text: string; links: Record<string, { href: string; label: string }> }) {
  return (
    <>
      {text.split('\u0000').map((part, i) =>
        i % 2 === 1 && links[part] ? (
          <Link key={i} href={links[part].href} target="_blank" className="underline hover:text-ink-800">
            {links[part].label}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  )
}
