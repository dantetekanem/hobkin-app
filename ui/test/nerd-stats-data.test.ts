import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ParentPerformance, RunTelemetry } from '../../shared/protocol/snapshot.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'
import { formatScalar, performanceStats, projectTelemetry } from '../src/features/settings/nerd-stats-data.ts'

const performance = (runId: string, value = 7): ParentPerformance => ({
  schemaVersion: 1, runId, sessionId: `session:${runId}`, responses: 1, incomplete: false,
  firstObservedOutputMs: 0, dispatchElapsedMs: 120,
  input: { value, state: 'complete' }, output: { value: 0, state: 'partial' },
  cacheRead: { value: null, state: 'unavailable' }, cacheWrite: { value: 0, state: 'complete' },
  estimatedUsd: { value: 0.00000001, state: 'complete' }, responseDurationMs: { value: 40, state: 'complete' },
})
const telemetry = (): RunTelemetry => ({
  schemaVersion: 1, connection: 'connected', stale: false, asOf: '2026-11-12T12:00:00Z',
  scope: 'own-parent-and-helpers', helpers: 'owned',
  retention: { maxRuns: 100, maxHelpersPerRun: 32, maxEventKeys: 100, eventMonthFiles: 2,
    eventTailBytesPerFile: 262144, eventReadState: 'available', eventTailTruncated: false, history: 'bounded' },
  runs: [{ runId: 'main:exact', sessionId: 'session:main:exact', kind: 'main', status: 'completed',
    startedAt: null, finishedAt: null, source: 'receipt', performance: performance('main:exact'),
    helpers: [
      { id: 'helper:one', parentId: 'main:exact', rootId: 'main:exact', depth: 1,
        sessionId: 'session:helper:one', status: 'completed', source: 'event', performance: performance('helper:one', 11) },
      { id: 'helper:two', parentId: 'helper:one', rootId: 'main:exact', depth: 2,
        sessionId: null, status: 'unknown', source: 'saved', performance: null },
      { id: 'helper:queued', parentId: 'main:exact', rootId: 'main:exact', depth: 1,
        sessionId: null, status: 'queued', source: 'live', performance: null },
    ] },
    { runId: 'background:exact', sessionId: null, kind: 'background', status: 'unknown',
      startedAt: null, finishedAt: null, source: 'saved', performance: performance('background:exact', 19) }],
})
const receive = (value?: RunTelemetry) => applyHostMessage(initialHostState,
  { type: 'state', rev: 1, reset: true, set: value ? { telemetry: value } : {} })

test('scalar formatting distinguishes complete zero, partial zero, unknown and tiny estimates', () => {
  assert.equal(formatScalar({ value: 0, state: 'complete' }, 'usd'), '$0 estimate')
  assert.equal(formatScalar({ value: 0, state: 'partial' }, 'usd'), '$0 estimate · partial')
  assert.equal(formatScalar({ value: null, state: 'unavailable' }, 'usd'), 'unavailable')
  assert.equal(formatScalar({ value: 0.00000001, state: 'complete' }, 'usd'), '$1e-8 estimate')
  assert.equal(formatScalar({ value: 0, state: 'complete' }), '0')
  assert.equal(formatScalar({ value: 0, state: 'partial' }), '0 · partial')
  assert.equal(performanceStats(null), null)
  const stats = Object.fromEntries(performanceStats(performance('own'))!)
  assert.equal(stats['Input tokens'], '7')
  assert.equal(stats['Output tokens'], '0 · partial')
  assert.equal(stats['Cache read tokens'], 'unavailable')
  assert.equal(stats['First observed output'], '0 ms')
  assert.equal(stats['Response duration'], '40 ms')
  assert.equal(stats['Dispatch elapsed'], '120 ms')
  assert.equal(stats['Responses'], '1')
  const unavailable = Object.fromEntries(performanceStats({
    ...performance('own'),
    responses: null,
    firstObservedOutputMs: null,
    dispatchElapsedMs: null,
  })!)
  assert.equal(unavailable['Responses'], 'unavailable')
})

test('projection preserves exact own-only main, background, helper and grandchild facts without mutation', () => {
  const value = telemetry()
  const before = structuredClone(value)
  const projected = projectTelemetry(receive(value))
  assert.deepEqual(projected.telemetry, before)
  assert.deepEqual(projected.telemetry!.runs.map(row => [row.kind, row.runId, row.performance!.input.value]),
    [['main', 'main:exact', 7], ['background', 'background:exact', 19]])
  assert.deepEqual(projected.telemetry!.runs[0]!.helpers, before.runs[0]!.helpers)
  assert.deepEqual(value, before)
})

test('absent and old-host facts stay unavailable while an empty retained set stays explicitly empty', () => {
  assert.equal(projectTelemetry(initialHostState).telemetry, null)
  assert.equal(projectTelemetry(receive()).telemetry, null)
  const empty = telemetry()
  empty.runs = []
  empty.helpers = 'unavailable'
  assert.deepEqual(projectTelemetry(receive(empty)).telemetry!.runs, [])
  assert.equal(projectTelemetry(receive(empty)).telemetry!.helpers, 'unavailable')
  empty.helpers = 'owned'
  assert.equal(projectTelemetry(receive(empty)).telemetry!.helpers, 'owned')
})

test('link loss and a new-home hello never upgrade retained facts into current telemetry', () => {
  const value = telemetry()
  value.retention.eventReadState = 'unavailable'
  value.retention.eventTailTruncated = true
  const held = receive(value)
  const lost = projectTelemetry(applyLink(held, 'lost'))
  assert.equal(lost.link, 'lost')
  assert.equal(lost.freshness, 'last-reported')
  assert.equal(lost.asOf, value.asOf)
  assert.deepEqual(lost.telemetry!.retention, value.retention)
  const hello = applyHostMessage(held, { type: 'hello', protocol: 1, home: '/fake/new-home', model: 'scripted',
    owner: { state: 'opening' }, signIn: { status: 'unknown' }, models: null, viewState: null })
  assert.equal(projectTelemetry(hello).link, 'open')
  assert.equal(projectTelemetry(hello).freshness, 'last-reported')
  assert.deepEqual(projectTelemetry(hello).telemetry, value)
  const reset = applyHostMessage(hello, { type: 'state', rev: 1, reset: true, set: {} })
  assert.equal(projectTelemetry(reset).telemetry, null)
  value.asOf = null
  value.connection = 'offline'
  value.stale = true
  const offline = projectTelemetry(receive(value))
  assert.equal(offline.asOf, 'unknown time')
  assert.equal(offline.telemetry!.connection, 'offline')
  assert.equal(offline.telemetry!.stale, true)
})
