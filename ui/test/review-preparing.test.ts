import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssessmentLogLine, AssessmentStatus } from '../../shared/review/assessment.ts'
import { IDLE_STATUS, type ReviewStatus } from '../../shared/review/status.ts'
import { elapsedAt, failureOf, preparingOf, tookAt, underWay } from '../src/features/review/preparing-model.ts'

const T0 = Date.parse('2026-11-12T16:00:00Z')
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()
const step = (id: string, status: string, extra: Partial<{ done: number; total: number; seconds: number | null; note: string }> = {}) => ({ id, status, done: 0, total: 1, seconds: null, ...extra })
const running = (assessment: Partial<AssessmentStatus>, rest: Partial<ReviewStatus> = {}): ReviewStatus => ({
  ...IDLE_STATUS('pr:hobkin-sample/api/198'),
  state: 'preparing',
  ...rest,
  assessment: { state: 'running', head: '7d41b08aa', ...assessment },
})

test('the preparing view reads elapsed, time left, now and steps', () => {
  const status = running({ percent: 42.4, now: 'Mapping definitions', eta: 75, steps: [step('triage', 'done', { seconds: 8 }), step('graph-walk', 'running', { done: 1, total: 3 }), step('story', 'pending')] }, { phase: 'reading' })
  const view = preparingOf(status, 1000, 66_000)
  assert.equal(view.state, 'running')
  assert.equal(view.now, 'Mapping definitions')
  assert.equal(view.percent, 42)
  assert.equal(view.elapsed, '1m 05s')
  assert.equal(view.left, '1m 15s')
  assert.deepEqual(view.steps.map((line) => [line.status, line.took, line.count]), [['done', '8s', null], ['running', '57s', '1 of 3'], ['waiting', null, null]])
  assert.equal(view.steps[1]!.label, 'Graph walk', 'a step the window has no words for is named by its id')
  assert.deepEqual(view.position, { step: 2, of: 3 })
})

test("the header says what is reviewed: the run's request, or the review's name before the run says", () => {
  const request = { kind: 'pull', project: 'hobkin-sample/api', number: 198, title: 'Retry webhook deliveries with a backoff', base: 'a3f9c2e5b1', head: '7d41b08aa2', files: 9, added: 214, removed: 38 } as const
  assert.deepEqual(preparingOf(running({ request }), null, T0).subject, {
    kind: 'pull',
    place: 'hobkin-sample/api #198',
    title: 'Retry webhook deliveries with a backoff',
    commits: 'a3f9c2e..7d41b08',
    files: 9,
    added: 214,
    removed: 38,
  })
  assert.deepEqual(preparingOf({ ...IDLE_STATUS('pr:Owner/Repo/78'), state: 'preparing', phase: 'queued' }, null, T0).subject, { kind: 'pull', place: 'owner/repo #78', title: null, commits: null, files: null, added: null, removed: null })
  assert.equal(preparingOf({ ...IDLE_STATUS('change:hobkin:7d02c9'), state: 'preparing', phase: 'reading' }, null, T0).subject?.place, 'hobkin')
})

test('the running sentence drops its step’s name, and the old phase words stand in only while no change review says more', () => {
  const steps = [step('map-search', 'running')]
  assert.equal(preparingOf(running({ now: 'map-search: asking agentic-search for every changed definition in 9 files', steps }), null, T0).now, 'Asking agentic-search for every changed definition in 9 files')
  assert.equal(preparingOf(running({ now: 'checking the change out in the review tree' }), null, T0).now, 'Checking the change out in the review tree')
  // An old pull request walk says only its phase; a change review under way says what it does.
  const phaseOnly = preparingOf({ ...IDLE_STATUS('pr:a/b/1'), state: 'preparing', phase: 'arranging' }, null, T0)
  const both = preparingOf(running({ now: 'story: writing the story from the units', steps: [step('story', 'running')] }, { phase: 'arranging' }), null, T0)
  assert.ok(phaseOnly.now.length > 0)
  assert.equal(both.now, 'Writing the story from the units')
  // The host words each thing the run does for its log: the newest line is what it does now.
  const logged = running({ now: 'map-proof: baseline run for every candidate test: 2 test files, exit 0', steps: [step('map-proof', 'running')], log: [{ at: iso(3), step: 'map-proof', text: "Ran 2 test files at the change's commit: they pass." }] })
  assert.equal(preparingOf(logged, null, T0).now, "Ran 2 test files at the change's commit: they pass.")
  const queued = preparingOf(running({ state: 'queued' }), null, T0)
  assert.equal(queued.state, 'queued')
  assert.equal(queued.percent, null)
  assert.equal(queued.position, null)
})

