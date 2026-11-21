import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as pause } from 'node:timers/promises'
import type { ProofsState } from '#shared/protocol/proofs.ts'
import { checkArguments, COMMANDS } from '#shared/commands/registry.ts'
import { runCommand } from '../src/commands.ts'
import { findTools, foldEvents, proofHandlers, ProofsKeeper, readRun, summaryOf, type ProofRuntime } from '../src/proofs.ts'
import { StateSync } from '../src/state-sync.ts'
import { temporaryDirectory } from './support.ts'

const T0 = Date.parse('2026-11-20T10:00:00Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()

const startEvent = { type: 'start', at: at(0), spec: '_specs/tla/WorkItem.tla', cfg: '_specs/tla/WorkItem.cfg', project: 'api', item: 'queue', head: 'abc1234', tool: 'TLC 1.7.4', workers: 4, model: '2 items' }
const progress = (seconds: number, distinct: number) => ({ type: 'progress', at: at(seconds), generated: distinct * 2, distinct, queue: 10, depth: 3 })

const writeEvents = (folder: string, events: object[]) => {
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'events.jsonl'), events.map((event) => JSON.stringify(event)).join('\n') + '\n')
}

/** A home with one run folder. */
function homeWith(t: Parameters<typeof temporaryDirectory>[0], id: string, events: object[], extra: Record<string, string> = {}) {
  const home = temporaryDirectory(t)
  const folder = join(home, 'proofs', id)
  writeEvents(folder, events)
  for (const [name, text] of Object.entries(extra)) writeFileSync(join(folder, name), text)
  return { home, folder }
}

test('events fold into a run, and its rate comes from the last two counts', () => {
  const run = foldEvents('r1', [
    startEvent,
    { type: 'step', step: 'parse', state: 'done', note: 'SANY · no errors' },
    { type: 'step', step: 'check', state: 'running', note: '' },
    progress(2, 100),
    progress(4, 300),
    { type: 'rule', name: 'Safe', kind: 'invariant', status: 'holding', words: 'nothing is lost' },
    { type: 'action', name: 'Push', count: 7, code: 'src/a.mjs:1' },
    { type: 'log', at: at(1), text: 'TLC started', tone: 'running' },
  ])
  assert.equal(run.outcome, 'checking')
  assert.equal(run.project, 'api')
  assert.deepEqual(run.steps.map((step) => [step.id, step.state]), [['parse', 'done'], ['check', 'running'], ['prove', 'waiting']])
  assert.deepEqual(run.stats, { generated: 600, distinct: 300, queue: 10, depth: 3 })
  assert.deepEqual(run.samples, [{ at: 2000, distinct: 100 }, { at: 4000, distinct: 300 }])
  const summary = summaryOf(run)
  assert.equal(summary.rate, 100)
  assert.equal('samples' in summary || 'log' in summary, false)
})

test('a finished run comes from result.json, over what the events said', (t) => {
  const { folder } = homeWith(t, 'r1', [startEvent, progress(2, 100)])
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ outcome: 'broken', broken: 'Safe', traceLength: 5, stats: { generated: 9, distinct: 5, queue: 0, depth: 5 }, finished: at(9), counts: false }))
  const run = readRun(folder, 'r1')!
  assert.equal(run.outcome, 'broken')
  assert.equal(run.broken, 'Safe')
  assert.equal(run.spec, '_specs/tla/WorkItem.tla')
  assert.equal(run.stats.distinct, 5)
  assert.equal(summaryOf(run).rate, undefined)
})

test('a run whose process is gone and left no result ends as an error, or as stopped when the host stopped it', (t) => {
  const { folder } = homeWith(t, 'r1', [startEvent, progress(2, 100)], { pid: '4242' })
  assert.equal(readRun(folder, 'r1', { alive: () => true })!.outcome, 'checking')
  const gone = readRun(folder, 'r1', { alive: () => false })!
  assert.equal(gone.outcome, 'error')
  assert.match(gone.message ?? '', /without a result/)
  assert.equal(readRun(folder, 'r1', { alive: () => false, stopped: new Set(['r1']) })!.outcome, 'stopped')
})

test('a folder with nothing in it is no run', (t) => {
  const home = temporaryDirectory(t)
  mkdirSync(join(home, 'proofs', 'empty'), { recursive: true })
  assert.equal(readRun(join(home, 'proofs', 'empty'), 'empty'), null)
})

const tools = { java: '/j/java', tlc: null, tlaps: null }

