import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { codemodeOf, codemodeText, codemodeWarning, codemodeWords } from '../src/features/agent-activity/codemode.ts'
import { exchangeOf, pauseOf, stepsOf, type Step } from '../src/features/agent-activity/steps.ts'

/**
 * A codemode script's tool calls belong to its block. Pi gives each call a script makes its own events with the
 * script's call id (`parentToolCallId`), and hobkin keeps it as the entry's `parent`.
 */

const script = (state: ActivityEntry['state'] = 'completed', extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'tool:script',
  kind: 'tool',
  name: 'codemode',
  state,
  input: '{"code":"await Promise.all(files.map(path => tools.read({ path })))"}',
  output: 'Script completed',
  at: 1,
  ...extra,
})

const TOOLS = [
  { name: 'read', input: (n: number) => ({ path: `/repo/src/f${n}.ts` }) },
  { name: 'bash', input: (n: number) => ({ command: `echo ${n}` }) },
  { name: 'grep', input: (n: number) => ({ pattern: `p${n}`, path: '/repo/src' }) },
  { name: 'edit', input: (n: number) => ({ path: `/repo/src/f${n}.ts`, oldText: 'a', newText: 'b' }) },
  { name: 'lint', input: (n: number) => ({ file: `f${n}.ts` }) },
]

/** The script's call `n` (from 1), as Pi numbers a nested call: `<script call id>/<n>`. */
function inner(n: number, state: ActivityEntry['state'] = 'completed', parent = 'tool:script'): ActivityEntry {
  const tool = TOOLS[(n - 1) % TOOLS.length]!
  return { id: `tool:script/${n}`, kind: 'tool', name: tool.name, state, input: JSON.stringify(tool.input(n)), output: state === 'failed' ? 'Command exited with code 1' : `out ${n}`, parent, at: 1 + n }
}

const twenty = Array.from({ length: 20 }, (_, index) => inner(index + 1, index === 6 ? 'failed' : 'completed'))
const later: ActivityEntry = { id: 'tool:later', kind: 'tool', name: 'bash', state: 'completed', input: '{"command":"ls"}', output: '', at: 40 }

const codemode = (steps: readonly Step[]) => {
  const step = steps.find((candidate) => candidate.kind === 'codemode')
  assert.ok(step?.kind === 'codemode')
  return step
}

test("a script's twenty tool calls are its block's, in order, each the step it makes on its own, and none follows it", () => {
  const steps = stepsOf([script(), ...twenty, later], { cwd: '/repo' })

  assert.deepEqual(steps.map((step) => step.kind), ['codemode', 'shell'])
  const block = codemode(steps)
  assert.deepEqual(block.calls.map((call) => call.key), twenty.map((entry) => entry.id))
  assert.deepEqual(block.calls.slice(0, 5).map((call) => call.kind), ['looks', 'shell', 'looks', 'change', 'tool'])
  const failed = block.calls[6]!
  assert.ok(failed.kind === 'shell' && failed.commands[0]!.state === 'failed', 'the failed call is drawn failed')
  assert.equal(steps[1]!.key, 'tool:later')
})

test("the block counts its script's tool calls and the ones that failed", () => {
  const model = codemodeOf(script(), false, twenty)
  const words = codemodeWords(model)

  assert.equal(codemodeText(words), '20 tool calls, 1 failed: bash · 4 read, 4 bash, 4 grep, 4 edit, 4 lint')
  assert.equal(codemodeWarning(model), 'The script finished. Of its 20 tool calls, 1 failed.')
})

test('while the script runs, the count grows with each call that arrives', () => {
  const running = [inner(1), inner(2, 'running')]
  assert.equal(codemodeText(codemodeWords(codemodeOf(script('running'), false, running))), '2 tool calls so far · read, bash')
  assert.equal(codemodeText(codemodeWords(codemodeOf(script('running'), false, [...running, inner(3, 'running')]))), '3 tool calls so far · read, bash, grep')

  const block = codemode(stepsOf([script('running'), ...running]))
  assert.equal(block.state, 'running')
  assert.equal(block.calls.length, 2)
})

