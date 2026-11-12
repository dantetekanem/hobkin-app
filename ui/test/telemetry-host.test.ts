import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunTelemetry, WireSnapshot } from '../../shared/protocol/snapshot.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

const telemetry = (): RunTelemetry => ({
  schemaVersion: 1, connection: 'connected', stale: false, asOf: null,
  scope: 'own-parent', helpers: 'unavailable',
  retention: { maxRuns: 100, eventMonthFiles: 2, eventTailBytesPerFile: 262144,
    eventReadState: 'available', eventTailTruncated: false, history: 'bounded' },
  runs: [{
    runId: 'run:exact', sessionId: 'session:exact', kind: 'main', status: 'completed',
    startedAt: null, finishedAt: null, source: 'receipt',
    performance: {
      schemaVersion: 1, runId: 'run:exact', sessionId: 'session:exact', responses: 1,
      incomplete: true, firstObservedOutputMs: 0, dispatchElapsedMs: 120,
      input: { value: 0, state: 'complete' }, output: { value: 3, state: 'partial' },
      cacheRead: { value: null, state: 'unavailable' }, cacheWrite: { value: 0, state: 'complete' },
      estimatedUsd: { value: 0, state: 'partial' }, responseDurationMs: { value: null, state: 'unavailable' },
    },
  }],
})

const receive = (snapshot: WireSnapshot) => applyHostMessage(initialHostState, { type: 'state', rev: 1, reset: true, set: snapshot })

const helperTelemetry = (): RunTelemetry => {
  const value = telemetry()
  const parent = value.runs[0]!
  value.scope = 'own-parent-and-helpers'
  value.helpers = 'owned'
  value.retention.maxHelpersPerRun = 32
  value.retention.maxEventKeys = 100
  parent.helpers = [
    {
      id: 'helper:exact', parentId: 'run:exact', rootId: 'root:exact', depth: 1,
      sessionId: 'session:helper', status: 'completed', source: 'event',
      performance: { ...parent.performance!, runId: 'helper:exact', sessionId: 'session:helper' },
    },
    {
      id: 'helper:unknown', parentId: 'helper:exact', rootId: 'root:exact', depth: 2,
      sessionId: null, status: 'unknown', source: 'saved', performance: null,
    },
  ]
  return value
}

test('typed parent telemetry retains exact identities, measured zero, partial estimates and unknowns', () => {
  const held = receive({ telemetry: telemetry() }).snapshot.telemetry!
  const row = held.runs[0]!
  assert.equal(row.runId, 'run:exact')
  assert.equal(row.sessionId, 'session:exact')
  assert.equal(row.source, 'receipt')
  assert.equal(row.performance!.firstObservedOutputMs, 0)
  assert.deepEqual(row.performance!.input, { value: 0, state: 'complete' })
  assert.deepEqual(row.performance!.output, { value: 3, state: 'partial' })
  assert.deepEqual(row.performance!.estimatedUsd, { value: 0, state: 'partial' })
  assert.deepEqual(row.performance!.cacheRead, { value: null, state: 'unavailable' })
  assert.equal(held.helpers, 'unavailable')
  assert.deepEqual(held, telemetry())
})

test('offline saved and unavailable measurements retain provenance and freshness', () => {
  const saved = telemetry()
  saved.connection = 'offline'; saved.stale = true; saved.asOf = '2026-11-11T12:00:00.000Z'
  saved.runs[0]!.source = 'saved'
  saved.runs.push({ ...saved.runs[0]!, runId: 'missing', sessionId: null, source: 'unavailable', performance: null })
  assert.deepEqual(receive({ telemetry: saved }).snapshot.telemetry, saved)
})

test('helper telemetry survives full, delta, unset, reset and link-loss frames', () => {
  const original = helperTelemetry()
  let state = receive({ telemetry: original })
  assert.deepEqual(state.snapshot.telemetry, original)
  state = applyHostMessage(state, { type: 'state', rev: 2, set: { busy: true } })
  assert.deepEqual(state.snapshot.telemetry, original)
  assert.deepEqual(applyLink({ ...state, link: 'open' }, 'lost').snapshot.telemetry, original)
  state = applyHostMessage(state, { type: 'state', rev: 3, unset: ['telemetry'] })
  assert.equal(state.snapshot.telemetry, undefined)
  state = applyHostMessage(state, { type: 'state', rev: 1, reset: true, set: { telemetry: original } })
  assert.deepEqual(state.snapshot.telemetry, original)
  assert.equal(state.snapshot.telemetry!.runs[0]!.performance!.runId, 'run:exact')
  assert.equal(state.snapshot.telemetry!.runs[0]!.helpers![0]!.performance!.runId, 'helper:exact')
})

test('disconnect retains last-known telemetry without pretending the link is live', () => {
  const held = { ...receive({ telemetry: telemetry() }), link: 'open' as const }
  const lost = applyLink(held, 'lost')
  assert.equal(lost.link, 'lost')
  assert.deepEqual(lost.snapshot.telemetry, held.snapshot.telemetry)
  assert.equal(lost.epoch, held.epoch)
})

test('missing old-host telemetry, unset and home-following resets do not reuse another epoch', () => {
  const held = receive({ telemetry: telemetry() })
  assert.equal(receive({ busy: false }).snapshot.telemetry, undefined)
  assert.equal(applyHostMessage(held, { type: 'state', rev: 2 }).snapshot.telemetry, held.snapshot.telemetry)
  assert.equal(applyHostMessage(held, { type: 'state', rev: 2, unset: ['telemetry'] }).snapshot.telemetry, undefined)
  const hello = applyHostMessage(held, { type: 'hello', protocol: 1, home: '/fake/another-home', model: 'scripted',
    owner: { state: 'opening' }, signIn: { status: 'unknown' }, models: null, viewState: null })
  assert.equal(hello.home, '/fake/another-home')
  const reset = applyHostMessage(hello, { type: 'state', rev: 1, reset: true, set: { busy: false } })
  assert.equal(reset.snapshot.telemetry, undefined)
  assert.equal(reset.epoch, held.epoch + 1)
})
