import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AgentScheduleRunRecord, AgentScheduleRuns } from '#shared/protocol/schedules.ts'
import { foldWords, placedRuns, runWords, runsKey, withRuns, type RunsRow } from '../src/features/schedules/runs.ts'

const T = Date.parse('2026-11-25T14:00:00Z')
const MINUTE = 60000
const iso = (time: number) => new Date(time).toISOString()

/** A run that began at `minute` after T and took `seconds`. */
const run = (minute: number, fields: Partial<AgentScheduleRunRecord> = {}, seconds = 3): AgentScheduleRunRecord => ({
  startedAt: iso(T + minute * MINUTE),
  at: iso(T + minute * MINUTE + seconds * 1000),
  outcome: 'pending',
  exitCode: 8,
  woke: false,
  ...fields,
})

const WATCH: AgentScheduleRuns = { id: 'sch-1', name: 'Watch CI for #412', does: 'shell', command: 'gh pr checks 412\n--watch', runs: [run(0), run(2), run(4)] }

/** A conversation's own rows: what was said at a minute after T, or a row with no time of its own. */
type Said = { kind: 'said'; key: string; at: number | null }
const said = (key: string, minute: number | null): Said => ({ kind: 'said', key, at: minute === null ? null : T + minute * MINUTE })
const timeOf = (row: Said) => row.at

const shape = (rows: readonly (Said | RunsRow)[]) => rows.map((row) => (row.kind === 'schedule' ? `${row.schedule.id}×${row.runs.length}` : row.key))

test("each run takes its place among the conversation's rows by when it ended, and runs in a row with the same end fold into one", () => {
  const rows = [said('asked', -1), said('answer', 1), said('next', 3)]
  const shown = withRuns(rows, placedRuns([WATCH]), timeOf)
  assert.deepEqual(shape(shown), ['asked', 'sch-1×1', 'answer', 'sch-1×1', 'next', 'sch-1×1'], 'a row between two runs keeps them apart')

  const quiet = withRuns([said('asked', -1)], placedRuns([WATCH]), timeOf)
  assert.deepEqual(shape(quiet), ['asked', 'sch-1×3'], 'with nothing between them they are one row')
  const [, folded] = quiet as [Said, RunsRow]
  assert.equal(folded.key, `schedule:sch-1:${iso(T + 3000)}`, 'keyed by its first run, so it keeps its key as runs join it')
  assert.equal(folded.at, T + 4 * MINUTE + 3000, 'it stands at its newest run')
  assert.deepEqual(folded.schedule, { id: 'sch-1', name: 'Watch CI for #412', does: 'shell', command: 'gh pr checks 412\n--watch' })
})

test('runs that end differently, wake their agent differently or belong to another schedule are rows of their own', () => {
  const failed = { ...WATCH, runs: [run(0), run(2, { outcome: 'failed', exitCode: 1, woke: true }), run(4, { outcome: 'failed', exitCode: 1, woke: false }), run(6, { outcome: 'failed', exitCode: 2, woke: false })] }
  const nap: AgentScheduleRuns = { id: 'sch-2', does: 'wake', runs: [{ at: iso(T + 5 * MINUTE), outcome: 'passed', woke: true }] }
  assert.deepEqual(shape(withRuns([], placedRuns([failed, nap]), timeOf)), ['sch-1×1', 'sch-1×1', 'sch-1×1', 'sch-2×1', 'sch-1×1'])
  assert.deepEqual(shape(withRuns([], placedRuns([{ ...failed, runs: failed.runs.slice(2) }]), timeOf)), ['sch-1×2'], 'another exit code still failed the same way')
})

test('a row with no time stays where it is, a row that is now stays last, and no runs leave the rows as they were', () => {
  const rows = [said('asked', 1), said('undated', null), said('thinking', Infinity)]
  assert.deepEqual(shape(withRuns(rows, placedRuns([WATCH]), timeOf)), ['sch-1×1', 'asked', 'undated', 'sch-1×2', 'thinking'])
  assert.equal(withRuns(rows, [], timeOf), rows)
  assert.equal(withRuns(rows, placedRuns([{ ...WATCH, runs: [] }]), timeOf), rows)
})