test("a call still running when the script ended did not finish, and one the script's report says was cancelled is counted so", () => {
  const stopped = codemodeOf(script('running'), true, [inner(1), inner(2, 'running')])
  assert.equal(codemodeText(codemodeWords(stopped)), 'stopped · 2 tool calls, 1 did not finish · read, bash')

  const reported = script('completed', { codemode: { calls: [{ id: 'script/1', name: 'read', args: '', status: 'ok' }, { id: 'script/2', name: 'bash', args: '', status: 'cancelled' }] } })
  assert.equal(codemodeText(codemodeWords(codemodeOf(reported, false, [inner(1), inner(2, 'failed')]))), '2 tool calls, 1 did not finish · read, bash')
})

test("the script's report lists only what has no step of its own: a model call, never a tool call still starting", () => {
  const calls = [
    { id: 'script/1', name: 'read', args: '{"path":"a"}', status: 'ok' as const },
    { id: 'script/classify/1', name: 'classify', args: 'is it a bug?', status: 'ok' as const },
    { id: 'script/?', name: 'bash', args: '{"command":"ls"}', status: 'running' as const },
  ]
  const model = codemodeOf(script('running', { codemode: { calls } }), false, [inner(1)])

  assert.deepEqual(model.listed?.map((call) => call.name), ['classify'])
  assert.equal(codemodeText(codemodeWords(model)), '2 tool calls so far · read, classify')
})

test('with no call of its own in the feed, the block counts and lists what the script reported, as before', () => {
  const calls = [{ id: 'script/1', name: 'read', args: '', status: 'ok' as const }, { id: 'script/2', name: 'bash', args: '', status: 'error' as const }]
  const model = codemodeOf(script('completed', { codemode: { calls } }))

  assert.deepEqual(model.listed?.map((call) => call.name), ['read', 'bash'])
  assert.equal(codemodeText(codemodeWords(model)), '2 tool calls, 1 failed: bash · read, bash')
  assert.deepEqual(codemode(stepsOf([script('completed', { codemode: { calls } })])).calls, [])
})

test('a call made inside a call of the script is the block\'s too, and a call another tool made, or whose script is gone, is a step of its own', () => {
  const deeper = inner(2, 'completed', 'tool:script/1')
  const block = codemode(stepsOf([script(), inner(1), deeper]))
  assert.deepEqual(block.calls.map((call) => call.key), ['tool:script/1', 'tool:script/2'])

  const other: ActivityEntry = { id: 'tool:agent', kind: 'tool', name: 'subagent', state: 'completed', input: '{}', output: '' }
  const byOther = { ...inner(1), parent: 'tool:agent' }
  assert.deepEqual(stepsOf([other, byOther]).map((step) => step.key), ['tool:agent', 'tool:script/1'])
  assert.deepEqual(stepsOf([inner(1), inner(2)]).map((step) => step.kind), ['looks', 'shell'], 'a script the feed let go leaves its calls as steps')
})

test("a message the user sent while the script ran goes after its block, and the script's calls stay in it", () => {
  const items = exchangeOf([script('completed', { at: 1 }), { ...inner(1), at: 3 }, { ...inner(2), at: 4 }, { ...later, at: 5 }], [{ id: 'n', text: 'also check the tests', at: 2 }], { seenAt: () => undefined })

  assert.deepEqual(items.map((item) => item.kind), ['codemode', 'note', 'shell'])
  assert.equal(codemode(items.filter((item): item is Step => item.kind !== 'note')).calls.length, 2)
})

test('between two of its calls the agent is not thinking: its script still runs', () => {
  assert.equal(pauseOf([script('running'), inner(1)]), null)
  assert.equal(pauseOf([script('completed'), inner(1)]), 'thinking')
})

test("a new call builds only its own step: the block's earlier calls are the objects they were", () => {
  const running = script('running')
  const first = codemode(stepsOf([running, ...twenty.slice(0, 5)]))
  const next = codemode(stepsOf([running, ...twenty.slice(0, 6)]))
  assert.notEqual(first, next)
  assert.ok(first.calls.every((call, index) => call === next.calls[index]))
  assert.equal(codemode(stepsOf([running, ...twenty.slice(0, 6)])), next, 'nothing new is the same block')
})
