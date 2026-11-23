/**
 * Where a changed part is run from (spec 055): the places work enters that reach it, each with the way it takes, or
 * why none was found. The scan names some places itself (a controller action, a job, a command, a handler); the
 * project's layout names others by path. A way is found inside the diff's own pack, then by the walk a call at a time
 * (entries.ts). What is said is only what was looked at: a search that found nothing says how far it looked, never
 * that no way exists.
 */
import type { EntryAbove, WalkStop } from './entries.ts'
import type { Origin, OriginStep, RunsFrom, Scan, ScanAnchor, ScanEntry } from './types.ts'

/** An origin's words and route, from what the scan says of it: a route first, then its own words, then a door, else its name. */
export function originWords(entry: ScanEntry | undefined, symbol: string): { label: string; route?: { verbs: string[]; path: string } } {
  const route = entry?.routes?.[0]
  if (route) return { label: `${route.verbs.join('/')} ${route.path}`, route: { verbs: route.verbs, path: route.path } }
  if (entry?.label) return { label: entry.label }
  const door = entry?.doors?.[0]
  return { label: door ? door.title : symbol }
}

/** Whether a path is where work enters by the project's layout: the rule's name, or true for one with no name. */
export type EntryKindOf = (path: string) => string | boolean | undefined

/** How far up the diff's own pack is followed for origins. */
const PACK_HOPS = 4
/** The most origins said of one part, the nearest first. */
export const MOST_ORIGINS = 3

const calls = (count: number) => `${count} call${count === 1 ? '' : 's'}`

/** An origin the scan names: a controller action, a job, a command, a handler, or a kind newer than this reader. */
function named(entry: ScanEntry, symbol: string, chain: OriginStep[], hops: number): Origin {
  return { kind: entry.kind, ...originWords(entry, symbol), exact: entry.exact, by: 'scan', symbol, chain, hops }
}

/** An origin by its path alone, never sure: its kind is the name of the rule that matched. */
function byPath(rule: string | true, symbol: string, chain: OriginStep[], hops: number): Origin {
  return { kind: rule === true ? 'path' : rule, label: symbol, exact: false, by: 'path', symbol, chain, hops }
}

