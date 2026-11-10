/**
 * A report as hobkin lists it (`src/cli/application.mjs`, `project`): what one finished run brought back.
 * Everything here reads a report the way hobkin's terminal app does (`src/cli/reports.mjs`, `src/cli/ui.mjs`),
 * so both front ends say the same thing about it. Pure, so the rules can be tested without a window.
 * Spec: 012-reports-actions.
 */
export interface Report {
  id: string
  /** The routine's title, or the title of the work item. */
  title: string
  /** The routine the run belongs to. Work mode's runs are `work.<project>.<lane>`. */
  scheduleId?: string
  /** When the run finished, as an ISO date. */
  at?: string
  /** Markdown. Its first line may carry the triage. */
  body: string
  /** How the run ended: `completed`, `failed`, `incomplete` and so on. */
  outcome: string
}

/** Scheduled: a routine ran. Done: work mode finished something. */
export type ReportKind = 'scheduled' | 'done'

export type TriageLevel = 'critical' | 'blocked' | 'useful' | 'nothing'

/** What a run said about its own report in the first line: whether it is worth the user's time, and what to do next. */
export interface Triage {
  level: TriageLevel
  message?: string
  next?: string
}

/** How a report is colored in the list. `plain` is a report that said nothing about itself. */
export type Tone = TriageLevel | 'plain'

export function kindOf({ scheduleId }: Report): ReportKind {
  return String(scheduleId ?? '').startsWith('work.') ? 'done' : 'scheduled'
}

/**
 * Where a report came from: the routine's name, or the project work mode did it for. Work mode's schedules are
 * `work.<project>.<lane>`, `work.discover` when it looks for projects, and `work.session` for another session.
 */
export function sourceOf({ scheduleId }: Report): string {
  if (!scheduleId) return 'hobkin'
  if (scheduleId === 'work.discover') return 'Work mode'
  if (scheduleId === 'work.session') return 'Another session'
  const work = /^work\.(.+)\.[^.]+$/.exec(scheduleId)
  return work ? work[1]! : scheduleId
}

// The triage line, as hobkin's background prompt asks for it. The words may be bold.
const NOTHING_NEW = /^(?:\*\*)?nothing new\.?(?:\*\*)?$/i
const TALK_BACK = /^(?:\*\*)?(critical|useful|blocked)(?:\*\*)?:(?:\*\*)?\s+(.+)$/i
const NEXT = /^(?:\*\*)?next(?:\*\*)?:(?:\*\*)?\s+(.+)$/i
const LONGEST_MESSAGE = 1024
const LONGEST_NEXT = 300

const withoutBold = (text: string) => text.replace(/\*\*$/, '').trim()

/** The triage a completed run opened its report with, or null when it gave none. */
export function triageOf(report: Report): Triage | null {
  if (report.outcome !== 'completed') return null
  const lines: string[] = []
  for (const [source] of report.body.matchAll(/[^\n]+/g)) {
    const line = source.trim()
    if (line) lines.push(line)
    if (lines.length === 2) break
  }
  const [first = '', second] = lines
  if (NOTHING_NEW.test(first)) return { level: 'nothing' }

  const match = first.match(TALK_BACK)
  if (!match) return null
  // The next step counts only as the first thing said after the marker.
  const next = second?.match(NEXT)?.[1]
  return {
    level: match[1]!.toLowerCase() as TriageLevel,
    message: withoutBold(match[2]!).slice(0, LONGEST_MESSAGE),
    ...(next ? { next: withoutBold(next).slice(0, LONGEST_NEXT) } : {}),
  }
}

/** A run that went wrong reads as a problem even though it wrote no triage. */
const OUTCOME_TONE: Record<string, Tone> = { failed: 'critical', incomplete: 'blocked', interrupted: 'blocked' }

export function toneOf(report: Report): Tone {
  return triageOf(report)?.level ?? OUTCOME_TONE[report.outcome] ?? 'plain'
}

/** A line of Markdown as plain words: links keep their text, and marks for bold, code, headings and lists go. */
export function plainLine(line: string): string {
  return line
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`|~~/g, '')
    .replace(/^\s*(#{1,6}|[-*+>]|\d+[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const SUMMARY_READS = 4000
const SHORTEST_SUMMARY = 12

/** The first line of a report that says something: not a rule, and not a heading that repeats its title. */
function firstTellingLine(report: Report): string {
  const title = report.title.trim().toLowerCase()
  for (const source of report.body.slice(0, SUMMARY_READS).split('\n')) {
    const text = plainLine(source)
    const isRule = /^[-=_*\s]+$/.test(text)
    const repeatsTitle = Boolean(title) && text.toLowerCase().includes(title)
    if (text.length >= SHORTEST_SUMMARY && !isRule && !repeatsTitle) return text
  }
  return ''
}

/** One line for the list: what the run said it found, or the first thing its report says. */
export function summaryOf(report: Report): string {
  const triage = triageOf(report)
  if (triage?.message) return plainLine(triage.message)
  if (triage) return 'Nothing new.'
  return firstTellingLine(report)
}

/**
 * A report as the reader draws it: the triage as pieces of their own, and the Markdown that follows it.
 * `Useful:` and its kin are words for hobkin, so the reader shows what they mean instead of the words.
 */
export function readerParts(report: Report): { triage: Triage | null; markdown: string } {
  const triage = triageOf(report)
  if (!triage) return { triage: null, markdown: report.body.trim() }

  const [, ...rest] = report.body.trim().split('\n')
  // The next step was read off the first line that follows the marker, so that line goes with it.
  const after = triage.next ? rest.slice(rest.findIndex((line) => line.trim() !== '') + 1) : rest
  return { triage, markdown: after.join('\n').trim() }
}
