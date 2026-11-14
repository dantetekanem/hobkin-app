import assert from 'node:assert/strict'
import { test } from 'node:test'
import { firstWordTable, summarizeFirstWord } from '../src/first-word.ts'

const performance = (runId: string, facts: Record<string, unknown>) => ({ type: 'run_performance', at: '2026-11-14T10:00:00.000Z', runId, ...facts })
const main = (runId: string, stages: Record<string, number>, extra: Record<string, unknown> = {}) =>
  performance(runId, { kind: 'main', engine: 'pi', model: 'openai/gpt-x', origin: 'window', stages, ...extra })

test('turns of one kind, engine and model make one row, with where the time went before the first text', () => {
  const summary = summarizeFirstWord([
    main('a', { host: 5, handed: 20, admitted: 60, prompted: 100, started: 150, requested: 400, thinking: 900, text: 2400, ended: 5000 },
      { steps: [{ at: 400, first: 900, text: 2400, end: 2600, input: 300000, cacheRead: 0, output: 50 }] }),
    main('b', { host: 5, handed: 10, admitted: 30, prompted: 200, requested: 300, text: 1300, ended: 2000 },
      { steps: [{ at: 300, first: 1300, text: 1300, end: 1500, input: 900, cacheRead: 300000, output: 50 }] }),
    { type: 'turn_shown', at: '2026-11-14T10:00:03.000Z', id: 'a', arrivedMs: 2450, shownMs: 3900 },
    { type: 'turn_started', at: '2026-11-14T09:00:00.000Z', id: 'a' },
  ])
  assert.equal(summary.timed, 2)
  assert.equal(summary.untimed, 0)
  assert.equal(summary.rows.length, 1)
  const [row] = summary.rows
  assert.deepEqual([row!.kind, row!.engine, row!.model, row!.turns], ['main', 'pi', 'openai/gpt-x', 2])
  // Median and 90th percentile of two turns are the lower and the higher one.
  assert.deepEqual(row!.wait, { median: 100, p90: 200, count: 2 })
  assert.deepEqual(row!.request, { median: 100, p90: 300, count: 2 })
  assert.deepEqual(row!.think, { median: 1000, p90: 2000, count: 2 })
  assert.deepEqual(row!.text, { median: 1300, p90: 2400, count: 2 })
  assert.equal(row!.boot, null)
  assert.deepEqual(row!.arrived, { median: 2450, p90: 2450, count: 1 })
  assert.deepEqual(row!.shown, { median: 3900, p90: 3900, count: 1 })
  // The delay the window added after the text reached hobkin, for the one turn that has both.
  assert.deepEqual(row!.afterText, { median: 1500, p90: 1500, count: 1 })
  // One of the two turns re-sent nearly all of its prompt uncached.
  assert.deepEqual(row!.uncached, { turns: 1, of: 2 })
})

test('a turn that starts a process counts its start in the wait, on either engine', () => {
  const summary = summarizeFirstWord([
    performance('pi', { kind: 'durable', engine: 'pi', model: 'openai/gpt-x', origin: 'window',
      stages: { host: 4, admitted: 30, resolved: 400, spawned: 420, ready: 1900, prompted: 1905, requested: 2300, text: 4000, ended: 9000 } }),
    // Claude Code is handed the prompt as it starts, and is ready only once it has loaded its settings.
    performance('claude', { kind: 'durable', engine: 'claude', model: 'claude-sonnet', origin: 'window',
      stages: { host: 4, admitted: 30, spawned: 50, prompted: 51, ready: 3051, requested: 3500, text: 5000, ended: 9000 } }),
    performance('helper', { kind: 'helper', engine: 'pi', model: 'openai/gpt-x', origin: 'tool',
      stages: { spawned: 2, ready: 1500, prompted: 1500, ended: 4000 } }),
  ])
  const rows = Object.fromEntries(summary.rows.map((row) => [`${row.kind}/${row.engine}`, row]))
  assert.deepEqual(Object.keys(rows), ['durable/pi', 'durable/claude', 'helper/pi'])
  assert.equal(rows['durable/pi']!.wait!.median, 1905)
  assert.equal(rows['durable/pi']!.boot!.median, 1480)
  assert.equal(rows['durable/claude']!.wait!.median, 3051)
  assert.equal(rows['durable/claude']!.boot!.median, 3001)
  assert.equal(rows['durable/claude']!.request!.median, 449)
  // A turn that never wrote text still counts, with nothing in the columns it never reached.
  assert.deepEqual([rows['helper/pi']!.turns, rows['helper/pi']!.text, rows['helper/pi']!.wait!.median], [1, null, 1500])
})

