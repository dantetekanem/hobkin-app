import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { act, createElement } from 'react'
import type { ProofRun, ProofRunSummary } from '../../shared/protocol/proofs.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { sampleRun, sampleSummary } from '../src/features/proofs/sample.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setInterval'] })

/** The whole runs hobkin would answer `proof.get` with, and every id the window asked for. */
const whole = new Map<string, ProofRun>()
const asked: string[] = []
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async (name: string, args: { id: string }) => {
  if (name !== 'proof.get') throw new Error(`Nothing here sends ${name}`)
  asked.push(args.id)
  const run = whole.get(args.id)
  if (!run) throw new Error('No such run')
  return run
})
const { hostStore } = await import('../src/lib/host/client.ts')
const { useProofRun } = await import('../src/features/proofs/use-proof-run.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
/** The slice as the host sends it: new objects every time, whatever changed. */
const slice = (...runs: ProofRunSummary[]): HostMessage => ({ type: 'state', rev: rev++, proofs: { runs: runs.map((run) => structuredClone(run)) } })
const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 5)))

const STARTED = Date.parse('2026-11-20T14:05:00Z')
const ended = { ...sampleRun('holds', STARTED), id: 'ended-1' }
const checking = { ...sampleRun('checking', STARTED), id: 'checking-1' }
whole.set(ended.id, ended)
whole.set(checking.id, checking)

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [] }, proofs: { runs: [sampleSummary(ended), sampleSummary(checking)] } })

function probe(id: string) {
  const shown = new Set<ProofRun>()
  const counted = { draws: 0, shown, last: null as ProofRun | null }
  const Probe = () => {
    counted.draws += 1
    const { run } = useProofRun(id)
    if (run) shown.add(run)
    counted.last = run
    return null
  }
  return { counted, Probe }
}

test("a run's object keeps its identity while the slice says the same of it, and a run that ended is read whole once", async () => {
  const { counted, Probe } = probe(ended.id)
  const mounted = await mountCounting(() => createElement(Probe))
  await settle()
  assert.deepEqual(asked, [ended.id])
  assert.equal(counted.last?.definitions.length, ended.definitions.length, 'the whole run arrived')
  const before = counted.shown.size

  // Another run moves, and the host sends the whole slice again ten times: this run's summary is the same each time.
  for (let index = 0; index < 10; index++) {
    const moved = { ...sampleSummary(checking), stats: { ...checking.stats, distinct: checking.stats.distinct + index } }
    await mounted.change(() => send(slice(sampleSummary(ended), moved)))
  }
  await settle()
  assert.equal(counted.shown.size, before, 'the same run, the same object')
  assert.deepEqual(asked, [ended.id], 'nothing asked again')
  await mounted.unmount()

  // Opened again, it shows the run as it was read, at once, and asks nothing.
  const again = probe(ended.id)
  const reopened = await mountCounting(() => createElement(again.Probe))
  await settle()
  assert.equal(again.counted.last?.definitions.length, ended.definitions.length)
  assert.deepEqual(asked, [ended.id], 'an ended run is not read again')
  await reopened.unmount()
})

test("while a run checks, the clock's ticks draw nothing where the run is read", async () => {
  const { counted, Probe } = probe(checking.id)
  const mounted = await mountCounting(() => createElement(Probe))
  await settle()
  const draws = counted.draws
  await act(async () => mock.timers.tick(5000))
  assert.equal(counted.draws, draws, 'only the text that shows time reads the clock')
  await mounted.unmount()
})
