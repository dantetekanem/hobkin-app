import type { DecidedChange, WorkMetrics } from '#shared/protocol/metrics.ts'
import type { FinishedChange, Grade, ModelFact, PrMode, ProjectState, WorkProject, WorkState, YoloProject, YoloState } from '#shared/protocol/work.ts'
import type { AssessmentStatus } from '#shared/review/assessment.ts'
import type { ReviewList } from '#shared/review/status.ts'
import { SERIES_COLOR, type DaySeries } from '../numbers/chart-kit.ts'
import { dayWords, lastDays, localDay, TILE_DAYS, workTiles, type Tile } from '../numbers/format.ts'
import { READ_WORDS, type MetricsReadState } from '../numbers/metrics-store.ts'
import { finishedReviewId } from '../review/entry.ts'
import { groupOf } from '../work/ai-reviews.ts'
import { needsFirst } from '../work/finished-cards.ts'
import { inPlace, readinessRow, stillToSetUp, waitingChange, type PartRow, type ReadinessTone } from '../work/yolo-page.ts'

/**
 * One project's page as data (_specs/053-work-control-room, "A page for each project"): what each section shows, read
 * from what the window already knows (Work's state, YOLO mode, the numbers, the AI reviews and the agents at work). It
 * adds no rule of its own, so the page shows nothing Work does not know. Pure, so it is tested without a window.
 */

/** Where each section sits on the page, so the flow's numbers can bring it into view. */
export const SECTION_ID = {
  waiting: 'project-waiting',
  atWork: 'project-at-work',
  queue: 'project-queue',
  merged: 'project-merged',
  models: 'project-models',
  readiness: 'project-readiness',
} as const

/** The most merges Merged lately lists. The rest are counted under it. */
export const MERGED_SHOWN = 10

/** An agent as the page reads it: the agents list's own fields, so a row needs nothing else. */
export interface AgentLike {
  id: string
  title: string
  /** For a work agent, its project's slug. */
  project: string
  doing: string
  kind: 'work' | 'routine' | 'session'
  hue: number
  asks?: string
}

/** This project's AI reviews, as the list the host keeps says them (`review.list`). */
export interface ProjectReviews {
  /** Each of its finished changes the list has, by item: the review's answer, or where it stands. */
  items: Record<string, { answer: AssessmentStatus | null; head: string | null }>
  counts: { running: number; ready: number; failed: number }
}

export interface ProjectInput {
  slug: string
  work: WorkState | null
  /** YOLO mode, or null from a host that does not say. */
  yolo: YoloState | null
  /** The last 30 days of numbers, or null while there are none. */
  metrics: WorkMetrics | null
  metricsState: MetricsReadState
  /** Its AI reviews (`reviewsOf`), or null while the list has not come. */
  reviews: ProjectReviews | null
  /** The agents at work now. The page's At work section reads them itself, so the rest of it never waits on them. */
  agents?: readonly AgentLike[]
  live: boolean
}

export interface Heading {
  slug: string
  name: string
  priority: Grade
  prMode: PrMode
  /** Where its finished work goes, in a word or two: "Draft PRs". */
  prWords: string
  /** The model and how hard it thinks, in hobkin's word. */
  level: string
  paused: boolean
  /** How ready it is for YOLO mode, as its chip says it. Null when YOLO mode does not know it. */
  yolo: { label: string; tone: ReadinessTone; title: string } | null
  /** Its repository on GitHub, `owner/name`, when it has one. */
  repo: string | null
  lookError: string | null
}

export interface TilesView {
  tiles: Tile[]
  /** The numbers are being read for the first time: the tiles keep their boxes and say so. */
  loading: boolean
  /** Why the numbers are missing or old, in a line. Null when they are as they should be. */
  note: string | null
}

/** The four numbers from queued to merged. Merged is null while there are no numbers. */
export interface Flow {
  queued: number
  working: number
  waiting: number
  merged: number | null
}

/** A section's rows, and the one line it says when it has none. */
export interface Section<Row> {
  rows: Row[]
  empty: string
}

export interface WaitingRow {
  key: string
  item: string
  title: string
  grade: Grade | null
  /** Why it waits, in hobkin's words. */
  why: string
  /** It is in "Needs you" or "Left for you": no group's yes carries it. */
  needsYou: boolean
  /** "64 lines · 4 files", when the survey read it. */
  size: string | null
  /** Its AI review at the commit it is at, when the list has one. */
  answer: AssessmentStatus | null
  /** The review it opens. */
  review: string | null
}

