import { TemperatureProvider } from '@ikhimi/ui/components'

/** Student screens run warm: full motion, sound on (spec §1). */
export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <TemperatureProvider value="warm">{children}</TemperatureProvider>
}
