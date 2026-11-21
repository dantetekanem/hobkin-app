import type { AssessmentLogLine, AssessmentStatus } from '#shared/review/assessment.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import type { PreparePhase, ReviewStatus } from '#shared/review/status.ts'

/**
 * What the preparing view and the card over an open review say, as plain data, so it is tested without a window: what
 * is reviewed, what the run is doing now, how far along it is and how long it has taken, every step, and its log.
 */

export type StepState = 'done' | 'running' | 'waiting' | 'skipped' | 'failed'

export interface StepLine {
  id: string
  /** What the step does, in plain words. */
  label: string
  status: StepState
  /** How long it took, measured, once it ended. While it runs, how long it has run so far. */
  took: string | null
  /** While it runs through several items: how many are done, as "3 of 7". */
  count: string | null
  /** What the run said of it, such as why it was skipped or why it failed. */
  note: string | null
}

/** What is reviewed, for the top of the view. */
export interface Subject {
  kind: 'change' | 'pull'
  /** `owner/repo #78` for a pull request, or the project. */
  place: string
  title: string | null
  /** The commits compared, short: `3f2a1c4..9b8e7d2`. */
  commits: string | null
  files: number | null
  added: number | null
  removed: number | null
}

export interface LogLine {
  /** The same for as long as the line stays in the log, so a new line does not draw the others again. */
  key: string
  /** How far into the run it was written: `0:05`, `1:12`. */
  at: string
  text: string
}

export interface Preparing {
  /** `queued`: waiting its turn. `running`: under way. `failed`: it stopped. */
  state: 'queued' | 'running' | 'failed'
  /** The sentence the whole view hangs on: what the review is doing right now. */
  now: string
  percent: number | null
  elapsed: string | null
  left: string | null
  /** The step the run is on, from 1, and how many it has. */
  position: { step: number; of: number } | null
  steps: StepLine[]
  subject: Subject | null
  log: LogLine[]
  /** Why it stopped, in the run's own words. */
  error: string | null
}

/**
 * The change review's steps (the change-review package's `StepId`), in plain words, with the nouns the host's log uses
 * for them. Another step is named by its id.
 */
const STEP_WORDS: Record<string, string> = {
  triage: 'Sort the changed files',
  'map-search': 'Find every changed definition',
  'map-proof': "Run the project's tests",
  'risk-floor': 'Rate each definition',
  'risk-model': 'Review and reorganize the map',
  shape: 'Group the definitions into units',
  story: 'Write the story',
  'blind-check': 'A blind check of the story',
}
const STEP_STATES: Record<string, StepState> = { done: 'done', running: 'running', skipped: 'skipped', failed: 'failed' }
/** What a preparation without a change review says: the old pull request walk, and a graph built again. */
const PHASE_WORDS: Record<PreparePhase, string> = {
  queued: 'Waiting its turn',
  reading: 'Reading the change',
  arranging: 'Arranging the story with the agent',
  checking: 'Checking the result',
}
const QUEUED = 'Waiting its turn. One review runs at a time.'
const STOPPED = 'The review stopped'
/** The host keeps this many of a run's latest lines (`AssessmentStatus.log`). */
const LOG_KEPT = 40

/** 75 seconds -> "1m 15s", 8 -> "8s". */
export function clockWords(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
/** A log line's time into the run: 5 seconds -> "0:05", 3725 -> "1:02:05". */
function logClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(seconds / 60)
  const tail = String(seconds % 60).padStart(2, '0')
  return minutes < 60 ? `${minutes}:${tail}` : `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`
}
const timeOf = (at: string | undefined): number | null => {
  const time = at ? Date.parse(at) : Number.NaN
  return Number.isFinite(time) ? time : null
}
const short = (sha: string) => sha.slice(0, 7)
const labelOf = (id: string) => STEP_WORDS[id] ?? id.replace(/[-_.]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase())

/** Whether a run is under way: the review being prepared, its graph built again, or its change review waiting or running. */
export function underWay(status: ReviewStatus | null | undefined): boolean {
  if (!status) return false
  const review = status.assessment?.state
  return status.state === 'preparing' || status.phase != null || review === 'queued' || review === 'running'
}

/** When the run under way started by the host's clock, in milliseconds: the earliest time it says, or null. */
export function startOf(status: ReviewStatus): number | null {
  const times = [status.startedAt, status.assessment?.startedAt].map(timeOf).filter((time): time is number => time != null)
  return times.length ? Math.min(...times) : null
}

/** Why the latest run of an open review stopped: its change review, or a newer preparation that could not be made. */
export function failureOf(status: ReviewStatus | null | undefined): string | null {
  if (!status) return null
  if (status.assessment?.state === 'failed') return status.assessment.error || 'The change review stopped before it finished.'
  return status.state === 'ready' && status.error ? status.error : null
}