test('the keeper holds running runs and the 20 newest, and says when the folder changes', async (t) => {
  const home = temporaryDirectory(t)
  for (let n = 0; n < 23; n++) {
    const folder = join(home, 'proofs', `done-${String(n).padStart(2, '0')}`)
    writeEvents(folder, [{ ...startEvent, at: at(n) }])
    writeFileSync(join(folder, 'result.json'), JSON.stringify({ outcome: 'holds', finished: at(n + 1) }))
  }
  // The oldest run of all is still going, so it stays.
  writeEvents(join(home, 'proofs', 'live'), [{ ...startEvent, at: at(-100) }, progress(-90, 50)])
  writeFileSync(join(home, 'proofs', 'live', 'pid'), String(process.pid))
  let changes = 0
  const keeper = new ProofsKeeper({ home: () => home, onChange: () => changes++, tools: () => tools, pollMs: 20 })
  t.after(() => keeper.close())
  await pause(700)
  const ids = keeper.state.runs.map((run) => run.id)
  assert.equal(ids.length, 21)
  assert.equal(ids.at(-1), 'live')
  assert.equal(ids[0], 'done-22')
  assert.equal(ids.includes('done-02'), false)
  assert.deepEqual(keeper.state.tools, tools)
  assert.ok(changes >= 1)

  const before = changes
  appendFileSync(join(home, 'proofs', 'live', 'events.jsonl'), JSON.stringify(progress(-80, 900)) + '\n')
  await pause(900)
  assert.equal(keeper.state.runs.find((run) => run.id === 'live')?.stats.distinct, 900)
  assert.ok(changes > before)
})

test('a run is read at most twice a second', async (t) => {
  const { home, folder } = homeWith(t, 'live', [startEvent, progress(1, 1)], { pid: String(process.pid) })
  let changes = 0
  const keeper = new ProofsKeeper({ home: () => home, onChange: () => changes++, tools: () => tools, pollMs: 5 })
  t.after(() => keeper.close())
  await pause(300)
  const start = changes
  const started = Date.now()
  for (let n = 2; n < 40; n++) {
    appendFileSync(join(folder, 'events.jsonl'), JSON.stringify(progress(n, n * 10)) + '\n')
    await pause(20)
  }
  const seconds = (Date.now() - started) / 1000
  assert.ok(changes - start <= Math.ceil(seconds * 2) + 1, `${changes - start} changes in ${seconds}s`)
  assert.ok(changes - start >= 1)
})

test('a host with no proofs folder has no runs, and the keeper finds one made later', async (t) => {
  const home = temporaryDirectory(t)
  const keeper = new ProofsKeeper({ home: () => home, onChange: () => {}, tools: () => tools, pollMs: 20, watch: false })
  t.after(() => keeper.close())
  await pause(700)
  assert.deepEqual(keeper.state.runs, [])
  assert.equal(keeper.run('anything'), null)
  writeEvents(join(home, 'proofs', 'late'), [startEvent])
  writeFileSync(join(home, 'proofs', 'late', 'pid'), String(process.pid))
  await pause(900)
  assert.deepEqual((keeper.state as ProofsState).runs.map((run) => run.id), ['late'])
})

test('with no hobkin home at all the keeper holds an empty slice', async (t) => {
  const keeper = new ProofsKeeper({ home: () => null, onChange: () => {}, pollMs: 20 })
  t.after(() => keeper.close())
  await pause(100)
  assert.deepEqual(keeper.state, { runs: [] })
})

/** A keeper on a fast poll that counts its reads of the folder: each one asks the clock once to start. */
function counted(t: Parameters<typeof temporaryDirectory>[0], options: { home: () => string | null; alive?: (pid: number) => boolean }) {
  const reads = { count: 0 }
  const keeper = new ProofsKeeper({ ...options, onChange: () => {}, tools: () => tools, pollMs: 5, now: () => (reads.count++, Date.now()) })
  t.after(() => keeper.close())
  return { keeper, reads }
}

test('with its folder watched and no run checking, the poll reads nothing, and a new run still shows up at once', async (t) => {
  const { home, folder } = homeWith(t, 'done', [startEvent])
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ outcome: 'holds', finished: at(1) }))
  const { keeper, reads } = counted(t, { home: () => home })
  // The first read, and one more once the watch is set, half a second later.
  await pause(800)
  reads.count = 0
  // Longer than the half second between two reads, so a poll that reads cannot hide.
  await pause(600)
  assert.equal(reads.count, 0, 'nothing to see, nothing read')

  writeEvents(join(home, 'proofs', 'new'), [{ ...startEvent, at: at(5) }])
  writeFileSync(join(home, 'proofs', 'new', 'pid'), String(process.pid))
  await pause(600)
  assert.deepEqual(keeper.state.runs.map((run) => run.id), ['new', 'done'])
})

