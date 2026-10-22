'use client'
/**
 * Two temperatures, one system (design spec §1). Student screens run "warm" (full motion, sound on),
 * teacher screens run "calm" (restrained motion, silent). Components read the context; CSS reads the
 * data-temp attribute.
 */
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { configureSound } from '../sound'

export type Temperature = 'warm' | 'calm'
const Ctx = createContext<Temperature>('calm')

export function TemperatureProvider({ value, children }: { value: Temperature; children: ReactNode }) {
  useEffect(() => {
    const root = document.documentElement
    const prev = root.dataset.temp
    root.dataset.temp = value
    configureSound({ temperature: value })
    return () => {
      if (prev) root.dataset.temp = prev
    }
  }, [value])
  return (
    <Ctx.Provider value={value}>
      <div data-temp={value} className="contents">
        {children}
      </div>
    </Ctx.Provider>
  )
}

export const useTemperature = () => useContext(Ctx)
