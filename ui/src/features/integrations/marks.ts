import { CATALOG } from '#shared/integrations/catalog.ts'

/**
 * How each service's mark looks: two letters, in the manner of a table of elements, on a hue of its own.
 * The app draws its own marks and ships no vendor logos (023-integrations, Open questions).
 */
export interface MarkLook {
  symbol: string
  /** Degrees on the oklch wheel. */
  hue: number
}

const SYMBOLS: Record<string, string> = {
  slack: 'Sl',
  github: 'Gh',
  gmail: 'Gm',
  'google-calendar': 'Ca',
  'google-drive': 'Dr',
  linear: 'Li',
  notion: 'No',
  atlassian: 'Ji',
  sentry: 'Se',
  figma: 'Fi',
  'home-assistant': 'Ha',
  stripe: 'St',
  vercel: 'Ve',
  cloudflare: 'Cf',
  supabase: 'Su',
  gitlab: 'Gl',
  intercom: 'In',
  asana: 'As',
  todoist: 'To',
}

/** Neighbors in the catalog sit a golden angle apart on the wheel, so no two next to each other look alike. */
const GOLDEN_ANGLE = 137.508

function symbolOf(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '')
  return letters ? letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase() : '?'
}

export function serviceMark(id: string): MarkLook {
  const at = Math.max(0, CATALOG.findIndex((entry) => entry.id === id))
  return { symbol: SYMBOLS[id] ?? symbolOf(id), hue: Math.round((24 + at * GOLDEN_ANGLE) % 360) }
}

/** A server of the person's own: its first two letters, on a hue taken from its name, so it keeps the same one. */
export function ownMark(name: string): MarkLook {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return { symbol: symbolOf(name), hue: hash % 360 }
}