test('older events with no stages are counted apart, and anything that is not a timing is ignored', () => {
  const summary = summarizeFirstWord([
    performance('old', { firstObservedOutputMs: 4000, dispatchElapsedMs: 9000 }),
    performance('older', { firstObservedOutputMs: 2000, dispatchElapsedMs: 3000 }),
    performance('bad', { kind: 'main', engine: 'pi', stages: { prompted: 'soon', text: -5 } }),
    null,
    'no',
    { type: 'run_performance' },
  ])
  assert.deepEqual([summary.timed, summary.untimed, summary.rows.length], [0, 4, 0])
  assert.deepEqual(summary.untimedFirstOutput, { median: 2000, p90: 4000, count: 2 })
})

test('the table says seconds, and a dash where nothing was measured', () => {
  const text = firstWordTable(summarizeFirstWord([
    main('a', { prompted: 100, requested: 400, text: 2400, ended: 5000 }),
  ]))
  const [head, row] = text.split('\n').filter((line) => line.includes('main') || line.includes('kind'))
  assert.match(head!, /kind\s+engine\s+model\s+turns\s+wait\s+start\s+request\s+think\s+first text\s+shown\s+after text\s+uncached/)
  assert.match(row!, /main\s+pi\s+openai\/gpt-x\s+1\s+0\.1 · 0\.1\s+–\s+0\.3 · 0\.3\s+2\.0 · 2\.0\s+2\.4 · 2\.4\s+–\s+–\s+–/)
  assert.match(firstWordTable(summarizeFirstWord([])), /No turn with stage timings/)
})

test('an uncached main turn names which part of the system prompt changed since the turn before', () => {
  const stages = { prompted: 100, requested: 300, text: 1300, ended: 2000 }
  const cached = [{ at: 300, first: 1300, text: 1300, end: 1500, input: 900, cacheRead: 300000, output: 5 }]
  const uncached = [{ ...cached[0], input: 300000, cacheRead: 0 }]
  const prompt = (id: string, memory: string, decided: string) =>
    ({ type: 'turn_prompt', at: '2026-11-14T10:00:00.000Z', id, parts: { memory, decided, directions: 'same', persona: 'same' } })
  const summary = summarizeFirstWord([
    main('a', stages, { steps: cached }), prompt('a', 'm1', 'd1'),
    main('b', stages, { steps: uncached }), prompt('b', 'm1', 'd2'),
    main('c', stages, { steps: uncached }), prompt('c', 'm2', 'd3'),
    main('d', stages, { steps: uncached }), prompt('d', 'm2', 'd3'),
    main('e', stages, { steps: cached }), prompt('e', 'm2', 'd4'),
    // A turn with no hashes, or right after one, cannot be judged.
    main('f', stages, { steps: uncached }),
    main('g', stages, { steps: uncached }), prompt('g', 'm9', 'd9'),
  ])
  assert.deepEqual(summary.uncachedAfter, { turns: 3, parts: { decided: 2, memory: 1 }, nothing: 1 })
  assert.match(firstWordTable(summary), /3 uncached main turns.*decided 2, memory 1.*nothing changed 1/s)
  assert.equal(summarizeFirstWord([main('a', stages)]).uncachedAfter, null)
})
