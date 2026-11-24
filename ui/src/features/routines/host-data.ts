import { isWorkflowRow } from '../../integration/workflows.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { checkTimes, checkWindow } from './edit.ts'
import { RECURRENCES, type Routine, type RoutinesData } from './types.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
const isTime = (value: unknown): value is string => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

/** The host validates files; this boundary rejects shapes the screen cannot safely draw. */
function isRoutine(row: unknown): row is Routine {
  if (!isRecord(row)) return false
  if (!['id', 'title', 'timezone', 'effort', 'cwd', 'path', 'prompt'].every((key) => typeof row[key] === 'string')) return false
  if (!row.id || typeof row.enabled !== 'boolean' || row.harness !== 'pi') return false
  if (!(row.model === null || typeof row.model === 'string') || !isStringArray(row.context)) return false
  if (!RECURRENCES.some((cadence) => cadence === row.cadence)) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: row.timezone as string })
  } catch {
    return false
  }

  if (row.window !== undefined) {
    if (row.at !== undefined || !isRecord(row.window)) return false
    const window = row.window
    if (!isTime(window.start) || !isTime(window.end) || !Number.isInteger(window.everyMinutes)) return false
    if (!checkWindow({ start: window.start, end: window.end, everyMinutes: String(window.everyMinutes) }).ok) return false
  } else {
    const times = Array.isArray(row.at) ? row.at : [row.at]
    if (!times.every(isTime) || !checkTimes(times.join(',')).ok) return false
  }
  if (row.cadence === 'weekly') {
    const days = Array.isArray(row.weekday) ? row.weekday : [row.weekday]
    if (!days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return false
  }
  if (row.cadence === 'monthly' && !(typeof row.day === 'number' && Number.isInteger(row.day) && row.day >= 1 && row.day <= 31)) return false
  if (row.cadence === 'once' && !(isDate(row.date) && /^\d{4}-\d{2}-\d{2}$/.test(row.date))) return false
  if (row.nextRun !== undefined) {
    if (!isRecord(row.nextRun) || typeof row.nextRun.state !== 'string') return false
    if (!(row.nextRun.at === null || isDate(row.nextRun.at))) return false
    if (row.nextRun.reason !== undefined && typeof row.nextRun.reason !== 'string') return false
  }
  return true
}

/** Only schedules and definition errors are supplied here. History, memory and templates stay unknown. */
export function routinesFromHost(snapshot: WireSnapshot): RoutinesData {
  const data: RoutinesData = {
    routines: [],
    errors: [],
    logs: {},
    memory: {},
    reports: {},
    running: {},
    changedAt: {},
    templates: [],
  }
  for (const error of Array.isArray(snapshot.errors) ? snapshot.errors : []) {
    if (isRecord(error) && typeof error.path === 'string' && typeof error.message === 'string') {
      data.errors.push({ path: error.path, message: error.message })
    }
  }
  const seen = new Set<string>()
  for (const [index, row] of (Array.isArray(snapshot.schedules) ? snapshot.schedules : []).entries()) {
    // An integration's workflow is listed apart, in its own group (`Workflows.tsx`).
    if (isWorkflowRow(row)) continue
    if (isRoutine(row) && !seen.has(row.id)) {
      data.routines.push(row)
      seen.add(row.id)
    } else {
      data.errors.push({
        path: isRecord(row) && typeof row.path === 'string' ? row.path : `Host routine ${index + 1}`,
        message: 'This routine has an invalid or unsupported definition for this screen.',
      })
    }
  }
  return data
}