test('a run row says what ran in short, how it ended, how long it took and whether it woke the agent', () => {
  const row = (fields: Partial<AgentScheduleRunRecord>, schedule: Partial<AgentScheduleRuns> = {}) => runWords({ ...WATCH, ...schedule, name: schedule.name ?? WATCH.name ?? '', does: schedule.does ?? 'shell' }, run(0, fields, 65))
  assert.deepEqual(row({}), { name: 'Watch CI for #412', ran: 'gh pr checks 412 …', end: 'pending', tone: 'quiet', took: '1m 05s', wake: 'no wake' })
  assert.deepEqual([row({ outcome: 'passed', exitCode: 0, woke: true }).end, row({ outcome: 'passed', woke: true }).wake], ['ok', 'woke it'])
  assert.deepEqual([row({ outcome: 'failed', exitCode: 1 }).end, row({ outcome: 'failed', exitCode: 1 }).tone], ['exit 1', 'bad'])
  assert.equal(row({ outcome: 'timed-out', exitCode: undefined }).end, 'timed out')
  assert.equal(row({ outcome: 'error', exitCode: undefined, line: 'It was cut off before it finished.', startedAt: undefined }).end, 'cut off')
  assert.equal(row({ outcome: 'error', exitCode: undefined, line: 'spawn bash ENOENT' }).end, 'could not start')
  assert.equal(row({ startedAt: undefined }).took, null, 'a run with no start has no length')

  const wake = runWords({ id: 'sch-2', name: '', does: 'wake' }, { at: iso(T), outcome: 'passed', woke: true })
  assert.deepEqual(wake, { name: 'A schedule', ran: null, end: 'woke it', tone: 'quiet', took: null, wake: null }, 'a plain wake runs nothing: it woke its agent')
})

test('a folded row counts its runs, says they all ended the same way, and how long ago the last one did', () => {
  const [folded] = withRuns([], placedRuns([{ ...WATCH, runs: Array.from({ length: 27 }, (_, at) => run(at * 2)) }]), timeOf) as RunsRow[]
  const now = folded!.at + 2 * MINUTE
  assert.deepEqual(foldWords(folded!, now), { name: 'Watch CI for #412', count: 'ran 27 times', all: 'all pending', last: 'last 2 min ago', tone: 'quiet', wake: 'no wake' })
  const [ok] = withRuns([], placedRuns([{ ...WATCH, runs: [run(0, { outcome: 'passed', exitCode: 0, woke: true }), run(2, { outcome: 'passed', exitCode: 0, woke: true })] }]), timeOf) as RunsRow[]
  assert.deepEqual([foldWords(ok!, ok!.at).all, foldWords(ok!, ok!.at).wake, foldWords(ok!, ok!.at).last], ['all ok', 'each woke it', 'last just now'])
})

test("the key a page reads the runs again by changes when one of its schedules runs, and only for that page's own", () => {
  const list = [
    { id: 'sch-1', owner: { kind: 'hobkin' as const, id: 'a1b2c3d4' }, runs: 3, last: { at: iso(T), outcome: 'pending' as const } },
    { id: 'sch-2', owner: { kind: 'main' as const }, runs: 1 },
  ]
  const page = { kind: 'hobkin' as const, id: 'a1b2c3d4' }
  const key = runsKey(list, page)
  assert.equal(runsKey([...list], page), key, 'the same runs give the same key')
  assert.notEqual(runsKey([{ ...list[0]!, runs: 4, last: { at: iso(T + MINUTE), outcome: 'pending' } }, list[1]!], page), key)
  assert.equal(runsKey([list[0]!, { ...list[1]!, runs: 2 }], page), key, "another agent's run reads nothing")
  assert.equal(runsKey([], { kind: 'main' }), runsKey([list[0]!], { kind: 'main' }), 'a page with none has one key')
})
