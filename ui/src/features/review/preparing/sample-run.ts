import type { AssessmentLogLine, AssessmentRequest, AssessmentStatus, AssessmentSummary, ChangeAssessment } from '#shared/review/assessment.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import { IDLE_STATUS, type OpenedReview, type PreparePhase, type ReviewNotes, type ReviewStatus } from '#shared/review/status.ts'
import type { NoteEntry } from '#shared/review/notes.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import type { ReviewCommands } from '../loader.ts'
import { samplePullNeeds } from '../sample/needs.ts'

/**
 * A made-up host for the sample pull requests (`isSamplePull`), so a window with no host shows a review being prepared
 * the way the host prepares one: its graph first, then its change review, step by step, with what it reviews, what it
 * does now, how far along it is and a log that grows, in about fifty-five seconds. The pull request about webhook
 * retries waits for "Start AI review"; every other sample is open at once, and "Refresh review" runs the same again over
 * it. Nothing here reaches a host. The reviews, their files and their change review are the sample source's.
 */

/** The sample pull request that waits for "Start AI review": the one about webhook retries, by both of its numbers. */
const WAITING = new Set(['pr:hobkin-sample/api/198', 'pr:hobkin-sample/api/1190'])
const WAITING_TITLE = 'Retry webhook deliveries with a backoff'
/** For a sample whose review the source cannot give. */
const MADE_UP = { title: 'A sample pull request', base: 'a3f9c2e5b17d4e0f9a61c2d8e4b7f03a15c9d2e6', head: '7d41b08aa2c94f1e8b3d6a05c7e29f4b81d3a6c0', files: 7, additions: 186, deletions: 41 }
const SUMMARY: Omit<AssessmentSummary, 'at'> = { level: 'mid', critical: false, needsYou: 1, worthALook: 2, safe: 2, storyBy: 'model' }

/** When each part of a run ends, in seconds from its start: the graph waits, is read and checked; then its review waits and checks the change out. */
const GRAPH_QUEUED = 1.5
const GRAPH_READ = 3.5
const GRAPH_BUILT = 4.5
const REVIEW_QUEUED = 5.5
const CHECKED_OUT = 7.5

interface ScriptStep {
  id: string
  seconds: number
  /** What the engine expected it to take, for the percent and the time left. */
  estimate: number
  /** How many items it goes through. Each line after its first ends one. */
  items: number
  /** What it says, seconds into it. */
  says: [number, string][]
}

/** What each step does and says, in the plain words the host's log uses. */
const STEPS: readonly ScriptStep[] = [
  { id: 'triage', seconds: 3, estimate: 4, items: 1, says: [[0, 'Sorted 7 changed files into 3 buckets. Checking what can stand in for reading them.'], [2, 'The translations are checked for missing keys instead of read.']] },
  { id: 'map-search', seconds: 7, estimate: 6, items: 1, says: [[0, 'Asking agentic-search for every changed definition in 5 files.'], [3, 'Found 14 changed definitions, 31 callers and 4 entry points.'], [6, 'deliverWebhook runs for the queue worker and for the retry job.']] },
  {
    id: 'map-proof',
    seconds: 12,
    estimate: 14,
    items: 4,
    says: [
      [0, 'Finding how this repository runs its tests.'],
      [2, "Ran 3 test files at the change's commit: they pass."],
      [5, 'Put nextDelay back as it was and ran 1 test file: it fails, so it proves it.'],
      [8, 'Put scheduleRetry back as it was and ran 2 test files: they fail, so they prove it.'],
      [11, 'Made deliverWebhook fail and ran 1 test file: it does not notice.'],
    ],
  },
  { id: 'risk-floor', seconds: 2, estimate: 2, items: 1, says: [[0, 'Rating each of the 14 definitions by the floor table.'], [1, 'Before the model: 2 high, 5 mid and 7 safe.']] },
  { id: 'risk-model', seconds: 10, estimate: 12, items: 1, says: [[0, 'Reviewing the 7 definitions that are mid, high or hold a new check, and reorganizing the map.'], [6, 'The ceiling on the backoff has no test, so deliverWebhook stays high.']] },
  { id: 'shape', seconds: 2, estimate: 2, items: 1, says: [[0, 'Grouped the definitions into 5 units, the same shape at every level.']] },
  { id: 'story', seconds: 6, estimate: 5, items: 1, says: [[0, 'Writing the story from the units.'], [4, 'The story has 5 steps, the riskiest first.']] },
  { id: 'blind-check', seconds: 5, estimate: 6, items: 1, says: [[0, 'A fresh, cheap model reads only the story and the units.'], [4, 'It told the change back as the story does. Nothing to add.']] },
]
const BEGINS = STEPS.map((_, index) => CHECKED_OUT + STEPS.slice(0, index).reduce((sum, step) => sum + step.seconds, 0))
/** When the run ends, in seconds from its start. */
export const SAMPLE_RUN_SECONDS = BEGINS.at(-1)! + STEPS.at(-1)!.seconds
const ESTIMATES = STEPS.reduce((sum, step) => sum + step.estimate, 0)
/** The run's log from the moment it is asked for: its graph, then its change review. */
const LOG: { at: number; step?: string; text: string }[] = [
  { at: 0, text: 'Asked for a review of this pull request.' },
  { at: GRAPH_QUEUED, text: 'Reading the pull request from its clone: 7 changed files.' },
  { at: GRAPH_READ, text: 'Built its graph: 14 definitions, with the callers they reach.' },
  { at: GRAPH_BUILT, text: 'Waiting its turn: one review runs at a time.' },
  { at: REVIEW_QUEUED, text: 'Checking the change out in the review tree.' },
  { at: REVIEW_QUEUED + 1.2, text: 'The review tree is at the pull request head, with its node_modules linked.' },
  ...STEPS.flatMap((step, index) => step.says.map(([offset, text]) => ({ at: BEGINS[index]! + offset, step: step.id, text }))),
]
const LOG_KEPT = 40

