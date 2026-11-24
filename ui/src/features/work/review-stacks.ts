import type { FinishedChange, StackPlace } from '#shared/protocol/work.ts'
import { pullOfReview, reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import { layerReviewId } from '../review/stack-strip.ts'
import type { ReviewRow } from './ai-reviews.ts'
import type { StackOf } from './review-story.ts'

/**
 * The Review list's rows as a stack is drawn on Work (_specs/067-review-list-one-list, "Stacks and one row each"): one
 * row for each layer, a pull request review and a change review of the same layer made one; a pull request under the
 * project whose repository it is in; a stack as one entry that the order never splits. Pure, so it is tested without a
 * window.
 */

/** Where a row stands in a stack, read from the finished changes: null for a row that is in none. */
export type PlaceOf = (row: ReviewRow) => StackPlace | null

/**
 * The finished change a row is of: by the row's own review, or for a pull request by the change that opened it, or else
 * the change at the pull request's commit, since a layer can be read as a pull request too.
 */
function changeLookup(changes: readonly FinishedChange[]): (row: ReviewRow) => FinishedChange | null {
  const byReview = new Map<string, FinishedChange>()
  const byPull = new Map<string, FinishedChange>()
  const byHead = new Map<string, FinishedChange>()
  for (const change of changes) {
    byReview.set(layerReviewId(change), change)
    const opened = change.pr ? targetOfReviewId(change.pr) : null
    if (opened) byPull.set(reviewIdOf(opened), change)
    if (change.head && !byHead.has(change.head)) byHead.set(change.head, change)
  }
  return ({ item }) => byReview.get(item.id) ?? byPull.get(item.id) ?? (item.head ? byHead.get(item.head) : undefined) ?? null
}

/** Where each row stands in its stack. Built once for the list and the work, then asked for every row. */
export function placeLookup(changes: readonly FinishedChange[]): PlaceOf {
  const changeOf = changeLookup(changes)
  return (row) => changeOf(row)?.stack ?? null
}

/** The stack a row is in and its layer, as the story reads it. */
export const stackLookupOf = (placeOf: PlaceOf): StackOf => (row) => {
  const place = placeOf(row)
  return place ? { id: place.id, layer: place.layer } : null
}

/** What makes two rows one layer: the same stack and layer, or else the same commit; a row with neither stands alone. */
function layerKeyOf(row: ReviewRow, placeOf: PlaceOf): string {
  const place = placeOf(row)
  if (place) return `layer:${place.id}:${place.layer}`
  return row.item.head ? `head:${row.item.head}` : `id:${row.item.id}`
}

/**
 * The one row of a layer: the pull request's, since merging happens there, else the one with a pull request, else the
 * first. It takes what it lacks from the other: its grades, its summary, its priority and a merge that did not land.
 */
function oneOf(group: readonly ReviewRow[]): ReviewRow {
  const shown = group.find((row) => row.item.kind === 'pull' && row.link) ?? group.find((row) => row.item.kind === 'pull') ?? group.find((row) => row.link) ?? group[0]!
  if (group.length === 1) return shown
  const others = group.filter((row) => row !== shown)
  const lent = <K extends 'needs' | 'summary' | 'priority' | 'merge' | 'rate'>(key: K): ReviewRow[K] => (shown[key] ?? others.find((row) => row[key] != null)?.[key] ?? null) as ReviewRow[K]
  return { ...shown, needs: lent('needs'), summary: lent('summary'), priority: lent('priority'), merge: lent('merge'), rate: lent('rate') }
}

/** The rows with one for each layer, each at the place its first row held. */
export function oneRowPerLayer(rows: readonly ReviewRow[], placeOf: PlaceOf): ReviewRow[] {
  const groups = new Map<string, ReviewRow[]>()
  for (const row of rows) {
    const key = layerKeyOf(row, placeOf)
    const own = groups.get(key)
    if (own) own.push(row)
    else groups.set(key, [row])
  }
  return [...groups.values()].map(oneOf)
}

/** The hobkin project a row is listed under: for a pull request, the project whose repository it is in, else its own name. */
export function projectLookup(projects: readonly { slug: string; repo?: string | null }[]): (row: ReviewRow) => string {
  const byRepo = new Map<string, string>()
  for (const { slug, repo } of projects) if (repo) byRepo.set(repo.toLowerCase(), slug)
  return ({ item }) => {
    if (item.kind !== 'pull') return item.project
    const pull = pullOfReview(item.id, item.pr)
    return (pull ? byRepo.get(`${pull.owner}/${pull.repo}`) : undefined) ?? item.project
  }
}

export interface LayerRow {
  row: ReviewRow
  place: StackPlace
}

/** A stack on the list: its layers bottom first, which land in that order. */
export type ListEntry = { kind: 'row'; row: ReviewRow } | { kind: 'stack'; id: string; size: number; name: string | null; layers: LayerRow[] }

/** How many rows an entry holds. */
export const rowsIn = (entry: ListEntry): number => (entry.kind === 'row' ? 1 : entry.layers.length)

/**
 * The rows in the order picked, with each stack of two layers or more as one entry at the place of its first row, so the
 * order never splits it, and its layers bottom first. A layer alone in its stack is a row.
 */
export function entriesOf(ordered: readonly ReviewRow[], placeOf: PlaceOf): ListEntry[] {
  const stacks = new Map<string, LayerRow[]>()
  for (const row of ordered) {
    const place = placeOf(row)
    if (place) stacks.set(place.id, [...(stacks.get(place.id) ?? []), { row, place }])
  }
  for (const layers of stacks.values()) layers.sort((a, b) => a.place.layer - b.place.layer)

  const entries: ListEntry[] = []
  const drawn = new Set<string>()
  for (const row of ordered) {
    const place = placeOf(row)
    const layers = place ? stacks.get(place.id)! : []
    if (!place || layers.length < 2) {
      entries.push({ kind: 'row', row })
      continue
    }
    if (drawn.has(place.id)) continue
    drawn.add(place.id)
    const size = Math.max(...layers.map((layer) => Math.max(layer.place.of, layer.place.layer)))
    entries.push({ kind: 'stack', id: place.id, size, name: layers.find((layer) => layer.place.name)?.place.name ?? null, layers })
  }
  return entries
}

/** The stack's one quiet heading, in Work's words. */
export const stackHeading = ({ size, name }: { size: number; name: string | null }): string => (name ? `Stack of ${size} · ${name}` : `Stack of ${size}`)

export interface ProjectEntries {
  project: string
  entries: ListEntry[]
  /** The rows there are under it, a stack's layers counted one by one. */
  count: number
}

/** The entries cut by project, the projects in the order of their first entry; a stack is under its first layer's project. */
export function projectEntries(entries: readonly ListEntry[], projectOf: (row: ReviewRow) => string): ProjectEntries[] {
  const projects = new Map<string, ProjectEntries>()
  for (const entry of entries) {
    const project = projectOf(entry.kind === 'row' ? entry.row : entry.layers[0]!.row)
    const own = projects.get(project) ?? { project, entries: [], count: 0 }
    own.entries.push(entry)
    own.count += rowsIn(entry)
    projects.set(project, own)
  }
  return [...projects.values()]
}
