/**
 * The life-cycle tests of an entry point, by search: `agentic-search search '<Entry#symbol>' --intent tests --json`.
 * A request test has no static link to the code it drives (FOUNDATION 4.2), so the tool follows the routes, enqueues
 * and constants that lead from a test to the entry. What it finds are candidates for the proof to run, nothing more.
 * A search that fails is a note, never a crash.
 */
import { runProgram } from './git.ts'
import { findAgenticSearch } from './scan.ts'

export interface EntryTest {
  path: string
  line?: number
  text?: string
  /** How the test reaches the entry: `path`, `class`, `route`, `enqueue`, `perform`. */
  found: string
  /** In words: "post orders_url → orders#create (POST /orders)". */
  detail?: string
}

export type EntryTestsOutcome = { ok: true; tests: EntryTest[]; notes: string[] } | { ok: false; reason: string }

export interface EntryTestsRequest {
  cwd: string
  /** The entry point as the scan names it, such as `OrdersController#create`. */
  symbol: string
  /** The agentic-search program; found on PATH and in the usual folders when not given. */
  program?: string
  timeoutMs?: number
  signal?: AbortSignal
}

/** Asks for the tests of one entry point. The pipeline takes this as an option, so tests hand in a fake. */
export type EntryTestSearch = (request: EntryTestsRequest) => Promise<EntryTestsOutcome>

export const ENTRY_TESTS_TIMEOUT_MS = 30_000

type Raw = Record<string, unknown>
const record = (value: unknown): Raw | undefined => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined)
const word = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined)

/** The tests of a search answer, which may sit at the top or under `details`. A test without a path or a label is left out. */
export function readEntryTests(answer: unknown): { tests: EntryTest[]; notes: string[] } {
  const root = record(answer)
  const body = Array.isArray(root?.tests) ? root : record(root?.details)
  const tests: EntryTest[] = []
  for (const item of Array.isArray(body?.tests) ? body.tests : []) {
    const raw = record(item)
    const path = word(raw?.path)
    const found = word(raw?.found)
    if (!raw || !path || !found) continue
    const line = Number.isInteger(raw.line) && (raw.line as number) > 0 ? (raw.line as number) : undefined
    const text = word(raw.text)
    const detail = word(raw.detail)
    tests.push({ path, found, ...(line !== undefined ? { line } : {}), ...(text ? { text } : {}), ...(detail ? { detail } : {}) })
  }
  const notes = (Array.isArray(body?.notes) ? body.notes : []).filter((note): note is string => typeof note === 'string')
  return { tests, notes }
}

/** The default search: runs agentic-search in the checkout, with a time limit. */
export const searchEntryTests: EntryTestSearch = async ({ cwd, symbol, program, timeoutMs = ENTRY_TESTS_TIMEOUT_MS, signal }) => {
  const file = program ?? findAgenticSearch()
  if (!file) return { ok: false, reason: 'agentic-search is not installed.' }
  const run = await runProgram(file, ['search', symbol, '--intent', 'tests', '--json', '--cwd', cwd], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    timeoutMs,
    group: true,
    signal,
  })
  if (!run.started) return { ok: false, reason: `agentic-search could not start: ${run.reason}` }
  if (run.timedOut) return { ok: false, reason: `the search took longer than ${timeoutMs / 1000} seconds.` }
  if (run.aborted) return { ok: false, reason: 'the search was stopped.' }
  if (run.code !== 0) return { ok: false, reason: run.stderr.toString('utf8').trim().split('\n')[0]?.replace(/^agentic-search:\s*/, '') || `the search stopped with code ${run.code}.` }
  try {
    return { ok: true, ...readEntryTests(JSON.parse(run.stdout.toString('utf8'))) }
  } catch {
    return { ok: false, reason: 'the search gave no readable answer.' }
  }
}
