import type { StackPlace } from '#shared/protocol/work.ts'
import type { GitHubIssue } from '../protocol.ts'
import type { PullEntry, PullSections } from './pull-reviews.ts'

/**
 * The GitHub page's order and its stacks. Newest puts the most recently updated on GitHub first, as GitHub sends them,
 * and Oldest the other way, as the Review list's Newest and Oldest do. A stack of pull requests (`pullStacks`) keeps
 * its layers together, bottom first, whatever the order, and sorts as a whole by its newest layer under Newest and its
 * oldest under Oldest. The grouping is a visual aid only. Pure, so it is tested without a window. Spec: 024-github.
 */

export type PageOrder = 'newest' | 'oldest'

export const PAGE_ORDERS: readonly { value: PageOrder; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
]

/** The page's lists of pull requests, by their key in `PullSections`. */
export type PullList = keyof PullSections

export const PULL_LIST_LABELS: Record<PullList, string> = { requested: 'Review requested', mine: 'Your pull requests', reviewed: 'Recently reviewed' }

const PULL_LISTS: readonly PullList[] = ['requested', 'mine', 'reviewed']

/** A layer of a stack, with its place and the layer it sits on, which is not always the one before it. */
export interface Layer {
  entry: PullEntry
  place: StackPlace
  /** The layer under it. Null for the bottom. */
  under: number | null
}

/** A layer of the stack that another list on the page holds. */
export interface Elsewhere {
  layer: number
  list: PullList
}

/**
 * One place in a list. A pull request on its own, with its place when it is the one layer of its stack the list holds.
 * Or a stack: the layers of it the list holds, bottom first, the lowest of them drawn whole.
 */
export type PullUnit =
  | { kind: 'pull'; key: string; entry: PullEntry; place: StackPlace | null; elsewhere: Elsewhere[] }
  | { kind: 'stack'; key: string; id: string; of: number; /** The branch its bottom would merge into. */ base: string | null; layers: Layer[]; elsewhere: Elsewhere[] }

export type ArrangedPulls = Record<PullList, PullUnit[]>

const timeOf = (iso: string | undefined): number | null => {
  const at = Date.parse(iso ?? '')
  return Number.isFinite(at) ? at : null
}

const entriesOf = (unit: PullUnit): PullEntry[] => (unit.kind === 'stack' ? unit.layers.map(({ entry }) => entry) : [unit.entry])

/**
 * Units in the order chosen, by when GitHub last updated them. A list GitHub gave no times for, the others reviewed,
 * comes newest first, so Oldest turns it round.
 */
function inOrder(units: PullUnit[], order: PageOrder): PullUnit[] {
  const times = units.map((unit) => entriesOf(unit).map(({ pull }) => timeOf(pull?.updatedAt)))
  if (!times.every((each) => each.every((at) => at !== null))) return order === 'newest' ? units : [...units].reverse()
  const keyed = units.map((unit, at) => ({ unit, time: order === 'newest' ? Math.max(...(times[at] as number[])) : Math.min(...(times[at] as number[])) }))
  return keyed.sort((a, b) => (order === 'newest' ? b.time - a.time : a.time - b.time)).map(({ unit }) => unit)
}

/** The page's lists of pull requests, each as units in the order chosen. `places` are the stacked ones' places, by address. */
export function arrangePulls(sections: PullSections, places: ReadonlyMap<string, StackPlace>, order: PageOrder): ArrangedPulls {
  const placeOf = (entry: PullEntry) => (entry.pull ? (places.get(entry.pull.url) ?? null) : null)

  // Which list holds each layer of each stack, and the branch each stack's bottom would merge into.
  const held = new Map<string, Elsewhere[]>()
  const bases = new Map<string, string>()
  for (const list of PULL_LISTS) {
    for (const entry of sections[list]) {
      const place = placeOf(entry)
      if (!place) continue
      held.set(place.id, [...(held.get(place.id) ?? []), { layer: place.layer, list }])
      if (place.layer === 1 && entry.pull?.baseBranch) bases.set(place.id, entry.pull.baseBranch)
    }
  }

  const arranged = (list: PullList): PullUnit[] => {
    // Each pull request on its own, and each stack at the place of its first layer here.
    const units: (PullUnit | Layer[])[] = []
    const stacks = new Map<string, Layer[]>()
    for (const entry of sections[list]) {
      const place = placeOf(entry)
      if (!place) {
        units.push({ kind: 'pull', key: entry.pull?.url ?? entry.id ?? `${entry.repo}#${entry.number}`, entry, place: null, elsewhere: [] })
        continue
      }
      const layer = { entry, place, under: place.below ? (places.get(place.below)?.layer ?? null) : null }
      const layers = stacks.get(place.id)
      if (layers) layers.push(layer)
      else {
        const first = [layer]
        stacks.set(place.id, first)
        units.push(first)
      }
    }

    const whole = units.map((unit): PullUnit => {
      if (!Array.isArray(unit)) return unit
      const layers = [...unit].sort((a, b) => a.place.layer - b.place.layer)
      const { id, of } = layers[0]!.place
      const elsewhere = (held.get(id) ?? []).filter((layer) => layer.list !== list).sort((a, b) => a.layer - b.layer)
      if (layers.length === 1) return { kind: 'pull', key: layers[0]!.entry.pull!.url, entry: layers[0]!.entry, place: layers[0]!.place, elsewhere }
      return { kind: 'stack', key: `stack:${id}`, id, of, base: bases.get(id) ?? null, layers, elsewhere }
    })
    return inOrder(whole, order)
  }

  return { requested: arranged('requested'), mine: arranged('mine'), reviewed: arranged('reviewed') }
}

/** Issues in the order chosen, by when GitHub last updated them. */
export function orderIssues(issues: readonly GitHubIssue[], order: PageOrder): GitHubIssue[] {
  const time = ({ updatedAt }: GitHubIssue) => timeOf(updatedAt) ?? 0
  return [...issues].sort((a, b) => (order === 'newest' ? time(b) - time(a) : time(a) - time(b)))
}

const listed = (numbers: readonly number[]) => (numbers.length === 1 ? `${numbers[0]}` : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`)

/** Where the layers another list holds are, in plain words ("Layer 1 is under Your pull requests."). Null when none are. */
export function elsewhereWords(elsewhere: readonly Elsewhere[]): string | null {
  if (elsewhere.length === 0) return null
  const lists = [...new Set(elsewhere.map(({ list }) => list))]
  return lists
    .map((list) => {
      const numbers = elsewhere.filter((layer) => layer.list === list).map(({ layer }) => layer)
      return numbers.length === 1 ? `Layer ${numbers[0]} is under ${PULL_LIST_LABELS[list]}.` : `Layers ${listed(numbers)} are under ${PULL_LIST_LABELS[list]}.`
    })
    .join(' ')
}

/** A stack's one quiet heading: how many layers, the branch its bottom would merge into, and where any others are. */
export function stackHeading(unit: Extract<PullUnit, { kind: 'stack' }>): string {
  const words = elsewhereWords(unit.elsewhere)
  return `Stack of ${unit.of}${unit.base ? ` on ${unit.base}` : ''}${words ? ` · ${words}` : ''}`
}
