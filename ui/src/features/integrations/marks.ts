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

/** GitHub is a full integration, outside the MCP catalog, so its mark is set here and keeps the hue it has always had. */
const GITHUB: MarkLook = { symbol: 'Gh', hue: 162 }

const SYMBOLS: Record<string, string> = {
  linear: 'Li',
  notion: 'No',
  atlassian: 'Ji',
  sentry: 'Se',
  'home-assistant': 'Ha',
  stripe: 'St',
  cloudflare: 'Cf',
  supabase: 'Su',
  gitlab: 'Gl',
  intercom: 'In',
  todoist: 'To',
}

/** Neighbors sit a golden angle apart on the wheel, so no two next to each other look alike. GitHub comes first, then the catalog. */
const GOLDEN_ANGLE = 137.508

function symbolOf(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '')
  return letters ? letters.charAt(0).toUpperCase() + letters.charAt(1).toLowerCase() : '?'
}

export function serviceMark(id: string): MarkLook {
  if (id === 'github') return GITHUB
  const place = Math.max(0, CATALOG.findIndex((entry) => entry.id === id)) + 1
  return { symbol: SYMBOLS[id] ?? symbolOf(id), hue: Math.round((GITHUB.hue + place * GOLDEN_ANGLE) % 360) }
}

/** A server of the person's own: its first two letters, on a hue taken from its name, so it keeps the same one. */
export function ownMark(name: string): MarkLook {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return { symbol: symbolOf(name), hue: hash % 360 }
}
