import type { RunGuide, RunGuideAsked } from '#shared/protocol/work.ts'
import { waited } from '../reports/time.ts'

/**
 * What a code project's Run guide says in the window (_specs/068-run-guide, "In the window"): the line for its last run,
 * the line naming its sources, and its one button. Pure, so the project page and Try it say the same and are tested
 * without a window.
 */

/** Where reading a project's guide (`work.guide.read`) stands. */
export type GuideRead = { state: 'reading' } | { state: 'read'; guide: RunGuide } | { state: 'failed'; error: string }

/** What hobkin said to a press of the button: its line, or its refusal. */
export interface GuideSaid {
  tone: 'done' | 'refused'
  text: string
}

export interface GuideLine {
  text: string
  tone: 'ok' | 'warn' | 'bad' | 'quiet'
  /** The run's own note, when it left one. */
  title?: string
}

export interface GuideButton {
  label: 'Write the run guide' | 'Check it again' | 'Queued' | 'Writing'
  disabled: boolean
}

/** What the press does, for the button's title. */
export const GUIDE_PRESS_TITLE =
  "An agent reads the project's own docs and scripts, writes the guide, follows it in a worktree of its own with services of its own, and records how far it got. It waits at the front of the project's queue."

const NO_GUIDE = "No run guide yet. An agent writes one from the project's own docs and scripts and follows it in a worktree of its own."

const WEEK_MS = 7 * 24 * 3_600_000
const date = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
const dateWithYear = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' })

/** "3 days ago" within a week, then the day: "Nov 15", with its year when it is not this one. */
function whenWords(at: number, now: number): string {
  if (now - at < WEEK_MS) return `${waited(at, now)} ago`
  return (new Date(at).getFullYear() === new Date(now).getFullYear() ? date : dateWithYear).format(at)
}

/** The guide's headings in order. A heading inside a code block is a shell comment, not a step. */
function headingsOf(text: string): string[] {
  const outsideCode = text.replaceAll(/```[\s\S]*?```/g, '')
  return [...outsideCode.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((match) => match[1]!)
}

/**
 * Where a run that did not work stopped. `reached` is the last step that worked, so when it is one of the guide's
 * headings the run stopped at the heading after it, and with none reached at the first. Otherwise it says what it got past.
 */
function stoppedWords(text: string | null, reached: string | null): string {
  const headings = headingsOf(text ?? '')
  if (reached === null) return headings.length ? `stopped at ${headings[0]}` : 'it did not work'
  const at = headings.findIndex((heading) => heading.trim().toLowerCase() === reached.trim().toLowerCase())
  const next = at >= 0 ? headings[at + 1] : undefined
  return next ? `stopped at ${next}` : `stopped after ${reached}`
}

/** The section's first line: its last run, or what is said in its place while it is read, cannot be, or is refused. */
export function guideRunLine(read: GuideRead, now: number): GuideLine {
  if (read.state === 'reading') return { text: 'Reading the run guide…', tone: 'quiet' }
  if (read.state === 'failed') return { text: read.error, tone: 'bad' }
  const { guide } = read
  if (guide.refused) return { text: guide.refused, tone: 'quiet' }
  const run = guide.lastRun
  if (!run) return { text: 'Not run yet', tone: 'quiet' }
  const when = `Last run ${whenWords(Date.parse(run.at), now)}`
  const note = run.note ? { title: run.note } : {}
  if (run.worked) return { text: `${when}: it worked`, tone: 'ok', ...note }
  return { text: `${when}: ${stoppedWords(guide.text, run.reached)}`, tone: 'warn', ...note }
}

const listed = (names: readonly string[]) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

/** The project files the guide was written from and the commit it was written at, or that there is no guide yet. */
export function sourcesLine(read: GuideRead): string {
  if (read.state !== 'read' || read.guide.refused) return ''
  const { text, sources, commit } = read.guide
  if (!text) return NO_GUIDE
  const from = sources.length ? `From ${listed(sources)}` : 'Its sources were not recorded'
  return commit ? `${from}, at ${commit.slice(0, 7)}` : from
}

/** The one button: Write the run guide or Check it again, and Queued or Writing while its look waits or runs. */
export function guideButton(read: GuideRead, pressing: boolean): GuideButton {
  if (read.state !== 'read') return { label: 'Write the run guide', disabled: pressing || read.state === 'reading' }
  const { guide } = read
  if (guide.pending === 'queued') return { label: 'Queued', disabled: true }
  if (guide.pending === 'writing') return { label: 'Writing', disabled: true }
  return { label: guide.text ? 'Check it again' : 'Write the run guide', disabled: pressing || Boolean(guide.refused) }
}

/** Files the guide look (`work.guide.write`) and says what hobkin answered, its refusal included. */
export async function askForGuide(write: () => Promise<RunGuideAsked>): Promise<GuideSaid> {
  try {
    return { tone: 'done', text: (await write()).message }
  } catch (error) {
    return { tone: 'refused', text: error instanceof Error ? error.message : String(error) }
  }
}
