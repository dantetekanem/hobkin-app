import assert from 'node:assert/strict'
import { test } from 'node:test'
import { turnKind, turnTiming, type TimingStart } from '../src/claude-code/timing.ts'

const RUN_ID = '0b7e4f2a-3c5d-4e6f-8a9b-1c2d3e4f5a6b'
const SESSION = '5d1c8e0a-7b2f-4c3d-9e4a-6f5b8a7c9d01'
const MODEL = 'claude-sonnet-4-5'
// The harness's entry, on the wall clock and on the monotonic one.
const WALL = 1_763_100_000_000
const START = 500

type Line = Record<string, unknown>

/** A tracker on a clock that moves only when told. */
function tracker(start: Partial<TimingStart> = {}) {
  let clock = START
  const timing = turnTiming({ runId: RUN_ID, purpose: 'work-do', model: 'sonnet', effort: 'low', ...start }, () => clock, () => WALL)
  const after = (ms: number) => (clock += ms)
  /** Each record arrives the given ms after the one before. */
  const feed = (...steps: [number, Line][]) => {
    for (const [ms, record] of steps) {
      after(ms)
      timing.observe(record)
    }
  }
  return { timing, after, feed }
}

const usage = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite })
const init = { type: 'system', subtype: 'init', session_id: SESSION, model: MODEL, tools: ['Bash'], parent_tool_use_id: null }
const stream = (event: Line) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: SESSION })
const messageStart = (id: string, used: Line) => stream({ type: 'message_start', message: { id, role: 'assistant', model: MODEL, content: [], usage: used } })
const blockStart = (index: number, type: string) => stream({ type: 'content_block_start', index, content_block: { type } })
const thinking = (index: number, words: string) => stream({ type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: words } })
const said = (index: number, words: string) => stream({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: words } })
const toolInput = (index: number, json: string) => stream({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: json } })
const messageDelta = (used: Line) => stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: used })
const messageStop = stream({ type: 'message_stop' })
const assistant = (id: string, block: Line, used?: Line) => ({ type: 'assistant', message: { id, role: 'assistant', model: MODEL, content: [block], ...(used ? { usage: used } : {}) }, parent_tool_use_id: null, session_id: SESSION })
const toolResult = { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12 passing' }] }, parent_tool_use_id: null, session_id: SESSION }
const result = (more: Line = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: 'Hello there.', session_id: SESSION, duration_ms: 2900, duration_api_ms: 2500, total_cost_usd: 0.0123, ...more })

test('a turn that thinks and then writes: every stage, its one response and what it spent', () => {
  const { timing, after, feed } = tracker()
  after(5)
  timing.spawned(SESSION)
  after(2)
  timing.prompted()
  feed(
    [900, init],
    [1100, messageStart('msg_1', usage(12, 1, 3000, 40))],
    [10, blockStart(0, 'thinking')],
    [290, thinking(0, 'The user wants a greeting.')],
    [400, assistant('msg_1', { type: 'thinking', thinking: 'The user wants a greeting.' }, usage(12, 1, 3000, 40))],
    [10, blockStart(1, 'text')],
    [5, said(1, '')],
    [15, said(1, 'Hello')],
    [100, assistant('msg_1', { type: 'text', text: 'Hello there.' }, usage(12, 1, 3000, 40))],
    [5, messageDelta({ output_tokens: 120 })],
    [3, messageStop],
    [10, result()],
  )
  after(40)
  const facts = timing.facts()

  assert.deepEqual(facts, {
    schemaVersion: 1,
    runId: RUN_ID,
    sessionId: SESSION,
    responses: 1,
    incomplete: false,
    firstObservedOutputMs: 2300,
    dispatchElapsedMs: 2888,
    input: { value: 12, state: 'complete' },
    output: { value: 120, state: 'complete' },
    cacheRead: { value: 3000, state: 'complete' },
    cacheWrite: { value: 40, state: 'complete' },
    estimatedUsd: { value: 0.0123, state: 'complete' },
    responseDurationMs: { value: 2500, state: 'complete' },
    kind: 'work',
    engine: 'claude',
    model: MODEL,
    effort: 'low',
    origin: 'run',
    stages: { spawned: 5, prompted: 7, ready: 907, requested: 2007, thinking: 2307, text: 2737, ended: 2895 },
    steps: [{ at: 2007, first: 2307, text: 2737, end: 2845, input: 12, cacheRead: 3000, output: 120 }],
  })
  assert.doesNotMatch(JSON.stringify(facts), /greeting|Hello/, 'nothing the model wrote')
})