export interface AgentRow {
  id: string
  title: string
  doing: string
  /** What it waits on the user for. */
  asks: string | null
  hue: number
}

export interface QueueLine {
  key: string
  title: string
  grade: Grade | null
  /** Why it is queued, what it waits on, or that it was skipped. */
  words: string
  /** About how many tokens it takes: "~180k". */
  cost: string | null
  skipped: boolean
  picked: boolean
  /** It waits on something before it can start. */
  waits: boolean
}

export interface QueueSection extends Section<QueueLine> {
  /** A row opens its row on Work. Not while the project is paused: Work leaves a paused project's rows out. */
  opens: boolean
  note: string | null
}

export interface MergedLine {
  item: string
  title: string
  /** The day: "Today", "Yesterday", "Sat, Nov 14". */
  when: string
  outcome: DecidedChange['outcome']
  /** "by itself", "by you" or "declined". */
  words: string
  /** How often it was sent back first, or null when never. */
  sentBack: string | null
  /** The commit it merged at, short. */
  head: string | null
  /** The general rate YOLO mode merged it at, for a merge by itself whose ledger says. */
  rate: number | null
  /** The review it opens: only one the window knows, since opening an unknown one would prepare a new review. */
  review: string | null
}

export type MergedSection =
  | { kind: 'list'; rows: MergedLine[]; more: number; empty: string }
  | { kind: 'days'; days: string[]; series: DaySeries[]; line: DaySeries; figure: string; note: string }
  | { kind: 'none'; note: string }

export type ReadinessSection =
  | {
      known: true
      state: string
      tone: ReadinessTone
      detail: string
      /** When its readiness was last recorded, as an ISO time; the section says it in words, following the clock. */
      checkedAt: string | null
      groups: { heading: string; rows: PartRow[] }[]
      inPlace: string | null
      yoloOn: boolean
    }
  | { known: false; empty: string }

export interface TakenPage {
  kind: 'taken'
  heading: Heading
  tiles: TilesView
  flow: Flow
  waiting: Section<WaitingRow>
  atWork: Section<AgentRow>
  queue: QueueSection
  merged: MergedSection
  models: { facts: ModelFact[]; empty: string }
  readiness: ReadinessSection
}

export type ProjectPage = { kind: 'unknown'; name: string; line: string } | { kind: 'not-taken'; name: string; state: string; line: string } | TakenPage

const PR_WORDS: Record<PrMode, string> = { off: 'Local branches', draft: 'Draft PRs', published: 'PRs' }
const STATE_WORDS: Record<Exclude<ProjectState, 'chosen'>, string> = { proposed: 'Proposed', skipped: 'Skipped', dropped: 'Dropped' }
const OUTCOME_WORDS: Record<DecidedChange['outcome'], string> = { 'merged-by-itself': 'by itself', 'merged-by-you': 'by you', declined: 'declined' }

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** This project's part of the AI reviews list: each of its finished changes' reviews, and how many run, are ready or failed. */
export function reviewsOf(list: ReviewList, slug: string): ProjectReviews {
  const items: ProjectReviews['items'] = {}
  const counts = { running: 0, ready: 0, failed: 0 }
  for (const review of list.reviews) {
    if (review.kind !== 'change' || review.project !== slug) continue
    const group = groupOf(review)
    // One that never ran and waits for nothing is no review the window can open.
    if (!group) continue
    if (group !== 'unmerged') counts[group] += 1
    const item = review.id.split(':').at(-1)!
    items[item] = { answer: review.assessment ?? null, head: review.assessment?.head ?? review.head ?? null }
  }
  return { items, counts }
}

/** Its work agents, the ones waiting for the user first. A routine and the user's own hobkins are no project's work. */
export function atWorkOf(agents: readonly AgentLike[], slug: string): AgentRow[] {
  const own = agents.filter((agent) => agent.kind === 'work' && agent.project === slug)
  return [...own.filter(({ asks }) => asks), ...own.filter(({ asks }) => !asks)].map(({ id, title, doing, asks, hue }) => ({ id, title, doing, asks: asks ?? null, hue }))
}