test('a home with no proofs folder is watched for one, so the poll reads nothing until the first run', async (t) => {
  const home = temporaryDirectory(t)
  const { keeper, reads } = counted(t, { home: () => home })
  await pause(800)
  reads.count = 0
  // Longer than the half second between two reads, so a poll that reads cannot hide.
  await pause(600)
  assert.equal(reads.count, 0)
  writeEvents(join(home, 'proofs', 'first'), [startEvent])
  await pause(600)
  assert.deepEqual(keeper.state.runs.map((run) => run.id), ['first'])
})

test('while a run is checking the poll keeps reading, since its process can end without writing anything', async (t) => {
  const { home } = homeWith(t, 'live', [startEvent], { pid: '4242' })
  let alive = true
  const { keeper } = counted(t, { home: () => home, alive: () => alive })
  await pause(300)
  assert.equal(keeper.state.runs[0]?.outcome, 'checking')
  alive = false
  await pause(900)
  assert.equal(keeper.state.runs[0]?.outcome, 'error')
})

test('the poll reads a home that opens later, or another one', async (t) => {
  const { home } = homeWith(t, 'r1', [startEvent], { 'result.json': JSON.stringify({ outcome: 'holds', finished: at(1) }) })
  const other = homeWith(t, 'r2', [startEvent], { 'result.json': JSON.stringify({ outcome: 'holds', finished: at(1) }) })
  let current: string | null = null
  const { keeper } = counted(t, { home: () => current })
  await pause(100)
  current = home
  await pause(700)
  assert.deepEqual(keeper.state.runs.map((run) => run.id), ['r1'])
  current = other.home
  await pause(700)
  assert.deepEqual(keeper.state.runs.map((run) => run.id), ['r2'])
})

test('the state message carries the proofs slice when it changes and with every reset, and not at all from a host that sends none', () => {
  const owner = { state: 'live' } as never
  const base = { owner, signIn: { state: 'signedOut' } as never, models: null, snapshot: null }
  const none = new StateSync(base)
  assert.equal('proofs' in none.full(), false)
  assert.equal(none.update(base), null)

  const slice: ProofsState = { runs: [] }
  const sync = new StateSync({ ...base, proofs: slice })
  assert.deepEqual(sync.full().proofs, slice)
  assert.equal(sync.update({ ...base, proofs: slice }), null)
  const next: ProofsState = { runs: [{ id: 'r1', spec: 's', tool: 'TLC', workers: 1, started: at(0), outcome: 'checking', steps: [], stats: { generated: 0, distinct: 0, queue: 0, depth: 0 }, rules: [], actions: [] }] }
  assert.deepEqual(sync.update({ ...base, proofs: next })?.proofs, next)
  assert.equal(sync.update({ ...base, proofs: { runs: [...next.runs] } }), null)
})

function seat(t: Parameters<typeof temporaryDirectory>[0], runtime: ProofRuntime, pid: string | null = null) {
  const { home, folder } = homeWith(t, 'r1', [startEvent, progress(2, 100)], pid ? { pid } : {})
  writeFileSync(join(folder, 'result.json'), JSON.stringify({ outcome: 'holds', cfg: '_specs/tla/WorkItem.cfg', root: '/work/api/trees/proof' }))
  const keeper = new ProofsKeeper({ home: () => home, onChange: () => {}, tools: () => tools, pollMs: 1000 })
  t.after(() => keeper.close())
  return { home, folder, keeper, handlers: proofHandlers({ keeper, home: () => home, runtime: async () => runtime, pauseMs: 5, graceMs: 60 }) }
}

test('proof.get answers the whole run, and says plainly when there is none', async (t) => {
  const { handlers } = seat(t, {})
  const got = await runCommand(handlers, 'proof.get', { id: 'r1' })
  assert.equal(got.ok && (got.value as { spec: string }).spec, '_specs/tla/WorkItem.tla')
  const none = await runCommand(handlers, 'proof.get', { id: 'nope' })
  assert.match(!none.ok ? none.error.message : '', /no proof run nope/)
  assert.equal(checkArguments('proof.get', { id: '../x' }).ok, false)
})

test('proof.again starts the same check through the runtime, and an older runtime says so', async (t) => {
  const calls: unknown[] = []
  const { handlers, home } = seat(t, { check: (input) => (calls.push(input), { id: 'r2', message: 'Started r2.' }) })
  assert.deepEqual(await runCommand(handlers, 'proof.again', { id: 'r1' }), { ok: true, value: { message: 'Started r2.', id: 'r2' } })
  assert.deepEqual(calls, [{ home, spec: '_specs/tla/WorkItem.tla', cfg: '_specs/tla/WorkItem.cfg', root: '/work/api/trees/proof', project: 'api', item: 'queue' }])

  const old = seat(t, {})
  const refused = await runCommand(old.handlers, 'proof.again', { id: 'r1' })
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.match(!refused.ok ? refused.error.message : '', /cannot start a proof check/)
})

