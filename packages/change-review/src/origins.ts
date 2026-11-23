/**
 * Where a changed part is run from (spec 055): the places work enters that reach it, each with the way it takes, or
 * why none was found. The scan names some places itself (a controller action, a job, a command, a handler); the
 * project's layout names others by path. A way is found inside the diff's own pack, then by the walk a call at a time
 * (entries.ts). What is said is only what was looked at: a search that found nothing says how far it looked, never
 * that no way exists.
 */
import type { ScanEntry } from './types.ts'

/** An origin's words and route, from what the scan says of it: a route first, then its own words, then a door, else its name. */
export function originWords(entry: ScanEntry | undefined, symbol: string): { label: string; route?: { verbs: string[]; path: string } } {
  const route = entry?.routes?.[0]
  if (route) return { label: `${route.verbs.join('/')} ${route.path}`, route: { verbs: route.verbs, path: route.path } }
  if (entry?.label) return { label: entry.label }
  const door = entry?.doors?.[0]
  return { label: door ? door.title : symbol }
}