interface Sample {
  /** When its graph was last built and its change review last finished (ms), or null before the first. */
  built: number | null
  rated: number | null
  /** When the run under way started (ms). */
  run: number | null
  notes: ReviewNotes
}

const iso = (ms: number) => new Date(ms).toISOString()
const phaseAt = (seconds: number): PreparePhase => (seconds < GRAPH_QUEUED ? 'queued' : seconds < GRAPH_READ ? 'reading' : 'checking')

/** The change review `seconds` into a run that started at `start` (ms), as the host tells it. */
function reviewAt(seconds: number, start: number, request: AssessmentRequest): AssessmentStatus {
  const said = LOG.filter((line) => line.at <= seconds)
  const log: AssessmentLogLine[] = said.slice(-LOG_KEPT).map((line) => ({ at: iso(start + line.at * 1000), text: line.text, ...(line.step ? { step: line.step } : {}) }))
  // Every update says when the review was asked for, so a window that opens late counts from then.
  const told = { head: request.head, request, startedAt: iso(start), log }
  const steps = STEPS.map((step, index) => {
    const begin = BEGINS[index]!
    if (seconds < begin) return { id: step.id, status: 'pending', done: 0, total: step.items, seconds: null }
    if (seconds >= begin + step.seconds) return { id: step.id, status: 'done', done: step.items, total: step.items, seconds: step.seconds }
    const ended = step.says.filter(([offset], line) => line > 0 && begin + offset <= seconds).length
    return { id: step.id, status: 'running', done: step.items > 1 ? Math.min(ended, step.items) : 0, total: step.items, seconds: null }
  })
  if (seconds < REVIEW_QUEUED) return { state: 'queued', ...told, percent: 0, eta: null, now: 'waiting its turn', steps }
  const behind = STEPS.reduce((sum, step, index) => sum + step.estimate * (steps[index]!.status === 'done' ? 1 : steps[index]!.done / step.items), 0)
  // As the engine does: what is left of the estimates, scaled by how the finished steps compared with theirs.
  const finished = STEPS.filter((_, index) => steps[index]!.status === 'done')
  const scale = finished.length ? Math.min(2, Math.max(0.5, finished.reduce((sum, step) => sum + step.seconds, 0) / finished.reduce((sum, step) => sum + step.estimate, 0))) : 1
  return { state: 'running', ...told, percent: Math.floor((100 * behind) / ESTIMATES), now: said.at(-1)!.text, eta: Math.round((ESTIMATES - behind) * scale), steps }
}

/**
 * The sample pull requests' host, one for the window: each review keeps its runs while its window is closed, as the
 * host does. `clock` is in milliseconds; tests pass their own.
 */