/** The run's sentence without the name of its step, which the engine puts in front and the steps already show. */
function sentenceOf(text: string, steps: readonly { id: string }[]): string {
  const named = /^([a-z][a-z0-9-]*): ([\s\S]*)$/.exec(text.trim())
  const id = named?.[1]
  const own = id != null && (Object.hasOwn(STEP_WORDS, id) || steps.some((step) => step.id === id))
  const rest = own ? named![2]!.trim() : text.trim()
  if (own && rest === 'done') return `${labelOf(id)}: done`
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

function subjectOf(status: ReviewStatus): Subject | null {
  const request = status.assessment?.request
  if (request) {
    return {
      kind: request.kind,
      place: request.kind === 'pull' && request.number != null ? `${request.project} #${request.number}` : request.project,
      title: request.title || null,
      commits: request.base && request.head ? `${short(request.base)}..${short(request.head)}` : null,
      files: request.files,
      added: request.added,
      removed: request.removed,
    }
  }
  // Before the run says what it reviews, the review's own name does.
  const target = targetOfReviewId(status.id)
  if (!target) return null
  const place = target.kind === 'pull' ? `${target.owner}/${target.repo} #${target.number}` : target.slug
  return { kind: target.kind, place, title: null, commits: null, files: null, added: null, removed: null }
}

/**
 * When the running step started: at its first line in the log, when that is surely its first (a line of something
 * before it is still there, or the host has cut nothing), else where the steps before it ended, by their measured times.
 */
function runningSince(index: number, steps: NonNullable<AssessmentStatus['steps']>, log: readonly AssessmentLogLine[], runStart: number | null): number | null {
  const first = log.findIndex((line) => line.step === steps[index]!.id)
  const logged = first >= 0 && (first > 0 || log.length < LOG_KEPT) ? timeOf(log[first]!.at) : null
  if (logged != null) return logged
  return runStart == null ? null : runStart + 1000 * steps.slice(0, index).reduce((sum, step) => sum + (step.seconds ?? 0), 0)
}

function logOf(log: readonly AssessmentLogLine[], startedAt: number | null): LogLine[] {
  // Timed from the run's start, as the elapsed time is, and never before its first line.
  const zero = Math.min(startedAt ?? Infinity, timeOf(log[0]?.at) ?? Infinity)
  const seen = new Map<string, number>()
  return log.map((line) => {
    const same = `${line.at}|${line.text}`
    const count = seen.get(same) ?? 0
    seen.set(same, count + 1)
    const at = timeOf(line.at)
    return { key: `${same}#${count}`, at: at == null || !Number.isFinite(zero) ? '' : logClock((at - zero) / 1000), text: line.text }
  })
}

/** A change review that has something to tell: waiting its turn, under way, or stopped. */
const isRun = (assessment: AssessmentStatus | undefined): assessment is AssessmentStatus & { state: Preparing['state'] } =>
  assessment?.state === 'queued' || assessment?.state === 'running' || assessment?.state === 'failed'

/**
 * The view of a run, from the review's status, when it started (ms, as the loader keeps it) and the time now. A change
 * review under way says everything. A preparation without one, such as a graph being built again, says only its phase.
 */
export function preparingOf(status: ReviewStatus | null, startedAt: number | null, now: number): Preparing {
  const assessment = status?.assessment
  const run = isRun(assessment) ? assessment : null
  const going = run?.state === 'running'
  const steps = run?.steps ?? []
  const log = run?.log ?? []
  const runStart = timeOf(run?.startedAt) ?? startedAt
  const lines = steps.map((step, index): StepLine => {
    const state = STEP_STATES[step.status] ?? 'waiting'
    const since = state === 'running' ? runningSince(index, steps, log, runStart) : null
    return {
      id: step.id,
      label: labelOf(step.id),
      status: state,
      took: state === 'running' ? (since == null ? null : clockWords((now - since) / 1000)) : step.seconds == null ? null : clockWords(step.seconds),
      count: state === 'running' && step.total > 1 ? `${Math.min(step.done, step.total)} of ${step.total}` : null,
      note: step.note ?? null,
    }
  })
  const state: Preparing['state'] = run ? run.state : status?.phase === 'queued' ? 'queued' : 'running'
  // The host words each thing the run does for its log, so the newest line says best what it does now.
  const said = going ? sentenceOf(log.at(-1)?.text || run.now || '', steps) : ''
  const fallback = run?.state === 'queued' ? QUEUED : run?.state === 'failed' ? STOPPED : status?.phase ? PHASE_WORDS[status.phase] : 'Starting'
  return {
    state,
    now: said || fallback,
    percent: going && run.percent != null ? Math.min(100, Math.max(0, Math.round(run.percent))) : null,
    elapsed: startedAt == null ? null : clockWords((now - startedAt) / 1000),
    left: going && run.eta != null && run.eta > 0 ? clockWords(run.eta) : null,
    position: positionOf(lines, state),
    steps: lines,
    subject: status ? subjectOf(status) : null,
    log: logOf(log, startedAt),
    error: run?.state === 'failed' ? (run.error ?? null) : null,
  }
}

/** The running step, else the one that failed, else the one after the last that ended. None before any has begun. */
function positionOf(lines: readonly StepLine[], state: Preparing['state']): Preparing['position'] {
  const running = lines.findIndex((line) => line.status === 'running')
  const failed = state === 'failed' ? lines.findIndex((line) => line.status === 'failed') : -1
  const ended = lines.filter((line) => line.status === 'done' || line.status === 'skipped' || line.status === 'failed').length
  const index = running >= 0 ? running : failed >= 0 ? failed : ended > 0 ? Math.min(ended, lines.length - 1) : -1
  return index >= 0 && state !== 'queued' ? { step: index + 1, of: lines.length } : null
}
