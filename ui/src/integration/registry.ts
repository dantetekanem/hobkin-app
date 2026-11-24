import type { WindowPart } from './contract.ts'

/**
 * The integrations' window parts the window found when it started (_specs/064-integration-drops). `loaded.ts` finds
 * them in `integrations/*\/window.tsx` and hands them here once, before the app draws. Tests hand their own. The list
 * lives on `globalThis`, so a hot update of this module keeps it.
 */

const slot = globalThis as { __hobkinWindowParts?: readonly WindowPart[] }

/** Every part, in the order of their folders' names. Empty until they are handed in. */
export function windowParts(): readonly WindowPart[] {
  return slot.__hobkinWindowParts ?? []
}

export function setWindowParts(parts: readonly WindowPart[]): void {
  slot.__hobkinWindowParts = [...parts].sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))
}

/** The part of the integration with this id. */
export function windowPart(id: string): WindowPart | undefined {
  return windowParts().find((part) => part.manifest.id === id)
}
