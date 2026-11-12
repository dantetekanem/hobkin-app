/**
 * Live status of a review (FOUNDATION section 10, schemas/progress.schema.json): which step runs, how far it is, what
 * is left and what is happening now. Times are read from the injected clock and never estimated; every change is
 * handed to `write` whole, so a reader always sees one consistent state.
 */
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Mode, PlanStep, Progress, StepId, StepProgress, StepStatus } from './types.ts'

export interface ProgressOptions {
  /** The review's name, such as the head commit's short id. */
  review: string
  mode?: Mode
  /** Triage's plan: the steps in order, with their estimates and expected units. */
  plan: { steps: readonly PlanStep[] }
  clock: () => Date
  write: (progress: Progress) => void
}

/** Every call changes the progress, writes it, and returns a copy of it. */
export interface ProgressTracker {
  /** A step begins, with the number of items it will go through and what it is doing first. */
  start(step: StepId, total: number, now: string): Progress
  /** `done` items of the step are finished; `now` says what it does next. */
  tick(step: StepId, done: number, now: string): Progress
  end(step: StepId, now?: string): Progress
  skip(step: StepId, reason: string): Progress
  fail(step: StepId, reason: string): Progress
  /** Says what is happening, without moving any step. */
  say(now: string): Progress
  /** A copy of the progress as it stands. */
  progress(): Progress
}

const FINISHED: readonly StepStatus[] = ['done', 'skipped', 'failed']
/** Measured over estimated time is kept between half and double, so one quick or slow step does not swing the eta. */
const SCALE_LOW = 0.5
const SCALE_HIGH = 2

/** The clock's time as `date -u +%FT%TZ` writes it: whole seconds, UTC. */
const stampOf = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z')
const secondsBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 1000)
const isFinished = (step: StepProgress) => FINISHED.includes(step.status)

/** How much of a step's estimate is behind it: all of it once finished, the share of items done while it runs. */
function doneShare(step: StepProgress): number {
  if (isFinished(step)) return 1
  if (step.status === 'running' && step.total > 0) return Math.min(1, step.done / step.total)
  return 0
}

/** Measured seconds over estimated seconds for the steps that ended done, or 1 before any has. */
function measuredScale(steps: readonly StepProgress[]): number {
  const measured = steps.filter((step) => step.status === 'done' && step.seconds !== null && step.estimate_seconds > 0)
  if (!measured.length) return 1
  const ratio = measured.reduce((sum, step) => sum + (step.seconds ?? 0), 0) / measured.reduce((sum, step) => sum + step.estimate_seconds, 0)
  return Math.min(SCALE_HIGH, Math.max(SCALE_LOW, ratio))
}

/**
 * Tracks one review's steps. Percent is the sum of each estimate times its share done, over the sum of estimates;
 * finished steps (done, skipped or failed) count whole. The eta is the estimate left, scaled by how measured times
 * compared with estimates on the steps that ended done. `remaining.units` is what a running step has left, plus the
 * units the plan expects in steps not started.
 */
export function trackProgress(options: ProgressOptions): ProgressTracker {
  const stamp = () => stampOf(options.clock())
  const planned = new Map(options.plan.steps.map((step) => [step.id, step.units ?? 0]))
  const began = stamp()
  const state: Progress = {
    schema: 'review-progress/1',
    review: options.review,
    ...(options.mode ? { mode: options.mode } : {}),
    started_at: began,
    updated_at: began,
    now: 'not started',
    percent: 0,
    eta_seconds: null,
    remaining: { steps: 0, units: 0 },
    steps: options.plan.steps.map((step) => ({
      id: step.id,
      status: 'pending',
      started_at: null,
      ended_at: null,
      seconds: null,
      estimate_seconds: step.estimate_seconds,
      done: 0,
      total: step.units ?? 1,
    })),
  }

  function measure() {
    const estimates = state.steps.reduce((sum, step) => sum + step.estimate_seconds, 0)
    const behind = state.steps.reduce((sum, step) => sum + step.estimate_seconds * doneShare(step), 0)
    const left = estimates - behind
    state.percent = estimates > 0 ? Math.floor((100 * behind) / estimates) : Math.floor((100 * state.steps.filter(isFinished).length) / Math.max(1, state.steps.length))
    state.eta_seconds = estimates > 0 ? Math.round(left * measuredScale(state.steps)) : null
    const open = state.steps.filter((step) => !isFinished(step))
    state.remaining = {
      steps: open.length,
      units: open.reduce((sum, step) => sum + (step.status === 'running' ? Math.max(0, step.total - step.done) : (planned.get(step.id) ?? 0)), 0),
    }
  }
  measure()

  const stepOf = (id: StepId): StepProgress => {
    const step = state.steps.find((candidate) => candidate.id === id)
    if (!step) throw new Error(`progress: the plan has no step ${id}`)
    return step
  }

  /** Applies one change to a step (or none), then stamps, measures and writes the whole progress. */
  function change(id: StepId | null, now: string, apply: (step: StepProgress, at: string) => void = () => {}): Progress {
    const step = id ? stepOf(id) : null
    const at = stamp()
    if (step) apply(step, at)
    state.now = now
    state.updated_at = at
    measure()
    options.write(structuredClone(state))
    return structuredClone(state)
  }

  /** A step stops: its end time, and its seconds when it had started. */
  const close = (step: StepProgress, status: StepStatus, at: string, note?: string) => {
    step.status = status
    step.ended_at = at
    step.seconds = step.started_at ? secondsBetween(step.started_at, at) : null
    if (note !== undefined) step.note = note
  }

  return {
    start: (id, total, now) =>
      change(id, now, (step, at) => {
        Object.assign(step, { status: 'running', started_at: at, ended_at: null, seconds: null, done: 0, total: Math.max(0, total) })
        delete step.note
      }),
    tick: (id, done, now) =>
      change(id, now, (step) => {
        step.done = Math.max(0, done)
        step.total = Math.max(step.total, step.done)
      }),
    end: (id, now) =>
      change(id, now ?? `${id}: done`, (step, at) => {
        close(step, 'done', at)
        step.done = step.total
      }),
    skip: (id, reason) => change(id, `${id}: skipped, ${reason}`, (step, at) => close(step, 'skipped', at, reason)),
    fail: (id, reason) => change(id, `${id}: failed, ${reason}`, (step, at) => close(step, 'failed', at, reason)),
    say: (now) => change(null, now),
    progress: () => structuredClone(state),
  }
}

/**
 * A `write` for `trackProgress` that keeps the progress in `folder`: `progress.json` rewritten whole (written under
 * another name and moved into place, so a reader never sees half of it), and the same object appended as one line
 * to `progress.jsonl`, which keeps the history.
 */
export function progressFiles(folder: string): (progress: Progress) => void {
  const file = join(folder, 'progress.json')
  const history = join(folder, 'progress.jsonl')
  return (progress) => {
    mkdirSync(folder, { recursive: true })
    const draft = `${file}.${process.pid}.tmp`
    writeFileSync(draft, `${JSON.stringify(progress, null, 1)}\n`)
    renameSync(draft, file)
    appendFileSync(history, `${JSON.stringify(progress)}\n`)
  }
}