test('a turn that calls a tool first: the tool stage, then the text of a second response', () => {
  const { timing, after, feed } = tracker({ purpose: 'durable' })
  timing.spawned(SESSION)
  after(1)
  timing.prompted()
  feed(
    [700, init],
    [800, messageStart('msg_1', usage(30, 2))],
    [10, blockStart(0, 'tool_use')],
    [90, toolInput(0, '{"command":')],
    [50, assistant('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }, usage(30, 2))],
    [5, messageDelta({ output_tokens: 25 })],
    [5, messageStop],
    [2000, toolResult],
    [600, messageStart('msg_2', usage(60, 1, 30))],
    [400, said(0, 'Fixed.')],
    [50, assistant('msg_2', { type: 'text', text: 'Fixed.' }, usage(60, 1, 30))],
    [5, messageDelta({ output_tokens: 9 })],
    [5, messageStop],
    [5, result({ total_cost_usd: 0.002, duration_api_ms: 1900 })],
  )
  const facts = timing.facts()!

  assert.equal(facts.kind, 'durable')
  assert.equal(facts.firstObservedOutputMs, 1600, 'the first tool input is the first output')
  assert.deepEqual(facts.stages, { spawned: 0, prompted: 1, ready: 701, requested: 1501, tool: 1601, text: 4661, ended: 4726 })
  assert.deepEqual(facts.steps, [
    { at: 1501, first: 1601, text: null, end: 1661, input: 30, cacheRead: 0, output: 25 },
    { at: 4261, first: 4661, text: 4661, end: 4721, input: 60, cacheRead: 30, output: 9 },
  ])
  assert.deepEqual([facts.responses, facts.input, facts.output], [2, { value: 90, state: 'complete' }, { value: 34, state: 'complete' }])
})

test('a response that arrives more than once counts once', () => {
  // Without partial messages Claude prints one assistant record per content block, each with the same id and usage.
  const { timing, after, feed } = tracker()
  timing.spawned(SESSION)
  timing.prompted()
  feed(
    [100, init],
    [100, assistant('msg_1', { type: 'thinking', thinking: 'Hmm.' }, usage(10, 4, 100))],
    [10, assistant('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Read', input: {} }, usage(10, 4, 100))],
    [500, toolResult],
    [300, assistant('msg_2', { type: 'text', text: 'Done.' }, usage(20, 6, 110))],
    [10, result()],
  )
  after(10)
  const facts = timing.facts()!
  assert.equal(facts.responses, 2)
  assert.deepEqual([facts.input, facts.output, facts.cacheRead], [{ value: 30, state: 'complete' }, { value: 10, state: 'complete' }, { value: 210, state: 'complete' }])
  assert.deepEqual(facts.steps.map((step) => [step.at, step.first, step.end]), [[null, null, 210], [null, null, 1010]], 'with no stream events only the ends are known')
  assert.equal(facts.firstObservedOutputMs, null)
  assert.equal(facts.stages.requested, undefined, 'a moment that never came is left out')
})

test('a stream cut before its result is incomplete, and says what it did see', () => {
  const { timing, after, feed } = tracker()
  timing.spawned(SESSION)
  timing.prompted()
  feed([300, init], [400, messageStart('msg_1', usage(12, 1))], [200, said(0, 'Hel')])
  after(50)
  const facts = timing.facts()!
  assert.equal(facts.incomplete, true)
  assert.deepEqual([facts.input, facts.estimatedUsd, facts.responseDurationMs], [
    { value: 12, state: 'partial' },
    { value: null, state: 'unavailable' },
    { value: null, state: 'unavailable' },
  ])
  assert.deepEqual(facts.stages, { spawned: 0, prompted: 0, ready: 300, requested: 700, text: 900, ended: 950 })
  assert.deepEqual(facts.steps, [{ at: 700, first: 900, text: 900, end: null, input: 12, cacheRead: 0, output: 1 }])

  // A response that never said what it used leaves the counts partial, even with a result.
  const quiet = tracker()
  quiet.timing.spawned(SESSION)
  quiet.feed([10, init], [10, assistant('msg_1', { type: 'text', text: 'Hi.' })], [10, assistant('msg_2', { type: 'text', text: 'Hi.' }, usage(3, 4))], [10, result()])
  const counted = quiet.timing.facts()!
  assert.equal(counted.incomplete, true)
  assert.deepEqual(counted.input, { value: 3, state: 'partial' })
  assert.deepEqual(counted.estimatedUsd, { value: 0.0123, state: 'complete' }, "the result's own totals still stand")
})

test("the runtime's start of the turn and its marks come first", () => {
  const { timing, after } = tracker({
    turn: { since: WALL - 1200, origin: 'window', kind: 'main', marks: { host: WALL - 1000, admitted: WALL - 200 } },
  })
  after(5)
  timing.spawned(SESSION)
  after(3)
  timing.prompted()
  const facts = timing.facts()!
  assert.deepEqual([facts.origin, facts.kind], ['window', 'main'])
  assert.deepEqual(facts.stages, { host: 200, admitted: 1000, spawned: 1205, prompted: 1208, ended: 1208 })
  assert.equal(facts.dispatchElapsedMs, 0)

  // A start that is no time is the harness's own, and a mark that is no time, or comes before the start, is left out.
  const odd = tracker({ turn: { since: Number.NaN, origin: 'window', marks: { host: Number.POSITIVE_INFINITY, admitted: WALL - 50 } } })
  odd.timing.spawned(SESSION)
  const fallback = odd.timing.facts()!
  assert.deepEqual([fallback.origin, fallback.stages], ['run', { spawned: 0, ended: 0 }])
  const unknown = tracker({ turn: { since: WALL, origin: 'elsewhere' as 'run' } })
  unknown.timing.spawned(SESSION)
  assert.equal(unknown.timing.facts()!.origin, 'run')
})

test('with no turn given, the harness entry starts it and the request names its kind', () => {
  const { timing, after } = tracker({ turn: undefined, model: null, effort: null })
  after(12)
  timing.spawned('a-session')
  const facts = timing.facts()!
  assert.deepEqual([facts.origin, facts.stages, facts.sessionId, facts.model, facts.effort], ['run', { spawned: 12, ended: 12 }, 'a-session', null, null])
  assert.deepEqual([facts.incomplete, facts.responses, facts.steps, facts.firstObservedOutputMs, facts.dispatchElapsedMs], [true, 0, [], null, null])

  assert.equal(turnKind({ purpose: 'durable' }), 'durable')
  assert.equal(turnKind({ purpose: 'work-look' }), 'work')
  assert.equal(turnKind({ scheduleId: 'session.a1b2' }), 'session')
  assert.equal(turnKind({ scheduleId: 'daily-notes' }), 'routine')
  assert.equal(turnKind({ purpose: 'reflection' }), 'other')
  assert.equal(turnKind({}), 'other')
})

test('a process that never started has no timings', () => {
  const { timing } = tracker()
  timing.observe(init)
  assert.equal(timing.facts(), null)
})

test("Claude's own subagents are left out, at most 24 steps are kept, and nothing it is fed can throw", () => {
  const { timing, feed } = tracker()
  timing.spawned(SESSION)
  timing.prompted()
  const nested = (record: Line) => ({ ...record, parent_tool_use_id: 'toolu_agent' })
  feed([10, init], [10, nested(messageStart('sub_1', usage(1, 1)))], [10, nested(said(0, 'inner'))], [10, nested(assistant('sub_1', { type: 'text', text: 'inner' }, usage(1, 1)))])
  for (let index = 0; index < 30; index++) feed([10, assistant(`msg_${index}`, { type: 'text', text: '.' }, usage(1, 1))])
  feed([10, result()])
  const facts = timing.facts()!
  assert.equal(facts.responses, 30)
  assert.equal(facts.steps.length, 24)
  assert.equal(facts.input.value, 30)
  assert.equal(facts.stages.text, undefined)

  for (const odd of [{ type: 'stream_event', event: { type: 'content_block_delta', delta: null } }, { type: 'assistant', message: { id: 7, usage: 'none' } }, { type: 'system', subtype: 'init', session_id: { not: 'an id' } }]) {
    assert.doesNotThrow(() => timing.observe(odd))
  }
  const broken = turnTiming({ runId: RUN_ID }, () => {
    throw Error('no clock')
  })
  assert.doesNotThrow(() => {
    broken.spawned(SESSION)
    broken.observe(init)
  })
})