function headingOf(project: WorkProject, yolo: YoloState | null, workOn: boolean, finished: WorkState['finished']): Heading {
  const ready = yolo?.projects.find(({ slug }) => slug === project.slug)
  const readiness = ready ? readinessOf(ready, workOn, finished) : null
  const chip = readiness && ready ? { label: `YOLO ${readiness.state.charAt(0).toLowerCase()}${readiness.state.slice(1)}`, tone: readiness.tone, title: `${yolo?.on ? '' : 'YOLO mode is off. '}${readiness.detail}` } : null
  return {
    slug: project.slug,
    name: project.name,
    priority: project.priority,
    prMode: project.prMode,
    prWords: PR_WORDS[project.prMode] ?? project.prMode,
    level: project.level,
    paused: project.paused,
    yolo: chip,
    repo: project.repo ?? null,
    lookError: project.lookError,
  }
}

/** Where its readiness stands, as the YOLO page's row says it. The time it was checked is the section's to say, as it follows the clock. */
function readinessOf(project: YoloProject, workOn: boolean, finished: WorkState['finished']) {
  const { state, tone, detail } = readinessRow(project, { workOn, now: 0, zone: 'UTC', waiting: waitingChange(project, finished) })
  return { state, tone, detail }
}

function sizeOf(change: FinishedChange): string | null {
  if (!change.size) return null
  return `${plural(change.size.lines, 'line')} · ${plural(change.size.files, 'file')}`
}

function waitingOf(work: WorkState, slug: string, reviews: ProjectReviews | null, live: boolean): WaitingRow[] {
  return needsFirst(work.finished).flatMap(({ name, changes }) =>
    changes
      .filter((change) => change.slug === slug)
      .map((change) => {
        const known = reviews?.items[change.item]
        // An answer for an older commit says nothing of this one, as on its card.
        const answer = known?.answer && (change.head === null || known.head === null || known.head === change.head) ? known.answer : null
        return {
          key: change.key,
          item: change.item,
          title: change.title,
          grade: change.grade,
          why: change.reason,
          needsYou: name === 'needs' || name === 'left',
          size: sizeOf(change),
          answer,
          review: finishedReviewId(change, live),
        }
      }),
  )
}

function queueOf(work: WorkState, project: WorkProject): QueueSection {
  const rows = work.queue
    .filter((row) => row.slug === project.slug)
    .map((row) => ({
      key: row.key,
      title: row.title,
      grade: row.grade,
      words: row.skipped ? 'skipped' : row.waiting ? `waiting: ${row.waiting}` : (row.why ?? ''),
      cost: row.tokens ? `~${compact.format(row.tokens).toLowerCase()}` : null,
      skipped: row.skipped,
      picked: row.picked,
      waits: Boolean(row.waiting) && !row.skipped,
    }))
  return {
    rows,
    empty: project.paused ? 'Nothing is queued here, and nothing new starts while it is paused.' : 'Nothing is queued here.',
    opens: !project.paused,
    note: project.paused && rows.length ? 'Paused: nothing here starts until you resume it.' : null,
  }
}

const sentBackWords = (times: number): string | null => (times <= 0 ? null : times === 1 ? 'sent back once' : `sent back ${times} times`)

function mergedOf(input: ProjectInput, yolo: YoloProject | undefined, reviews: ProjectReviews | null): MergedSection {
  const { metrics, metricsState, slug, live } = input
  if (!metrics) return { kind: 'none', note: READ_WORDS[metricsState] ?? READ_WORDS.failed! }
  if (!metrics.decided) {
    const days = lastDays(metrics.projects.find((project) => project.slug === slug)?.days ?? [], TILE_DAYS)
    const pick = (count: (day: (typeof days)[number]) => number) => days.map(count)
    const merged = days.reduce((total, day) => total + day.mergedByItself + day.mergedByYou, 0)
    return {
      kind: 'days',
      days: days.map((day) => day.day),
      series: [
        { key: 'itself', label: 'by itself', color: SERIES_COLOR.itself, values: pick((day) => day.mergedByItself) },
        { key: 'you', label: 'by you', color: SERIES_COLOR.you, values: pick((day) => day.mergedByYou) },
      ],
      line: { key: 'declined', label: 'declined', color: SERIES_COLOR.declined, values: pick((day) => day.declined) },
      figure: merged ? `${merged} merged` : 'nothing merged yet',
      note: 'The list of each merge needs a newer host. These are its merges by day.',
    }
  }
  const rates = new Map((yolo?.merged ?? []).map((merge) => [merge.item, merge.rate]))
  const own = metrics.decided.filter((change) => change.slug === slug).toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const rows = own.slice(0, MERGED_SHOWN).map(
    (change): MergedLine => ({
      item: change.item,
      title: change.title,
      when: dayWords(localDay(Date.parse(change.at)), metrics.to),
      outcome: change.outcome,
      words: OUTCOME_WORDS[change.outcome],
      sentBack: sentBackWords(change.sentBack),
      head: change.head ?? null,
      rate: change.outcome === 'merged-by-itself' ? (rates.get(change.item) ?? null) : null,
      review: !live ? 'sample' : reviews?.items[change.item] ? finishedReviewId(change, live) : null,
    }),
  )
  return { kind: 'list', rows, more: own.length - rows.length, empty: 'Nothing merged or declined here in 30 days.' }
}

