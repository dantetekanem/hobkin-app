import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ProofRun } from '#shared/protocol/proofs.ts'
import { actionRows, CHART_POINTS, chartOf, clock, codeRows, controlOf, countersOf, coverageNote, elapsedLine, LOG_LINES, logRows, phaseOf, resultOf, ruleRows, stepRows } from '../src/features/proofs/run/run-view.ts'
import { SAMPLE_ELAPSED_MS, SAMPLE_RUNS, sampleRun } from '../src/features/proofs/sample.ts'

const STARTED = Date.parse('2026-11-20T14:05:00Z')
const run = (phase: keyof typeof SAMPLE_RUNS, change: Partial<ProofRun> = {}): ProofRun => ({ ...sampleRun(phase, STARTED), ...change })
const now = (phase: keyof typeof SAMPLE_RUNS) => STARTED + SAMPLE_ELAPSED_MS[phase]

test('the page says where the run stands, how long it took and offers Stop while it runs and Run again after', () => {
  assert.deepEqual(phaseOf(run('checking')), { label: 'Checking the model', tone: 'live' })
  assert.deepEqual(phaseOf(run('broken')), { label: 'Found a counterexample', tone: 'bad' })
  assert.deepEqual(phaseOf(run('holds')), { label: 'Model holds', tone: 'ok' })
  assert.deepEqual(phaseOf(run('proved')), { label: 'Holds, and proved', tone: 'ok' })

  assert.equal(elapsedLine(run('checking'), now('checking')), '0:41 so far')
  assert.equal(elapsedLine(run('broken'), now('broken') + 60_000), 'Stopped at 0:09')
  assert.equal(elapsedLine(run('holds'), now('holds')), 'Finished in 2:37')
  assert.equal(clock(725_000), '12:05')

  assert.deepEqual(controlOf(run('checking')), { label: 'Stop check', command: 'proof.stop' })
  assert.deepEqual(controlOf(run('broken')), { label: 'Run again', command: 'proof.again' })
})

test('the steps are always Parse, Model check and Proof, and a step with no note names its tool', () => {
  assert.deepEqual(stepRows(run('checking')).map(({ name, look }) => [name, look]), [['Parse', 'done'], ['Model check', 'running'], ['Proof', 'waiting']])
  assert.deepEqual(stepRows(run('broken')).map(({ look }) => look), ['done', 'failed', 'waiting'])

  // Where a step has two short lines, its note leaves out the tool, which the step's name already says.
  assert.deepEqual(stepRows(run('broken')).map(({ brief }) => brief), ['No errors · 0.4 s', 'Counterexample at depth 5', 'Waits until the model holds'])
  assert.deepEqual(stepRows(run('proofFails')).map(({ brief }) => brief).at(-1), '⟨2⟩5 fails')

  const early = stepRows({ steps: [{ id: 'parse', state: 'running', note: '' }] })
  assert.deepEqual(early.map(({ note, look }) => [note, look]), [['SANY', 'running'], ['TLC', 'waiting'], ['TLAPS · optional', 'waiting']])
})

test('the last counter is the counterexample once one is found, and the deepest path before', () => {
  assert.deepEqual(countersOf(run('checking')).map(({ label, value }) => [label, value]), [['Distinct states', '12,408'], ['States found', '61,950'], ['Waiting', '3,112'], ['Deepest path', '14']])
  const broken = countersOf(run('broken'))
  assert.deepEqual([broken[2]!.sub, broken[3]!.label, broken[3]!.value], ['Left when it stopped', 'Counterexample', '5'])
  assert.deepEqual(countersOf(run('holds')).map(({ sub }) => sub), ['All of them', 'Including repeats', 'Nothing left', 'Steps from the start'])
})

test('the chart always has the same points, so one line turns into the next, and leaves room while it checks', () => {
  const live = chartOf(run('checking'))
  const done = chartOf(run('holds'))
  assert.equal(live.line.split(' L').length, CHART_POINTS)
  assert.equal(done.line.split(' L').length, CHART_POINTS)
  // While it checks the newest count sits short of the right edge and the top; once it ended the line reaches both.
  assert.match(live.area, / L372 108 L0 108 Z$/)
  assert.match(done.area, / L600 108 L0 108 Z$/)
  assert.ok(done.line.includes('600 6'))
  assert.equal(live.caption, '18,200 states a second')
  assert.equal(live.tone, 'live')
  assert.equal(live.aria, 'New states are still rising, but more slowly.')
  assert.equal(chartOf(run('broken')).caption, 'Stopped at depth 5')

  // A run with no samples yet draws a flat line on the floor, and a rate from its samples when it sends none.
  const empty = chartOf({ ...run('checking'), samples: [], rate: undefined })
  assert.ok(empty.line.split(' L').every((point) => point.endsWith(' 108')))
  assert.equal(chartOf({ ...run('checking'), rate: undefined, samples: [{ at: 0, distinct: 0 }, { at: 2000, distinct: 500 }] }).caption, '250 states a second')
})