export function sampleRuns(clock: () => number = Date.now) {
  const samples = new Map<string, Sample>()
  const sampleOf = (id: string): Sample => {
    let sample = samples.get(id)
    if (!sample) {
      const at = clock()
      // The pull request about webhooks waits for its review to be asked for. The others were reviewed a while ago.
      sample = WAITING.has(id) ? { built: null, rated: null, run: null, notes: { entries: [], draft: null } } : { built: at - 25 * 60_000, rated: at - 24 * 60_000, run: null, notes: { entries: [], draft: null } }
      samples.set(id, sample)
    }
    // A run that has had its time is over: its graph and its change review are the new ones.
    if (sample.run != null && clock() - sample.run >= SAMPLE_RUN_SECONDS * 1000) {
      sample.built = sample.run + GRAPH_BUILT * 1000
      sample.rated = sample.run + SAMPLE_RUN_SECONDS * 1000
      sample.run = null
    }
    return sample
  }

  /**
   * The commands for one sample review. `windowNotes` reads the notes the window keeps for it: a sample's notes are the
   * window's own, so they come back as the window has them, and a reload loses none.
   */
  return (id: string, source: ReviewSource, windowNotes?: (review: Review) => ReviewNotes): ReviewCommands => {
    let request: Promise<AssessmentRequest> | null = null
    let kept: Promise<ChangeAssessment | null> | null = null
    /** What it reviews: the sample review's change, under the pull request's own name. */
    const requestOf = () =>
      (request ??= source.getReview(id).then(
        (review) => review.change,
        () => MADE_UP,
      ).then((change) => {
        const target = targetOfReviewId(id)
        const pull = target?.kind === 'pull' ? target : null
        return {
          kind: 'pull' as const,
          project: pull ? `${pull.owner}/${pull.repo}` : 'hobkin-sample',
          ...(pull ? { number: pull.number } : {}),
          title: WAITING.has(id) ? WAITING_TITLE : change.title,
          base: change.base,
          head: change.head,
          files: change.files,
          added: change.additions,
          removed: change.deletions,
        }
      }))
    const assessmentOf = () => (kept ??= Promise.resolve(source.getAssessment?.(id) ?? null).catch(() => null))

    const statusOf = async (): Promise<ReviewStatus> => {
      const sample = sampleOf(id)
      if (sample.run == null && sample.built == null) return IDLE_STATUS(id)
      const asked = await requestOf()
      const summary = (await assessmentOf())?.summary ?? SUMMARY
      const rated = (at: number): AssessmentStatus => ({ state: 'ready', head: asked.head, request: asked, summary: { ...summary, at: iso(at) } })
      // Its ratings come with the change review's answer, with no monitoring known for a pull request's repository.
      const known: ReviewStatus = {
        ...IDLE_STATUS(id),
        state: 'ready',
        head: asked.head,
        preparedAt: sample.built == null ? null : iso(sample.built),
        ...(sample.rated == null ? {} : { assessment: rated(sample.rated), needs: [samplePullNeeds(asked.head)] }),
      }
      if (sample.run == null) return known
      const seconds = (clock() - sample.run) / 1000
      // The graph is built first: a review open meanwhile stays open, and one that is not has none to open yet.
      if (seconds < GRAPH_BUILT) return { ...known, state: sample.built == null ? 'preparing' : 'ready', phase: phaseAt(seconds), startedAt: iso(sample.run) }
      return { ...known, preparedAt: iso(sample.run + GRAPH_BUILT * 1000), assessment: reviewAt(seconds, sample.run, asked) }
    }

    const openedOf = async (): Promise<OpenedReview> => {
      const status = await statusOf()
      const review = await source.getReview(id)
      const rated = status.assessment?.state === 'ready' ? status.assessment : null
      const assessment = rated ? await assessmentOf() : null
      // The sample's change review, as of the run that rated it last, so a run that ends brings a new one.
      return { review, notes: windowNotes?.(review) ?? sampleOf(id).notes, status, assessment: assessment && rated ? { ...assessment, head: rated.head!, summary: rated.summary! } : null }
    }

    return (async (name: string, args: { fileId?: string; entries?: NoteEntry[]; draft?: ReviewNotes['draft'] }) => {
      switch (name) {
        case 'review.status':
          return statusOf()
        case 'review.prepare': {
          // One run at a time: asking again joins the run under way.
          const sample = sampleOf(id)
          sample.run ??= clock()
          return statusOf()
        }
        case 'review.get':
          return openedOf()
        case 'review.file':
          return source.getFile(id, args.fileId ?? '')
        case 'review.notes':
          sampleOf(id).notes = { entries: args.entries ?? [], draft: args.draft ?? null }
          return { ok: true }
        default:
          throw new Error(`A sample review has no ${name}.`)
      }
    }) as ReviewCommands
  }
}

/** The window's own sample host. */
export const sampleHost = sampleRuns()
