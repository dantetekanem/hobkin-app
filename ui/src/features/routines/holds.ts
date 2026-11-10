/**
 * A routine's run log, and the hold hobkin puts on a routine whose runs keep getting nowhere.
 * The rules are hobkin's (`src/cli/checks.mjs`): a run stalls when it failed, stopped short, or reported
 * "Blocked:". After two stalled runs in a row the routine waits a day from the latest one, and every further
 * stalled run doubles the wait, up to a week. A run that was interrupted says nothing either way.
 */
import type { Hold, RunLine } from './types.ts'

const DAY = 86_400_000
const HOLD_AFTER_STALLED_RUNS = 2
const MAX_HOLD_DAYS = 7

/** hobkin's own line: `- finished | trigger | status | 72s | $0.18 | first line of the report`. The cost is left out when there is none. */
const LINE = /^- (\S+) \| ([^|]+?) \| ([^|]+?) \| (\d+)s \| (?:\$(\d+(?:\.\d+)?) \| )?(.*)$/

/** Reads one line of `checks/<id>/log.md`. Null for anything that is not a finished run. */
export function parseLogLine(line: string): RunLine | null {
  const match = line.trim().match(LINE)
  if (!match) return null
  if (!Number.isFinite(Date.parse(match[1]!))) return null

  return {
    finishedAt: match[1]!,
    trigger: match[2]!,
    status: match[3]!,
    seconds: Number(match[4]),
    usd: match[5] === undefined ? null : Number(match[5]),
    summary: match[6]!,
  }
}

/** Reads a whole log file, oldest run first, as it is written. */
export function parseLog(text: string): RunLine[] {
  return text.split('\n').flatMap((line) => parseLogLine(line) ?? [])
}

/** Writes a run the way hobkin's log has it. */
export function logLine(run: RunLine): string {
  const fields = [run.finishedAt, run.trigger, run.status, `${run.seconds}s`]
  if (run.usd !== null) fields.push(`$${run.usd.toFixed(2)}`)
  fields.push(run.summary)
  return `- ${fields.join(' | ')}`
}

/** A report opens with a word that says how it went. Bold marks around the word are allowed. */
const TALK_BACK = /^(?:\*\*)?(critical|useful|blocked)(?:\*\*)?:(?:\*\*)?\s+(.+)$/i

/** What a finished run's report says after "Blocked:", or null when it is not a blocked report. */
export function blockedMessage(run: Pick<RunLine, 'status' | 'summary'>): string | null {
  if (run.status !== 'completed') return null

  const match = run.summary.trim().match(TALK_BACK)
  if (!match || match[1]!.toLowerCase() !== 'blocked') return null

  // A closing bold mark can trail the message, as it does in hobkin's own reader.
  return match[2]!.replace(/\*\*$/, '').trim()
}

/** A run that got nowhere: it failed, it stopped short, or its report says it is blocked. */
export function isStalled(run: Pick<RunLine, 'status' | 'summary'>): boolean {
  return run.status === 'failed' || run.status === 'incomplete' || blockedMessage(run) !== null
}

/** A run that was cut off says nothing about whether the routine works. */
const isInconclusive = (run: RunLine) => run.status === 'interrupted'

/**
 * The hold on a routine at `now`, from its run log (oldest first), or null when it is free to run.
 * Runs that finished before `since` do not count: changing a routine's schedule starts it afresh.
 */
export function holdOf(runs: readonly RunLine[], now: number, since = Number.NEGATIVE_INFINITY): Hold | null {
  const attempts = runs
    .filter((run) => !isInconclusive(run) && Date.parse(run.finishedAt) >= since)
    .toSorted((first, second) => second.finishedAt.localeCompare(first.finishedAt))
  const cleared = attempts.findIndex((run) => !isStalled(run))
  const streak = cleared === -1 ? attempts.length : cleared
  if (streak < HOLD_AFTER_STALLED_RUNS) return null

  const latest = attempts[0]!
  const days = Math.min(2 ** (streak - HOLD_AFTER_STALLED_RUNS), MAX_HOLD_DAYS)
  const until = Date.parse(latest.finishedAt) + days * DAY
  if (until <= now) return null

  return { until: new Date(until).toISOString(), reason: blockedMessage(latest) ?? latest.summary }
}
