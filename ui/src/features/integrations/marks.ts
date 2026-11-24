import { windowPart } from '../../integration/registry.ts'

/**
 * How each service's mark looks: two letters, in the manner of a table of elements, on a hue of its own.
 * The app draws its own marks and ships no vendor logos (023-integrations, Open questions).
 */
export interface MarkLook {
  symbol: string
  /** Degrees on the oklch wheel. */
  hue: number
}

function symbolOf(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '')
  return letters ? letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase() : '?'
}

/** A server: its first two letters, on a hue taken from its name, so it keeps the same one. */
export function ownMark(name: string): MarkLook {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return { symbol: symbolOf(name), hue: hash % 360 }
}

/** The mark of the service with this id: a full integration's own, from its window part, or the one its name gives. */
export function serviceMark(id: string): MarkLook {
  const own = windowPart(id)?.mark
  if (own) return own
  return ownMark(id)
}