test('proof.setup runs the runtime setup, only from the window, and an older runtime says so', async (t) => {
  assert.equal(COMMANDS['proof.setup'].outside, true)
  assert.equal('hobkin' in COMMANDS['proof.setup'], false)
  const { handlers } = seat(t, { setup: () => 'The jar is in place.' })
  assert.deepEqual(await runCommand(handlers, 'proof.setup', {}), { ok: true, value: { message: 'The jar is in place.' } })
  const refused = await runCommand(seat(t, {}).handlers, 'proof.setup', {})
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
})

test('proof.stop asks the process to end, kills one that ignores it, and has the runtime record it', async (t) => {
  const recorded: unknown[] = []
  const signals: string[] = []
  const { home, folder } = seat(t, {})
  let alive = true
  const keeper = new ProofsKeeper({ home: () => home, onChange: () => {}, tools: () => tools, alive: () => alive, pollMs: 1000 })
  t.after(() => keeper.close())
  // A run still going: no result yet.
  const live = join(home, 'proofs', 'live')
  writeEvents(live, [startEvent])
  writeFileSync(join(live, 'pid'), '777')
  const handlers = proofHandlers({
    keeper,
    home: () => home,
    runtime: async () => ({ stop: (input) => void recorded.push(input) }),
    alive: () => alive,
    kill: (pid, signal) => {
      signals.push(`${pid}:${signal}`)
      if (signal === 'SIGKILL') alive = false
    },
    pauseMs: 5,
    graceMs: 40,
  })
  const said = await runCommand(handlers, 'proof.stop', { id: 'live' })
  assert.deepEqual(signals, ['777:SIGTERM', '777:SIGKILL'])
  assert.deepEqual(recorded, [{ home, id: 'live' }])
  assert.equal(said.ok && (said.value as { message: string }).message, 'Stopped run live.')
  assert.equal(keeper.stopped.has('live'), false)
  assert.equal(folder.length > 0, true)

  // A run that has ended is left alone.
  const ended = await runCommand(handlers, 'proof.stop', { id: 'r1' })
  assert.match(ended.ok ? (ended.value as { message: string }).message : '', /already ended/)
})

test('proof.stop with an older runtime still ends the process and shows the run as stopped', async (t) => {
  const { home } = seat(t, {})
  let alive = true
  const keeper = new ProofsKeeper({ home: () => home, onChange: () => {}, tools: () => tools, alive: () => alive, pollMs: 1000 })
  t.after(() => keeper.close())
  const live = join(home, 'proofs', 'live')
  writeEvents(live, [startEvent])
  writeFileSync(join(live, 'pid'), '778')
  const handlers = proofHandlers({ keeper, home: () => home, runtime: async () => ({}), alive: () => alive, kill: () => void (alive = false), pauseMs: 5, graceMs: 40 })
  const said = await runCommand(handlers, 'proof.stop', { id: 'live' })
  assert.match(said.ok ? (said.value as { message: string }).message : '', /not recorded as stopped/)
  assert.equal(alive, false)
  assert.equal(readRun(live, 'live', { alive: () => false, stopped: keeper.stopped })!.outcome, 'stopped')
})

test('the tools are found where hobkin proof setup puts them', (t) => {
  const home = temporaryDirectory(t)
  mkdirSync(join(home, 'tools', 'tla'), { recursive: true })
  writeFileSync(join(home, 'tools', 'tla', 'tla2tools.jar'), '')
  mkdirSync(join(home, 'tools', 'tlaps', 'bin'), { recursive: true })
  writeFileSync(join(home, 'tools', 'tlaps', 'bin', 'tlapm'), '')
  const found = findTools(home, { PATH: '' })
  assert.equal(found.tlc, join(home, 'tools', 'tla', 'tla2tools.jar'))
  assert.equal(found.tlaps, join(home, 'tools', 'tlaps', 'bin', 'tlapm'))
  assert.equal(found.java, null)

  // The Java runtime it installs on a Mac without one.
  const java = join(home, 'tools', 'java', 'Contents', 'Home', 'bin', 'java')
  mkdirSync(join(java, '..'), { recursive: true })
  writeFileSync(java, '')
  assert.equal(findTools(home, { PATH: '' }).java, java)
})
