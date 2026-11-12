import type { AssessmentStatus } from '#shared/review/assessment.ts'
import type { ReviewStatus } from '#shared/review/status.ts'

/** What the preparing view says, as plain data, so it is tested without a window. */

export interface StepLine {
  id: string
  label: string
  status: 'done' | 'running' | 'waiting' | 'failed'
  /** Measured seconds for a finished step, in words. */
  took: string | null
}
export interface Preparing {
  /** The sentence the whole view hangs on: what the review is doing right now. */
  now: string
  percent: number | null
  elapsed: string | null
  left: string | null
  steps: StepLine[]
}

const PHASE_WORDS: Record<string, string> = {
  queued: 'Waiting its turn',
  reading: 'Reading the change',
  arranging: 'Arranging the story with the agent',
  checking: 'Checking the result',
}

/** 75 seconds -> "1m 15s", 8 -> "8s". */
export function clockWords(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
const label = (id: string) => id.replace(/[-_.]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
const STEP_STATUS: Record<string, StepLine['status']> = { done: 'done', ready: 'done', finished: 'done', running: 'running', active: 'running', failed: 'failed', error: 'failed' }

function stepsOf(assessment: AssessmentStatus | undefined): StepLine[] {
  return (assessment?.steps ?? []).map((step) => ({
    id: step.id,
    label: label(step.id),
    status: STEP_STATUS[step.status] ?? 'waiting',
    took: step.seconds == null ? null : clockWords(step.seconds),
  }))
}

export function preparingOf(status: ReviewStatus | null, startedAt: number | null, now: number): Preparing {
  const assessment = status?.assessment
  const running = assessment?.state === 'running' || assessment?.state === 'queued'
  const phase = status?.phase ? PHASE_WORDS[status.phase] : null
  return {
    now: (running ? assessment?.now : null) ?? phase ?? assessment?.now ?? 'Starting',
    percent: running && assessment?.percent != null ? Math.round(assessment.percent) : null,
    elapsed: startedAt == null ? null : clockWords((now - startedAt) / 1000),
    left: running && assessment?.eta != null ? clockWords(assessment.eta) : null,
    steps: stepsOf(assessment),
  }
}
