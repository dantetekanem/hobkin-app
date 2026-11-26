/**
 * The message hobkin gives an agent when its schedules wake it (`056-agent-schedules`): a `<hobkin-schedule>` block
 * holding JSON with the `schedules` that woke it, each with its `name` (`scheduleWakeBlock` in hobkin's
 * `agent-schedules.mjs`). On an agent's page it is one quiet row named by its schedules, which opens to the whole
 * message as a tool call's row opens to its output. Pure, so it is tested without a window.
 */

export interface ScheduleWake {
  /** The names of the schedules that woke the agent, each once, or "Schedule" when none has one to read. */
  title: string
  /** The whole message: its JSON laid out one field a line when it reads as JSON, and as it came when it does not. */
  text: string
  /** `json` when `text` is laid-out JSON, so it is colored as JSON. */
  language: 'json' | null
}

/** What a wake is named when none of its schedules has a name to read. */
const NO_NAME = 'Schedule'

/** The block alone, as hobkin writes it, with nothing before or after it. */
const BLOCK = /^\s*<hobkin-schedule>\s*([\s\S]*?)\s*<\/hobkin-schedule>\s*$/

/** The block's JSON, or undefined when it does not read as JSON. */
function bodyOf(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return undefined
  }
}

/** One schedule's name, trimmed, or empty when it has none to read. */
function nameOf(schedule: unknown): string {
  if (typeof schedule !== 'object' || schedule === null || !('name' in schedule)) return ''
  return typeof schedule.name === 'string' ? schedule.name.trim() : ''
}

/** The schedules' names, each once, in the order they come. */
function namesOf(body: unknown): string[] {
  if (typeof body !== 'object' || body === null || !('schedules' in body)) return []
  const { schedules } = body
  if (!Array.isArray(schedules)) return []

  const names = schedules.map(nameOf).filter(Boolean)
  return [...new Set(names)]
}

/** A schedule's wake, read from the message that carries it. Null for any other message. */
export function scheduleWakeOf(text: string): ScheduleWake | null {
  const block = BLOCK.exec(text)
  if (!block) return null

  const [, json = ''] = block
  const body = bodyOf(json)
  if (body === undefined) return { title: NO_NAME, text, language: null }

  const names = namesOf(body)
  return {
    title: names.length ? names.join(', ') : NO_NAME,
    text: JSON.stringify(body, null, 2),
    language: 'json',
  }
}
