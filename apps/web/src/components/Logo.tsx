/** Primary lockup on light surfaces, inverse (orange) on dark — swapped by theme tokens. */
export function Logo({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <span className="inline-flex" role="img" aria-label="익히미">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/ikhimi-logo-primary.svg" alt="" className={`logo-light ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/ikhimi-logo-inverse.svg" alt="" className={`logo-dark ${className}`} />
    </span>
  )
}
