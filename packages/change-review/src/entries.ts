/**
 * The entry points above a changed definition (FOUNDATION 4.2): the controller actions, jobs and commands a request
 * goes through before it reaches the change. The diff scan names who calls a changed definition, one call out. This
 * follows those callers a call at a time, through helpers and view templates, with the same scan asked of each
 * caller, until each way ends where a request enters. What it finds are entry points whose tests the proof may run,
 * nothing more. A scan that fails, or a way cut short, is a note, never a crash.
 */
import { originWords } from './origins.ts'
import { scanAnchors } from './scan.ts'
import type { ScanOutcome } from './scan.ts'
import type { Origin, OriginStep } from './types.ts'

/**
 * An entry point found above a changed definition, and how many calls away it is. Since spec 055 it keeps what kind of
 * entry it is, its words and the way to it; those fields are optional so a search written before still answers.
 */
export interface EntryAbove {
  /** As the scan names it, such as `TopicsController#show`. */
  symbol: string
  path: string
  hops: number
  /** Its first line. */
  line?: number
  kind?: Origin['kind']
  label?: string
  exact?: boolean
  by?: Origin['by']
  route?: Origin['route']
  /** The entry point first, the changed definition's direct caller last. */
  chain?: OriginStep[]
}

/** Why a walk from one changed definition ended, and how many calls out the scans answered for it. */
export interface WalkStop {
  hops: number
  /** It was cut: at its limit of calls or of places per scan, out of time, or by a scan that failed. Absent when every way ended. */
  stopped?: 'limit' | 'time' | 'failed'
  /** The furthest definition a way ended at with nothing calling it, when one did. */
  top?: string
  /** What the failed scan said. */
  reason?: string
}

/** Scans the definitions that hold the given places (`path:line`). The pipeline hands in agentic-search; tests a fake. */
export type AnchorScan = (anchors: readonly string[], options: { timeoutMs: number }) => Promise<ScanOutcome>

/** A place that calls a changed definition: where, and whether the call enqueues it or a condition stands in front of it. */
export interface StartCaller {
  path: string
  line: number
  enqueue?: boolean
  guard?: string
}

export interface EntriesRequest {
  /** Each changed definition by its id, and the places that call it, as the diff scan lists them. */
  starts: readonly { id: string; callers: readonly StartCaller[] }[]
  /**
   * Whether a path is where a request, job or command enters, by the project's own layout: the name of the rule that
   * says so (its kind), or true for one with no name.
   */
  isEntry: (path: string) => boolean | string | undefined
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
  /** Per changed definition with callers to follow, why its walk ended. Absent from a search written before spec 055. */
  stops?: Record<string, WalkStop>
  /**
   * The tests the scan links to each definition the walk followed, by its place (`path:startLine`): the tests of a caller
   * on the way in, which may run through the changed definition too.
   */
  tests?: Record<string, { symbol: string; path: string; line: number }[]>
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
  /** The call at this place: whether it enqueues, and the condition in front of it. */
  enqueue?: boolean
  guard?: string
  /** The definitions passed so far, from the changed definition's direct caller outward. */
  below: OriginStep[]
}

const calls = (count: number) => `${count} call${count === 1 ? '' : 's'}`

/**
 * Follows the callers of each changed definition up to its entry points. A definition is an entry point when the scan
 * says so or its path is one; its own callers are then not followed. Every definition is followed once for each
 * changed definition, and one scan answers for every way at the same distance. Each entry point keeps the way to it.
 */