test('a step that was skipped or failed says why, and a run that stopped says what stopped it', () => {
  const steps = [step('map-search', 'failed', { seconds: 3, note: 'agentic-search is not installed' }), step('risk-model', 'skipped', { note: 'no model to ask' }), step('story', 'pending')]
  const view = preparingOf(running({ state: 'failed', error: 'The review tree could not be readied.', steps }), null, T0)
  assert.equal(view.state, 'failed')
  assert.equal(view.error, 'The review tree could not be readied.')
  assert.deepEqual(view.steps.map((line) => [line.status, line.took, line.note]), [['failed', '3s', 'agentic-search is not installed'], ['skipped', null, 'no model to ask'], ['waiting', null, null]])
  assert.equal(view.percent, null)
  assert.equal(view.left, null)
  assert.deepEqual(view.position, { step: 1, of: 3 })
})

test("the log keeps the run's lines oldest first, timed from the run's start, each keyed for as long as it stays", () => {
  const line = (seconds: number, text: string, stepId?: string): AssessmentLogLine => ({ at: iso(seconds), text, ...(stepId ? { step: stepId } : {}) })
  const first = [line(1, 'checking the change out'), line(5, 'triage: 9 files sorted into 3 buckets', 'triage'), line(72, 'map-proof: node run, exit 0', 'map-proof'), line(72, 'map-proof: node run, exit 0', 'map-proof')]
  const view = preparingOf(running({ startedAt: iso(0), log: first }), T0, T0 + 80_000)
  assert.deepEqual(view.log.map((entry) => [entry.at, entry.text]), [['0:01', 'checking the change out'], ['0:05', 'triage: 9 files sorted into 3 buckets'], ['1:12', 'map-proof: node run, exit 0'], ['1:12', 'map-proof: node run, exit 0']])
  assert.equal(new Set(view.log.map((entry) => entry.key)).size, 4, 'two lines alike are still two lines')
  // The host keeps the latest lines: the oldest goes and a new one comes, and the lines that stay keep their keys.
  const later = preparingOf(running({ startedAt: iso(0), log: [...first.slice(1), line(75, 'map-proof: done', 'map-proof')] }), T0, T0 + 80_000)
  assert.deepEqual(later.log.slice(0, 3).map((entry) => entry.key), view.log.slice(1).map((entry) => entry.key))
})

test("the running step's time counts from its first line in the log, else from the end of the steps before it", () => {
  const steps = [step('triage', 'done', { seconds: 4 }), step('map-search', 'running')]
  const log: AssessmentLogLine[] = [{ at: iso(1), text: 'checking the change out' }, { at: iso(7), step: 'map-search', text: 'map-search: asking agentic-search' }]
  // Its first line is in the log, after a line of something before it, or in a log the host has not cut: it started then.
  assert.equal(preparingOf(running({ startedAt: iso(0), steps, log }), T0, T0 + 30_000).steps[1]!.took, '23s')
  assert.equal(preparingOf(running({ startedAt: iso(0), steps, log: log.slice(1) }), T0, T0 + 30_000).steps[1]!.took, '23s')
  // A full log of its own lines may have lost its first ones: the steps before it ended about when it began.
  const full = Array.from({ length: 40 }, (_, index): AssessmentLogLine => ({ at: iso(10 + index / 4), step: 'map-search', text: `map-search: read file ${index}` }))
  assert.equal(preparingOf(running({ startedAt: iso(0), steps, log: full }), T0, T0 + 30_000).steps[1]!.took, '26s')
})

