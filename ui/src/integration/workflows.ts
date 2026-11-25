/**
 * An integration's workflows as the window reads them (_specs/065-integration-drops). The host's `schedules` rows
 * carry them beside the user's routines, marked by `integration`. Pure, so it is tested without a window.
 */

/** What starts a workflow besides its schedule. */
export type WorkflowStart = { kind: 'press' } | { kind: 'after'; command: string } | { kind: 'start' }

export interface WorkflowRow {
  /** `<integration>/<name>`. */
  id: string
  integration: string
  title: string
  starts: readonly WorkflowStart[]
  enabled: boolean
  /** How often it runs by itself, when it has a schedule. Null for one that only something else starts. */
  cadence: string | null
  /** `running`, `unscheduled`, `paused` and the rest of the host's states. */
  state: string
  /** The last run, when the host says. */
  lastRun: { at: string; outcome: string } | null
}

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Whether a schedules row is an integration's workflow and not one of the user's routines. */
export const isWorkflowRow = (row: unknown): boolean => isRecord(row) && typeof row.integration === 'string' && row.integration !== ''

function startOf(text: unknown): WorkflowStart | null {
  if (text === 'press') return { kind: 'press' }
  if (text === 'start') return { kind: 'start' }
  if (typeof text === 'string' && text.startsWith('after:') && text.length > 6) return { kind: 'after', command: text.slice(6) }
  return null
}

/** The workflows among a snapshot's `schedules` rows, in the host's order, optionally of one integration. A row the window cannot read is left out. */
export function workflowRowsOf(rows: unknown, integration?: string): WorkflowRow[] {
  const found: WorkflowRow[] = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isWorkflowRow(row) || typeof row.id !== 'string' || typeof row.enabled !== 'boolean') continue
    if (integration !== undefined && row.integration !== integration) continue
    const next = isRecord(row.nextRun) && typeof row.nextRun.state === 'string' ? row.nextRun.state : 'unscheduled'
    const last = isRecord(row.lastRun) && typeof row.lastRun.at === 'string' && typeof row.lastRun.outcome === 'string' ? { at: row.lastRun.at, outcome: row.lastRun.outcome } : null
    found.push({
      id: row.id,
      integration: row.integration as string,
      title: typeof row.title === 'string' && row.title ? row.title : (row.id.split('/').at(-1) ?? row.id),
      starts: ((Array.isArray(row.on) ? row.on : []) as unknown[]).flatMap((text) => startOf(text) ?? []),
      enabled: row.enabled,
      cadence: typeof row.cadence === 'string' ? row.cadence : null,
      state: next,
      lastRun: last,
    })
  }
  return found
}

/** Whether the user can press it now: it has a press start and is turned on. */
export const pressable = (row: Pick<WorkflowRow, 'starts' | 'enabled'>): boolean => row.enabled && row.starts.some(({ kind }) => kind === 'press')

/** A command's name in plain words, without its integration's id: `echo.say-twice` after `echo` reads "say twice". */
export function commandWords(command: string, integration: string): string {
  const own = command.startsWith(`${integration}.`) ? command.slice(integration.length + 1) : command
  return own.replace(/[.\-_]+/g, ' ')
}

const CADENCE_WORDS: Readonly<Record<string, string>> = { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }

/** What starts a workflow, in words: "On a press", "After issue close", "When GitHub starts it", and its schedule first when it has one. */
export function startWords(row: Pick<WorkflowRow, 'starts' | 'cadence' | 'integration'>, integrationName: string): string {
  const words = row.starts.map((start) => {
    if (start.kind === 'press') return 'On a press'
    if (start.kind === 'after') return `After ${commandWords(start.command, row.integration)}`
    return `When ${integrationName} starts it`
  })
  if (row.cadence) words.unshift(CADENCE_WORDS[row.cadence] ?? 'Once')
  return words.length ? words.join(' · ') : 'Nothing starts it'
}
