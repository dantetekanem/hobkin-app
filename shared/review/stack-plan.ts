/**
 * The plan for making a change a stack (spec 060): layers, bottom first, cut from what a review already holds, with no
 * host and no agent. First one mechanical layer when the change has any (lockfiles, generated files, moves,
 * formatting, dependency manifests). Then the code zone by zone, deepest first, which is the window's zone order read
 * backwards, so what is called comes before what calls it. A zone takes its tests, and the TLA+ models that name it.
 * Zones join a layer while it stays at 300 changed lines or under, and a zone past that is a layer of its own, which
 * the agent splits further. The change's spec and docs go in the first layer that is not mechanical. Every changed
 * file is in one layer. Pure, so the window and the host make the same plan.
 */
import { isLockfile, isTestPath } from '../../packages/change-review/src/triage.ts'
import { zoneOf } from '../../packages/change-review/src/zones.ts'
import type { NodeBucket, Review, ReviewFile, ReviewNode, ReviewZone } from './types.ts'

/** Where the plan starts a new layer, and where the button asks for attention: the lines a reviewer takes in at a sitting. */
export const LAYER_LINES = 300

export type StackLayerKind = 'mechanical' | 'behaviour'

export interface StackLayer {
  /** From 1, the bottom. */
  number: number
  kind: StackLayerKind
  title: string
  /** Paths, each in this layer only. */
  files: string[]
  additions: number
  deletions: number
  /** Additions plus deletions, as land offers count them. */
  lines: number
  /** How many of the review's parts that need the reviewer this layer holds. */
  needsYou: number
  /** One zone past `LAYER_LINES` stands alone here: the agent splits it further, or says why not. */
  splitFurther: boolean
}

export interface StackPlan {
  layers: StackLayer[]
}

type Mechanical = 'lockfile' | 'generated' | 'moves' | 'formatting' | 'dependencies'

const MECHANICAL_NAMES: Record<Mechanical, string> = {
  lockfile: 'Lockfiles',
  generated: 'Generated files',
  moves: 'Moves',
  formatting: 'Formatting',
  dependencies: 'Dependency manifests',
}

const BUCKET_MECHANICAL: Partial<Record<NodeBucket, Mechanical>> = { lockfile: 'lockfile', generated: 'generated', moved: 'moves', format: 'formatting' }
const MANIFEST = /(^|\/)(Gemfile|package\.json|requirements[^/]*\.txt|pyproject\.toml|setup\.py|go\.mod|Cargo\.toml|composer\.json|Podfile|mix\.exs|[^/]+\.gemspec)$/
const DOCS = /\.(md|mdx|markdown|rst|adoc|txt)$|(^|\/)(docs?|_specs)\//i
const MODEL = /\.tla$/

interface Fact {
  path: string
  additions: number
  deletions: number
  lines: number
  mechanical: Mechanical | null
  docs: boolean
  model: boolean
  test: boolean
  zone: string
  needsYou: number
  covers: string[]
}

const linesOf = (file: ReviewFile) => file.additions + file.deletions
const isChanged = (file: ReviewFile) => file.status !== 'unchanged'

/**
 * The changed lines a reviewer reads: the change's, without lockfiles and generated files. What the button's emphasis
 * counts against `LAYER_LINES`.
 */
export function readLines(review: Review): number {
  return facts(review).facts.reduce((sum, fact) => sum + (fact.mechanical === 'lockfile' || fact.mechanical === 'generated' ? 0 : fact.lines), 0)
}

function facts(review: Review): { facts: Fact[]; zones: Map<string, ReviewZone>; order: string[] } {
  const nodesOf = new Map<string, ReviewNode[]>()
  for (const node of review.nodes) if (node.subtitle && node.kind !== 'context' && node.kind !== 'criterion') nodesOf.set(node.subtitle, [...(nodesOf.get(node.subtitle) ?? []), node])
  const zones = new Map((review.zones ?? []).map((zone) => [zone.id, zone]))
  const order = (review.zones ?? []).map((zone) => zone.id)
  const specPath = review.spec?.path

  const found = review.files.filter(isChanged).map((file): Fact => {
    const nodes = nodesOf.get(file.path) ?? []
    const bucket = nodes.find((node) => node.bucket)?.bucket
    const test = bucket ? bucket === 'test' : nodes.some((node) => node.kind === 'test') || isTestPath(file.path)
    const mechanical = (bucket ? BUCKET_MECHANICAL[bucket] : isLockfile(file.path) ? 'lockfile' : undefined) ?? (MANIFEST.test(file.path) ? 'dependencies' : null)
    const docs = file.path === specPath || (bucket ? bucket === 'docs' : DOCS.test(file.path))
    const named = nodes.find((node) => node.zone)?.zone
    // A file no zone names, as in a review from an older host, is placed by its path as the window's own rule places it.
    const place = named && zones.has(named) ? zones.get(named)! : placed(file.path, test)
    if (!zones.has(place.id)) {
      zones.set(place.id, place)
      order.push(place.id)
    }
    return {
      path: file.path,
      additions: file.additions,
      deletions: file.deletions,
      lines: linesOf(file),
      mechanical,
      docs,
      model: MODEL.test(file.path),
      test,
      zone: place.id,
      needsYou: nodes.filter((node) => node.attention?.tier === 'needs-you').length,
      covers: nodes.flatMap((node) => node.covers ?? []),
    }
  })
  return { facts: found, zones, order }
}