/** Each origin once, by the definition it is, the first kept: the scan's word before a path's, the nearer before the further. */
function once(origins: readonly Origin[]): Origin[] {
  const seen = new Set<string>()
  return origins.filter((origin) => {
    const key = origin.chain[0] ? `${origin.chain[0].path}:${origin.chain[0].line}` : 'itself'
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** The definition itself, when work enters there: by the scan's word, or by its path. */
function selfOrigin(anchor: ScanAnchor, entryKind: EntryKindOf): Origin | undefined {
  if (anchor.entry) return named(anchor.entry, anchor.symbol, [], 0)
  const rule = entryKind(anchor.path)
  return rule ? byPath(rule, anchor.symbol, [], 0) : undefined
}

/** The callers the scan names as entries, on the call site or on the caller's node, one call out. */
function entryCallerOrigins(scan: Scan, anchor: ScanAnchor): Origin[] {
  return (anchor.callSites ?? []).flatMap((site) => {
    const caller = scan.nodes[site.id]
    const entry = site.entry ?? caller?.entry
    if (!entry) return []
    const guard = site.guards.at(-1)?.text
    const step: OriginStep = {
      symbol: site.symbol,
      path: site.path,
      line: caller?.startLine ?? site.line,
      call_line: site.line,
      ...(site.enqueue ? { enqueues: true } : {}),
      ...(guard ? { guard } : {}),
    }
    return [named(entry, site.symbol, [step], 1)]
  })
}

/** The origins the pack's `called_by` edges reach within `maxHops` calls, and how many calls out they had callers. */
function edgeOrigins(scan: Scan, anchor: ScanAnchor, entryKind: EntryKindOf, maxHops: number): { origins: Origin[]; hops: number } {
  const origins: Origin[] = []
  let hops = 0
  let frontier: { id: string; below: OriginStep[] }[] = [{ id: anchor.id, below: [] }]
  const seen = new Set([anchor.id])
  for (let hop = 1; hop <= maxHops && frontier.length; hop += 1) {
    const next: typeof frontier = []
    for (const way of frontier) {
      for (const edge of scan.edges) {
        if (edge.relationship !== 'called_by' || edge.to !== way.id || seen.has(edge.from) || edge.note === 'test') continue
        seen.add(edge.from)
        const caller = scan.nodes[edge.from]
        if (!caller) continue
        hops = Math.max(hops, hop)

        const guard = edge.guards?.at(-1)?.text
        const step: OriginStep = {
          symbol: caller.symbol,
          path: caller.path,
          line: caller.startLine,
          ...(edge.line ? { call_line: edge.line } : {}),
          ...(edge.note === 'enqueue' ? { enqueues: true } : {}),
          ...(guard ? { guard } : {}),
        }
        const below = [...way.below, step]
        const rule = caller.entry ? undefined : entryKind(caller.path)
        if (caller.entry) origins.push(named(caller.entry, caller.symbol, below.toReversed(), hop))
        else if (rule) origins.push(byPath(rule, caller.symbol, below.toReversed(), hop))
        else next.push({ id: edge.from, below })
      }
    }
    frontier = next
  }
  return { origins, hops }
}

/**
 * The origins the diff's own pack shows for a changed definition: itself when work enters there, the callers the scan
 * names as entries, and the callers its `called_by` edges reach within a few calls. `hops` is how many calls out the
 * pack had callers to look at.
 */
export function packOrigins(scan: Scan, anchor: ScanAnchor, entryKind: EntryKindOf, maxHops = PACK_HOPS): { origins: Origin[]; hops: number } {
  const self = selfOrigin(anchor, entryKind)
  const fromEdges = edgeOrigins(scan, anchor, entryKind, maxHops)
  const listsCallers = (anchor.callSites ?? []).length > 0
  return {
    origins: once([...(self ? [self] : []), ...entryCallerOrigins(scan, anchor), ...fromEdges.origins]),
    hops: Math.max(listsCallers ? 1 : 0, fromEdges.hops),
  }
}

/** An entry point the walk found, as an origin. A walk of an older shape gave only its name, place and distance. */
export function walkOrigin(entry: EntryAbove): Origin {
  return {
    kind: entry.kind ?? 'path',
    label: entry.label ?? entry.symbol,
    ...(entry.route ? { route: entry.route } : {}),
    exact: entry.exact ?? false,
    by: entry.by ?? 'path',
    symbol: entry.symbol,
    chain: entry.chain ?? [],
    hops: entry.hops,
  }
}

/** Why the walk stopped short, in words, after the part about what was found within `hops` calls. */
function stoppedWords(stop: WalkStop): string {
  if (stop.stopped === 'limit') return ', and the way goes on further: what is above that was not looked for.'
  if (stop.stopped === 'time') return ', and the search used its time there: what is above that was not looked for.'
  if (stop.stopped === 'failed') return `, and the search further out failed${stop.reason ? `: ${stop.reason.replace(/\.$/, '')}` : ''}.`
  return '.'
}

export interface RunsFromRequest {
  /** What the pack and the walk found, in any order. */
  origins: readonly Origin[]
  /** How many calls out the pack had callers to look at. */
  looked: number
  /** The production callers the scan found for it. */
  callers: number
  /** The test call sites the scan found for it. */
  testCallers: number
  /** The tests the scan lists as using it, apart from its callers, as `testDefinitions` does. */
  testRefs: number
  /** Whether the scan reported a caller list at all. */
  listed: boolean
  /** The walk's answer for it, when a walk ran from its callers. */
  walked?: { stop?: WalkStop }
}

/** The nearest origins, each once, with how many more were found and what the walk left out. */
function nearestOrigins(origins: readonly Origin[], stop: WalkStop | undefined): RunsFrom {
  const nearest = once([...origins].sort((a, b) => a.hops - b.hops))
  const more = nearest.length - MOST_ORIGINS
  const said: string[] = []
  if (more > 0) said.push(`${more} more way${more === 1 ? '' : 's'} in ${more === 1 ? 'was' : 'were'} found.`)
  if (stop?.stopped) said.push(`Other ways out were followed for ${calls(stop.hops)}${stoppedWords(stop)}`)
  return {
    found: 'origins',
    origins: nearest.slice(0, MOST_ORIGINS),
    ...(more > 0 ? { more } : {}),
    ...(said.length ? { cut: said.join(' ') } : {}),
  }
}

/**
 * Where a changed definition runs from, for one whose callers were looked for. Origins, nearest first and at most three;
 * else that only tests call it; else that none was found, with how far the search looked and why it stopped there.
 */
export function runsFromOf({ origins, looked, callers, testCallers, testRefs, listed, walked }: RunsFromRequest): RunsFrom {
  const stop = walked?.stop
  if (origins.length) return nearestOrigins(origins, stop)
  // A pack lists the tests that use a definition apart from its production callers.
  if (callers === 0 && (testCallers > 0 || testRefs > 0)) return { found: 'only-tests', tests: testCallers || testRefs }
  if (callers === 0) return { found: 'none', hops: 0, why: listed ? 'The scan found nothing that calls it.' : 'The scan listed nothing that calls it.' }
  const hops = Math.max(looked, stop?.hops ?? 0)
  const within = `Nothing within ${calls(hops)} of it is where work enters`
  if (!walked) return { found: 'none', hops, why: `${within}, and what calls its callers was not looked for.` }
  if (stop?.stopped) return { found: 'none', hops, stopped: stop.stopped, why: `${within}${stoppedWords(stop)}` }
  if (stop?.top) return { found: 'none', hops, top: stop.top, why: `${within}: the way out stops at ${stop.top}, and the scan found nothing that calls it.` }
  return { found: 'none', hops, why: `${within}.` }
}