export async function entriesAbove({ starts, isEntry, scan, maxHops = ENTRY_HOPS, budgetMs = ENTRIES_BUDGET_MS, now = Date.now, signal }: EntriesRequest): Promise<EntriesOutcome> {
  const entries: Record<string, EntryAbove[]> = Object.fromEntries(starts.map((start) => [start.id, []]))
  const notes: string[] = []
  const stops: Record<string, WalkStop> = {}
  const tests: NonNullable<EntriesOutcome['tests']> = {}
  const started = now()
  /** Per changed definition: the places already asked for, and the definitions already followed. */
  const asked = new Map(starts.map((start) => [start.id, new Set<string>()]))
  const followed = new Map(starts.map((start) => [start.id, new Set<string>()]))
  const queue = (step: Step, into: Step[]) => {
    const place = `${step.path}:${step.line}`
    if (asked.get(step.root)!.has(place)) return
    asked.get(step.root)!.add(place)
    into.push(step)
  }
  /** Where a root's walk got to: the calls out answered for it, and why it stopped when it was cut. */
  const reached = (root: string, hops: number) => {
    const stop = (stops[root] ??= { hops: 0 })
    stop.hops = Math.max(stop.hops, hops)
  }
  const cut = (frontier: readonly Step[], stopped: NonNullable<WalkStop['stopped']>, hops: number, reason?: string) => {
    for (const root of new Set(frontier.map((step) => step.root))) {
      reached(root, hops)
      Object.assign(stops[root]!, { stopped, ...(reason ? { reason } : {}) })
    }
  }

  let frontier: Step[] = []
  for (const start of starts) {
    for (const caller of start.callers) {
      queue({ root: start.id, path: caller.path, line: caller.line, hops: 1, ...(caller.enqueue ? { enqueue: true } : {}), ...(caller.guard ? { guard: caller.guard } : {}), below: [] }, frontier)
    }
  }
  for (const step of frontier) reached(step.root, 0)

  for (let hop = 1; frontier.length > 0; hop += 1) {
    if (signal?.aborted) break
    if (hop > maxHops) {
      notes.push(`The way to an entry point was followed for ${calls(maxHops)} and goes on further: what is above that was not looked for.`)
      cut(frontier, 'limit', maxHops)
      break
    }
    const time = Math.min(SCAN_MS, budgetMs - (now() - started))
    if (time < LEAST_SCAN_MS) {
      notes.push(`The search for entry points used the time it had after ${calls(hop - 1)}: what is above that was not looked for.`)
      cut(frontier, 'time', hop - 1)
      break
    }
    const places = [...new Set(frontier.map((step) => `${step.path}:${step.line}`))]
    if (places.length > MOST_PER_SCAN) notes.push(`${places.length - MOST_PER_SCAN} callers ${calls(hop)} out were not followed: one scan follows ${MOST_PER_SCAN}.`)
    const wanted = new Set(places.slice(0, MOST_PER_SCAN))
    cut(frontier.filter((step) => !wanted.has(`${step.path}:${step.line}`)), 'limit', hop - 1)
    const outcome = await scan([...wanted], { timeoutMs: time })
    if (!outcome.ok) {
      notes.push(`The search for entry points stopped: ${outcome.reason}`)
      cut(frontier, 'failed', hop - 1, outcome.reason)
      break
    }
    const next: Step[] = []
    for (const step of frontier) {
      if (!wanted.has(`${step.path}:${step.line}`)) continue
      const definition = outcome.scan.anchors.find((anchor) => anchor.path === step.path && anchor.startLine <= step.line && step.line <= anchor.endLine)
      if (!definition) continue
      reached(step.root, step.hops)
      const key = `${definition.path}:${definition.startLine}`
      if (followed.get(step.root)!.has(key)) continue
      followed.get(step.root)!.add(key)
      if (definition.tests.length && !tests[key]) tests[key] = definition.tests.map(({ symbol, path, line }) => ({ symbol, path, line }))
      const here: OriginStep = {
        symbol: definition.symbol,
        path: definition.path,
        line: definition.startLine,
        call_line: step.line,
        ...(step.enqueue ? { enqueues: true } : {}),
        ...(step.guard ? { guard: step.guard } : {}),
      }
      const below = [...step.below, here]
      const byPath = definition.entry ? undefined : isEntry(definition.path)
      if (definition.entry || byPath) {
        const kind = definition.entry?.kind ?? (typeof byPath === 'string' ? byPath : 'path')
        entries[step.root]!.push({
          symbol: definition.symbol,
          path: definition.path,
          hops: step.hops,
          line: definition.startLine,
          kind,
          ...originWords(definition.entry, definition.symbol),
          exact: definition.entry?.exact ?? false,
          by: definition.entry ? 'scan' : 'path',
          chain: below.toReversed(),
        })
        continue
      }
      const sites = definition.callSites ?? []
      if (!sites.length) {
        // A way that ends here: the furthest such definition is where the way out stops.
        const stop = stops[step.root]!
        if (!stop.top || step.hops >= stop.hops) stop.top = definition.symbol
      }
      for (const site of sites) {
        const guard = site.guards.at(-1)?.text
        if (!site.entry) {
          queue({ root: step.root, path: site.path, line: site.line, hops: step.hops + 1, ...(site.enqueue ? { enqueue: true } : {}), ...(guard ? { guard } : {}), below }, next)
          continue
        }
        // The scan names this call a way in (a route, a handler under its key, a listener): the way ends at it.
        const place = `${site.path}:${site.line}`
        if (asked.get(step.root)!.has(place)) continue
        asked.get(step.root)!.add(place)
        const top: OriginStep = {
          symbol: site.symbol,
          path: site.path,
          line: outcome.scan.nodes[site.id]?.startLine ?? site.line,
          call_line: site.line,
          ...(site.enqueue ? { enqueues: true } : {}),
          ...(guard ? { guard } : {}),
        }
        const hops = step.hops + 1
        reached(step.root, hops)
        entries[step.root]!.push({
          symbol: site.symbol,
          path: site.path,
          hops,
          line: top.line,
          kind: site.entry.kind,
          ...originWords(site.entry, site.symbol, site.key),
          exact: site.entry.exact,
          by: 'scan',
          chain: [...below, top].toReversed(),
        })
      }
    }
    frontier = next
  }
  return { entries, notes, stops, tests }
}

/** The default search: agentic-search in the checkout, one scan for each call further out. */
export const searchEntriesAbove: EntriesSearch = ({ cwd, signal, ...request }) =>
  entriesAbove({ ...request, signal, scan: (anchors, { timeoutMs }) => scanAnchors({ cwd, anchors, timeoutMs, signal }) })
