import { readFileSync } from 'node:fs'

const NOTE = readFileSync(new URL('./directions.md', import.meta.url), 'utf8').trim()

/**
 * What a run on Claude Code is told: how running there differs, then the directions hobkin gives a Pi run of the same
 * purpose. `workDirections` is hobkin's own (`harnesses.mjs`); a run with no purpose gets hobkin's background directions.
 */
export const claudeDirections =
  (workDirections: (purpose: string) => string, background: string) =>
  (purpose: string | undefined): string =>
    `${NOTE}\n\n${purpose ? workDirections(purpose) : background}`

/** The paragraphs `schedules.md` gives only some runs, each after a line `<!-- name -->`. */
type MarkedParagraph = 'session' | 'durable' | 'wakes only'

/**
 * `hobkin schedule` for a run on Claude Code (056-agent-schedules): what every such run is told, and the marked
 * paragraphs by name.
 */
function readScheduleNote(): { common: string; marked: Map<string, string> } {
  const text = readFileSync(new URL('./schedules.md', import.meta.url), 'utf8')
  // Splitting on a capturing pattern keeps each name: the common part, then a name and its paragraph, and so on.
  const [common = '', ...namesAndParagraphs] = text.split(/^<!-- (.+) -->\n/m)

  const marked = new Map<string, string>()
  for (let index = 0; index < namesAndParagraphs.length; index += 2) {
    marked.set(namesAndParagraphs[index]!, namesAndParagraphs[index + 1]!.trim())
  }
  return { common: common.trim(), marked }
}

const SCHEDULE_NOTE = readScheduleNote()

/**
 * How a run that got a token for `hobkin schedule` uses it: a session run's schedules end with its turn, a durable
 * hobkin's wake its next one, and a run hobkin may run no command for schedules plain wakes only.
 */
export function scheduleDirections({ durable, commands }: { durable: boolean; commands: boolean }): string {
  const names: MarkedParagraph[] = [durable ? 'durable' : 'session']
  if (!commands) names.push('wakes only')

  const paragraphs = names.map((name) => SCHEDULE_NOTE.marked.get(name) ?? '')
  return [SCHEDULE_NOTE.common, ...paragraphs].join('\n\n')
}
