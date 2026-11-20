import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { YoloProject, YoloState } from '#shared/protocol/work.ts'
import { readinessRow, sampleReadiness, yoloAtAGlance } from '../src/features/work/yolo-page.ts'

const NOW = Date.parse('2026-11-20T15:00:00Z')
const project = (change: Partial<YoloProject> = {}): YoloProject => ({
  slug: 'api',
  name: 'api',
  ready: false,
  needs: ['Its readiness has not been checked yet.'],
  work: 'none',
  checkedAt: null,
  ...change,
})
const rowOf = (change: Partial<YoloProject>, workOn = true) => readinessRow(project(change), { workOn, now: NOW, zone: 'UTC' })
const yolo = (projects: YoloProject[], on = true): YoloState => ({ on, rate: 8, lowest: 6, highest: 10, ready: projects.filter(({ ready }) => ready).length, projects })

test("Work's header says at a glance how YOLO mode stands", () => {
  const five = yolo([project({ ready: true }), project({ ready: true }), project(), project(), project()])
  assert.equal(yoloAtAGlance(five), 'On · 2 of 5 ready')
  assert.equal(yoloAtAGlance({ ...five, on: false }), 'Off')
  assert.equal(yoloAtAGlance(yolo([])), 'On')
})

test('a project never checked offers Run readiness, and one checked offers Check again', () => {
  const never = rowOf({})
  assert.deepEqual([never.action, never.canRun, never.checked], ['Run readiness', true, 'Not checked yet'])

  const ready = rowOf({ ready: true, needs: [], work: 'landed', checkedAt: '2026-11-20T09:30:00Z' })
  assert.deepEqual([ready.state, ready.tone, ready.action, ready.canRun, ready.checked], ['Ready', 'ok', 'Check again', true, 'Checked today 09:30'])

  // What the last check found missing is hobkin's own words.
  const missing = rowOf({ needs: ['Alerts: No alert reaches you.', 'Rollback: No way back.'], work: 'landed', checkedAt: '2026-11-19T09:30:00Z' })
  assert.deepEqual([missing.state, missing.detail, missing.action, missing.canRun], ['Not ready', 'Alerts: No alert reaches you. Rollback: No way back.', 'Check again', true])

  const closed = rowOf({ needs: ['Its readiness work was closed without landing.'], work: 'closed', checkedAt: '2026-11-19T09:30:00Z' })
  assert.deepEqual([closed.state, closed.action, closed.canRun], ['Not ready', 'Check again', true])
})

test("readiness that runs or waits for the user's yes cannot be started again, and queued readiness can start now", () => {
  const running = rowOf({ work: 'running' })
  assert.deepEqual([running.state, running.tone, running.canRun], ['Running', 'live', false])

  const waiting = rowOf({ work: 'waiting', needs: ['Its readiness work waits for your yes.'] })
  assert.deepEqual([waiting.state, waiting.tone, waiting.canRun], ['Waits for your yes', 'warn', false])

  const queued = rowOf({ work: 'queued' })
  assert.deepEqual([queued.state, queued.canRun], ['Queued', true])
  assert.match(rowOf({ work: 'queued' }, false).detail, /once work mode is on/)
})

test('an older hobkin that does not say where readiness work stands still offers to run it', () => {
  const { work: _work, checkedAt: _checkedAt, ...older } = project()
  const row = readinessRow(older, { workOn: true, now: NOW, zone: 'UTC' })
  assert.deepEqual([row.action, row.canRun], ['Run readiness', true])
})

test('with no host, running readiness queues it on the sample alone', () => {
  const before = yolo([project({ slug: 'api' }), project({ slug: 'web', work: 'landed', ready: true, needs: [] })], false)
  const after = sampleReadiness(before, 'api')
  assert.deepEqual(after.projects.map(({ slug, work }) => [slug, work]), [['api', 'queued'], ['web', 'landed']])
  assert.equal(after.on, false, 'the switch stays as it was')
})