test('TLC counts once a minute: a short run draws a straight rise from nothing, and says when counts arrive', () => {
  const short = { ...run('holds'), samples: [{ at: 40_000, distinct: 812 }] }
  const points = chartOf(short).line.slice(1).split(' L')

  // From the floor at the start to the top at its one count, never a flat line.
  assert.equal(points[0], '0 108')
  assert.equal(points.at(-1), '600 6')

  const waiting = chartOf({ ...run('checking'), rate: undefined, samples: [] })
  assert.equal(waiting.caption, 'Counts arrive once a minute')
  assert.equal(waiting.aria, 'TLC sends its counts once a minute, and none has come yet.')
})

test('the result says what was found, and its first button steps through a counterexample', () => {
  assert.deepEqual(resultOf(run('checking')), {
    tone: 'quiet',
    icon: 'clock',
    title: 'Nothing broken yet',
    line: '61,950 states looked at, 3,112 still waiting. You can leave: hobkin keeps checking and tells you what it finds.',
    primary: { label: 'Watch the graph grow', strong: false },
  })
  const broken = resultOf(run('broken'))
  assert.deepEqual([broken.tone, broken.title, broken.primary], ['bad', 'MergedAtReviewedHead breaks after 5 steps', { label: 'Step through it', strong: true }])
  assert.equal(broken.line, 'It should be that nothing merges by itself past the head its review saw. TLC found the shortest way to break it.')
  const holds = resultOf(run('holds'))
  assert.deepEqual([holds.tone, holds.title], ['ok', 'Holds in every state this model can reach'])
  assert.equal(holds.line, '2 items, up to 3 pushes each, rate 8. That is a check of this size, not a proof for every size: the Proof step does that.')
  assert.equal(resultOf(run('proved')).title, 'Holds, and is proved for every size')
  assert.equal(resultOf(run('broken', { outcome: 'error', message: 'Java 11 or newer is needed.' })).line, 'Java 11 or newer is needed.')
})

test('a model that holds while an action never fired is not evidence, and says which action', () => {
  const missed = run('holds', { actions: run('holds').actions.map((action) => (action.name === 'Decline' ? { ...action, count: 0 } : action)) })
  assert.deepEqual(phaseOf(missed), { label: 'Holds, but Decline never ran', tone: 'warn' })
  const result = resultOf(missed)
  assert.deepEqual([result.tone, result.title], ['warn', 'Holds, but Decline never ran'])
  assert.match(result.line, /this run is not evidence/)
  assert.deepEqual(coverageNote(missed), { text: 'Decline never ran. The model cannot reach it, so nothing it guards was checked, and this run is not evidence.', tone: 'warn' })

  assert.deepEqual(coverageNote(run('checking')), { text: 'Decline has not run yet. If it never does, the model cannot reach it, and nothing it guards is checked.', tone: 'warn' })
  assert.equal(coverageNote(run('holds')).tone, 'quiet')
  const two = run('checking', { actions: [{ name: 'Fix', count: 0 }, { name: 'Decline', count: 0 }] })
  assert.match(coverageNote(two).text, /^Fix and Decline have not run yet\. If they never do/)
})

test('each rule says how it stands in words a person reads', () => {
  assert.deepEqual(ruleRows(run('checking')).map(({ status, tone }) => [status, tone]), [['Holding so far', 'live'], ['Holding so far', 'live'], ['Holding so far', 'live'], ['Checked at the end', 'quiet']])
  assert.deepEqual(ruleRows(run('broken')).map(({ status, marked }) => [status, marked]), [['Holding', false], ['Broken', true], ['Not reached', false], ['Not reached', false]])
  assert.deepEqual(ruleRows(run('holds')).map(({ status }) => status), ['Holds', 'Holds', 'Holds', 'Holds'])
})

test('which actions ran: bars against the busiest, the breaking action marked and one that never fired empty', () => {
  const rows = actionRows(run('broken'))

  assert.deepEqual(
    rows.map(({ name, width, tone }) => [name, width, tone]),
    [
      ['Start', 100, 'text'],
      ['Finish', 92, 'text'],
      ['Review', 60, 'text'],
      ['Fix', 37, 'text'],
      ['YoloMerge', 6, 'bad'],
      ['Decline', 0, 'none'],
    ],
  )
  assert.equal(rows[0]!.count, '4,906')
  // A sliver for one that fired at all, and no culprit while it checks.
  assert.equal(actionRows({ actions: [{ name: 'A', count: 10_000 }, { name: 'B', count: 1 }], outcome: 'checking' })[1]!.width, 3)
})

test('the log keeps the newest lines on the 24-hour clock, and the code map names each action\'s place', () => {
  const lines = Array.from({ length: 9 }, (_, index) => ({ at: new Date(STARTED + index * 60_000).toISOString(), text: `Line ${index}`, tone: 'done' as const }))
  const rows = logRows({ log: [...lines, { at: 'not a time', text: 'Checking', tone: 'running' }] }, 'UTC')
  assert.equal(rows.length, LOG_LINES)
  assert.deepEqual(rows.map(({ at, text, tone }) => [at, text, tone]).slice(-2), [['14:13', 'Line 8', 'done'], ['', 'Checking', 'live']])

  assert.deepEqual(codeRows(run('holds'))[4], { action: 'YoloMerge', where: 'src/cli/work/yolo-pass.mjs:165', file: 'yolo-pass.mjs:165' })
  assert.deepEqual(codeRows({ actions: [{ name: 'Tick', count: 3 }] }), [])
})
