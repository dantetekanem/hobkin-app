/**
 * The entry points above a changed definition (FOUNDATION 4.2): the controller actions, jobs and commands a request
 * goes through before it reaches the change. The diff scan names who calls a changed definition, one call out. This
 * follows those callers a call at a time, through helpers and view templates, with the same scan asked of each
 * caller, until each way ends where a request enters. What it finds are entry points whose tests the proof may run,
 * nothing more. A scan that fails, or a way cut short, is a note, never a crash.
 */
import { scanAnchors } from './scan.ts'
import type { ScanOutcome } from './scan.ts'

/** An entry point found above a changed definition, and how many calls away it is. */
export interface EntryAbove {
  /** As the scan names it, such as `TopicsController#show`. */
  symbol: string
  path: string
  hops: number
}

/** Scans the definitions that hold the given places (`path:line`). The pipeline hands in agentic-search; tests a fake. */
export type AnchorScan = (anchors: readonly string[], options: { timeoutMs: number }) => Promise<ScanOutcome>

export interface EntriesRequest {
  /** Each changed definition by its id, and the places that call it, as the diff scan lists them. */
  starts: readonly { id: string; callers: readonly { path: string; line: number }[] }[]
  /** Whether a path is where a request, job or command enters, by the project's own layout. */
  isEntry: (path: string) => boolean
  scan: AnchorScan
  /** How many calls out the way is followed. */
  maxHops?: number
  /** The time all the scans together may take. */
  budgetMs?: number
  now?: () => number
  signal?: AbortSignal
}

export interface EntriesOutcome {
  /** Per changed definition, its entry points, the nearest first. Empty when none was found. */
  entries: Record<string, EntryAbove[]>
  /** What was not followed, and why, in words. */
  notes: string[]
}

/** Asks for the entry points above changed definitions. The pipeline takes this as an option, so tests hand in a fake. */
export type EntriesSearch = (request: Omit<EntriesRequest, 'scan'> & { cwd: string }) => Promise<EntriesOutcome>

export const ENTRY_HOPS = 6
export const ENTRIES_BUDGET_MS = 90_000
/** The most one scan may take, and the least time worth starting one with. */
const SCAN_MS = 30_000
const LEAST_SCAN_MS = 2_000
/** The most places one scan is asked for. */
const MOST_PER_SCAN = 12

interface Step {
  root: string
  path: string
  line: number
  hops: number
}

const calls = (count: number) => `${count} call${count === 1 ? '' : 's'}`

/**
 * Follows the callers of each changed definition up to its entry points. A definition is an entry point when the scan
 * says so or its path is one; its own callers are then not followed. Every definition is followed once for each
 * changed definition, and one scan answers for every way at the same distance.
 */
export async function entriesAbove({ starts, isEntry, scan, maxHops = ENTRY_HOPS, budgetMs = ENTRIES_BUDGET_MS, now = Date.now, signal }: EntriesRequest): Promise<EntriesOutcome> {
  const entries: Record<string, EntryAbove[]> = Object.fromEntries(starts.map((start) => [start.id, []]))
  const notes: string[] = []
  const started = now()
  /** Per changed definition: the places already asked for, and the definitions already followed. */
  const asked = new Map(starts.map((start) => [start.id, new Set<string>()]))
  const followed = new Map(starts.map((start) => [start.id, new Set<string>()]))
  const queue = (root: string, path: string, line: number, hops: number, into: Step[]) => {
    const place = `${path}:${line}`
    if (asked.get(root)!.has(place)) return
    asked.get(root)!.add(place)
    into.push({ root, path, line, hops })
  }

  let frontier: Step[] = []
  for (const start of starts) for (const caller of start.callers) queue(start.id, caller.path, caller.line, 1, frontier)

  for (let hop = 1; frontier.length > 0; hop += 1) {
    if (signal?.aborted) break
    if (hop > maxHops) {
      notes.push(`The way to an entry point was followed for ${calls(maxHops)} and goes on further: what is above that was not looked for.`)
      break
    }
    const time = Math.min(SCAN_MS, budgetMs - (now() - started))
    if (time < LEAST_SCAN_MS) {
      notes.push(`The search for entry points used the time it had after ${calls(hop - 1)}: what is above that was not looked for.`)
      break
    }
    const places = [...new Set(frontier.map((step) => `${step.path}:${step.line}`))]
    if (places.length > MOST_PER_SCAN) notes.push(`${places.length - MOST_PER_SCAN} callers ${calls(hop)} out were not followed: one scan follows ${MOST_PER_SCAN}.`)
    const wanted = new Set(places.slice(0, MOST_PER_SCAN))
    const outcome = await scan([...wanted], { timeoutMs: time })
    if (!outcome.ok) {
      notes.push(`The search for entry points stopped: ${outcome.reason}`)
      break
    }
    const next: Step[] = []
    for (const step of frontier) {
      if (!wanted.has(`${step.path}:${step.line}`)) continue
      const definition = outcome.scan.anchors.find((anchor) => anchor.path === step.path && anchor.startLine <= step.line && step.line <= anchor.endLine)
      if (!definition) continue
      const key = `${definition.path}:${definition.startLine}`
      if (followed.get(step.root)!.has(key)) continue
      followed.get(step.root)!.add(key)
      if (definition.entry || isEntry(definition.path)) {
        entries[step.root]!.push({ symbol: definition.symbol, path: definition.path, hops: step.hops })
        continue
      }
      for (const site of definition.callSites ?? []) queue(step.root, site.path, site.line, step.hops + 1, next)
    }
    frontier = next
  }
  return { entries, notes }
}

/** The default search: agentic-search in the checkout, one scan for each call further out. */
export const searchEntriesAbove: EntriesSearch = ({ cwd, signal, ...request }) =>
  entriesAbove({ ...request, signal, scan: (anchors, { timeoutMs }) => scanAnchors({ cwd, anchors, timeoutMs, signal }) })