test('a view read once tells the time at any later moment, so only the texts of the time follow the clock', () => {
  const steps = [step('triage', 'done', { seconds: 4 }), step('map-search', 'running')]
  const log: AssessmentLogLine[] = [{ at: iso(1), text: 'checking the change out' }, { at: iso(7), step: 'map-search', text: 'map-search: asking agentic-search' }]
  const read = T0 + 30_000
  const view = preparingOf(running({ startedAt: iso(0), steps, log }), T0, read)
  // At the moment it was read, the same words as the view's.
  assert.deepEqual(view.steps.map((line) => tookAt(line, read)), view.steps.map((line) => line.took))
  assert.equal(elapsedAt(T0, read), view.elapsed)
  // A minute later the running step and the run have gone on, and the step that ended took what it took.
  assert.deepEqual(view.steps.map((line) => tookAt(line, read + 60_000)), ['4s', '1m 23s'])
  assert.equal(elapsedAt(T0, read + 60_000), '1m 30s')
  assert.equal(elapsedAt(null, read), null, 'a run with no start has no time')
})

test('a run is under way while the graph is built again or its change review waits or runs, and a stopped one says why', () => {
  const ready: ReviewStatus = { ...IDLE_STATUS('change:p:i'), state: 'ready', head: 'h' }
  assert.equal(underWay(ready), false)
  assert.equal(underWay({ ...ready, phase: 'queued' }), true)
  assert.equal(underWay({ ...ready, assessment: { state: 'queued', head: 'h' } }), true)
  assert.equal(underWay({ ...ready, assessment: { state: 'running', head: 'h', percent: 10 } }), true)
  assert.equal(underWay({ ...ready, assessment: { state: 'ready', head: 'h' } }), false)
  assert.equal(underWay(null), false)

  assert.equal(failureOf(ready), null)
  assert.equal(failureOf({ ...ready, assessment: { state: 'failed', head: 'h', error: 'The tests did not finish.' } }), 'The tests did not finish.')
  assert.ok(failureOf({ ...ready, assessment: { state: 'failed', head: 'h' } }), 'a stop without a reason is still said')
  assert.equal(failureOf({ ...ready, error: 'This pull request is not open any more.' }), 'This pull request is not open any more.')
})

test('a review built again says it is being prepared, with what it does and its log, though the change review behind its graph says queued', () => {
  const log = [{ at: iso(1), text: 'Asking GitHub where #198 is.' }]
  const builtAgain = (phase: ReviewStatus['phase'], assessment: AssessmentStatus): ReviewStatus => ({ ...IDLE_STATUS('pr:hobkin-sample/api/198'), state: 'ready', head: 'h', phase, assessment })
  const behindGraph: AssessmentStatus = { state: 'queued', head: 'h', percent: 0, log, steps: [step('triage', 'pending')] }

  const reading = preparingOf(builtAgain('reading', behindGraph), T0, T0)
  const waiting = preparingOf(builtAgain('queued', behindGraph), T0, T0)
  const afterStop = preparingOf(builtAgain('checking', { state: 'failed', head: 'h', error: 'The tests did not finish.' }), T0, T0)

  assert.deepEqual([reading.state, reading.now, reading.percent, reading.log.map((line) => line.text)], ['running', 'Reading the change', null, ['Asking GitHub where #198 is.']])
  assert.deepEqual([waiting.state, waiting.now], ['queued', 'Waiting its turn. One review runs at a time.'])
  assert.deepEqual([afterStop.state, afterStop.now, afterStop.error], ['running', 'Checking the result', null], 'built again after it stopped, the old reason is not said')
})