function tilesOf(input: ProjectInput, waiting: readonly WaitingRow[]): TilesView {
  const { metrics, metricsState, slug, reviews } = input
  const days = metrics ? (metrics.projects.find((project) => project.slug === slug)?.days ?? []) : null
  const tiles = workTiles({ days, waiting: { count: waiting.length, oldestMs: null }, reviews: reviews?.counts ?? null, tokens: null, merged: 'period' })
  // How long the oldest has waited is not known, so the tile says what kind of wait they are.
  const needs = waiting.filter(({ needsYou }) => needsYou).length
  if (waiting.length) tiles[0] = { ...tiles[0]!, context: `${needs} need${needs === 1 ? 's' : ''} you · ${waiting.length - needs} ready` }
  const note =
    metricsState === 'older-host'
      ? READ_WORDS['older-host']
      : metricsState === 'failed'
        ? metrics
          ? 'The last read failed. These are the numbers read before it.'
          : READ_WORDS.failed
        : metrics?.gaps.length
          ? `Not counted: ${metrics.gaps.join('; ')}. The rest still counts.`
          : null
  return { tiles, loading: metricsState === 'loading' && !metrics, note }
}

function readinessSectionOf(yolo: YoloState | null, project: YoloProject | undefined, workOn: boolean, finished: WorkState['finished']): ReadinessSection {
  if (!yolo) return { known: false, empty: 'This hobkin does not say how YOLO mode stands.' }
  if (!project) return { known: false, empty: 'YOLO mode has not looked at this project yet.' }
  return { known: true, ...readinessOf(project, workOn, finished), checkedAt: project.checkedAt ?? null, groups: stillToSetUp(project), inPlace: inPlace(project), yoloOn: yolo.on }
}

/** What each section of the project's page shows. */
export function projectPage(input: ProjectInput): ProjectPage {
  const { slug, work, yolo, live } = input
  if (!work) return { kind: 'unknown', name: slug, line: 'This host has not said anything about work mode yet.' }
  const project = work.projects.find((candidate) => candidate.slug === slug)
  if (!project) return { kind: 'unknown', name: slug, line: `Work mode knows no project called ${slug}.` }
  if (project.state !== 'chosen') {
    return { kind: 'not-taken', name: project.name, state: STATE_WORDS[project.state] ?? 'Known', line: 'Work mode has not taken this project, so nothing runs here. Take it to queue work on it.' }
  }

  const ready = yolo?.projects.find((candidate) => candidate.slug === slug)
  const waiting = waitingOf(work, slug, input.reviews, live)
  const atWork = atWorkOf(input.agents ?? [], slug)
  const queue = queueOf(work, project)
  const merged = mergedOf(input, ready, input.reviews)
  const days = input.metrics?.projects.find((candidate) => candidate.slug === slug)?.days
  const models = project.models ?? ready?.models ?? []
  return {
    kind: 'taken',
    heading: headingOf(project, yolo, work.enabled, work.finished),
    tiles: tilesOf(input, waiting),
    flow: {
      queued: queue.rows.filter(({ skipped }) => !skipped).length,
      working: atWork.length,
      waiting: waiting.length,
      merged: days ? lastDays(days, TILE_DAYS).reduce((total, day) => total + day.mergedByItself + day.mergedByYou, 0) : null,
    },
    waiting: { rows: waiting, empty: 'Nothing waits for you here.' },
    atWork: { rows: atWork, empty: 'No agent is working here now.' },
    queue,
    merged,
    models: { facts: [...models], empty: 'No TLA+ models on its default branch.' },
    readiness: readinessSectionOf(yolo, ready, work.enabled, work.finished),
  }
}