function placed(path: string, test: boolean): ReviewZone {
  const { id, layer, subject, label, component } = zoneOf(path, test ? 'test' : undefined)
  return { id, layer, subject, label, ...(component ? { component } : {}) }
}

/** A group of files that go into a layer together: one code zone with its tests, or the docs. */
interface Unit {
  title: string
  files: Fact[]
  lines: number
  /** Where it sits in the window's zone order, or -1 for the docs, which come first. */
  rank: number
}

const sum = (list: readonly Fact[], pick: (fact: Fact) => number) => list.reduce((total, fact) => total + pick(fact), 0)

const joined = (words: string[]) => (words.length < 2 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`)

export function stackPlan(review: Review): StackPlan {
  const { facts: all, zones, order } = facts(review)
  const rankOf = new Map(order.map((id, rank) => [id, rank]))
  const nodeZone = new Map(review.nodes.flatMap((node) => (node.subtitle ? [[node.id, all.find((fact) => fact.path === node.subtitle)?.zone] as const] : [])))

  const mechanical = all.filter((fact) => fact.mechanical)
  const rest = all.filter((fact) => !fact.mechanical)
  const code = rest.filter((fact) => !fact.docs && !fact.model && !fact.test)
  const codeZones = new Set(code.map((fact) => fact.zone))

  /** The code zone a test goes with: the one it mirrors, else the deepest it covers. Its own zone when it has none. */
  const homeOfTest = (fact: Fact): string => {
    const own = zones.get(fact.zone)
    const mirror = own ? `${own.component ?? '-'}/${own.layer.replace(/^test:/, '')}/${own.subject}` : ''
    if (codeZones.has(mirror)) return mirror
    const covered = fact.covers.map((id) => nodeZone.get(id)).filter((id): id is string => id != null && codeZones.has(id))
    return covered.sort((a, b) => (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0))[0] ?? fact.zone
  }
  /** The code zone whose subject a TLA+ model's path names, or none: it then goes with the docs. */
  const homeOfModel = (fact: Fact): string | null => {
    const path = fact.path.toLowerCase()
    return [...codeZones].find((id) => {
      const subject = zones.get(id)?.subject.toLowerCase()
      return subject != null && subject.length > 2 && path.includes(subject)
    }) ?? null
  }

  const byZone = new Map<string, Fact[]>()
  const docs: Fact[] = []
  const add = (zone: string, fact: Fact) => byZone.set(zone, [...(byZone.get(zone) ?? []), fact])
  for (const fact of rest) {
    if (fact.model) {
      const home = homeOfModel(fact)
      if (home) add(home, fact)
      else docs.push(fact)
    } else if (fact.docs) docs.push(fact)
    else if (fact.test) add(homeOfTest(fact), fact)
    else add(fact.zone, fact)
  }
  // Each zone's code before its tests and models, in the order the review lists them.
  const units: Unit[] = [...byZone].map(([zone, files]) => ({
    title: zones.get(zone)?.label ?? zone,
    files: [...files.filter((fact) => !fact.test && !fact.model), ...files.filter((fact) => fact.test), ...files.filter((fact) => fact.model)],
    lines: sum(files, (fact) => fact.lines),
    rank: rankOf.get(zone) ?? 0,
  }))
  // Deepest first: the window's order, read backwards.
  units.sort((a, b) => b.rank - a.rank)
  if (docs.length > 0) units.unshift({ title: 'Spec and docs', files: docs, lines: sum(docs, (fact) => fact.lines), rank: -1 })

  const layers: StackLayer[] = []
  const layer = (kind: StackLayerKind, title: string, files: Fact[], splitFurther = false) =>
    layers.push({ number: layers.length + 1, kind, title, files: files.map((fact) => fact.path), additions: sum(files, (fact) => fact.additions), deletions: sum(files, (fact) => fact.deletions), lines: sum(files, (fact) => fact.lines), needsYou: sum(files, (fact) => fact.needsYou), splitFurther })

  if (mechanical.length > 0) {
    const kinds = Object.keys(MECHANICAL_NAMES).filter((kind) => mechanical.some((fact) => fact.mechanical === kind)) as Mechanical[]
    layer('mechanical', joined(kinds.map((kind, at) => (at === 0 ? MECHANICAL_NAMES[kind] : MECHANICAL_NAMES[kind].toLowerCase()))), mechanical)
  }

  let current: Unit[] = []
  const close = () => {
    if (current.length === 0) return
    const named = current.filter((unit) => unit.rank >= 0)
    const title = named.length === 0 ? current[0]!.title : named.length === 1 ? named[0]!.title : `${named[0]!.title} and ${named.length - 1} more`
    layer('behaviour', title, current.flatMap((unit) => unit.files))
    current = []
  }
  for (const unit of units) {
    if (unit.lines > LAYER_LINES) {
      close()
      layer('behaviour', unit.title, unit.files, unit.rank >= 0)
    } else {
      if (sum(current.flatMap((held) => held.files), (fact) => fact.lines) + unit.lines > LAYER_LINES) close()
      current.push(unit)
    }
  }
  close()
  return { layers }
}
