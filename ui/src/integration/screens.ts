import type { LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import { windowParts } from './registry.ts'

/** A screen an integration's part draws, with what its manifest says of it. */
export interface PartScreen {
  /** The integration the screen belongs to. */
  integration: string
  id: string
  label: string
  line: string
  keywords: readonly string[]
  icon: LucideIcon
  component: ComponentType
}

let held: { parts: ReturnType<typeof windowParts>; screens: readonly PartScreen[] } | null = null

/** Every screen of every part, in the order of their folders and of their manifests. A screen with no drawing is left out. */
export function partScreens(): readonly PartScreen[] {
  const parts = windowParts()
  if (held?.parts === parts) return held.screens
  const screens = parts.flatMap((part) =>
    (part.screens ?? []).flatMap((drawn): PartScreen[] => {
      const named = part.manifest.screens.find(({ id }) => id === drawn.id)
      return named ? [{ integration: part.manifest.id, ...named, icon: drawn.icon, component: drawn.component }] : []
    }),
  )
  held = { parts, screens }
  return screens
}

export function partScreen(id: string): PartScreen | undefined {
  return partScreens().find((screen) => screen.id === id)
}

/** Whether a screen belongs to an integration's part: the screens the menu lists after Work, which the user can take out. */
export const isPartScreen = (id: string): boolean => partScreen(id) !== undefined
