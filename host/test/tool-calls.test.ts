import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import type { ToolCall } from '../src/integration-contract.ts'
import { ToolCallWatcher } from '../src/tool-calls.ts'

const watching = (options?: ConstructorParameters<typeof ToolCallWatcher>[1]) => {
  const calls: ToolCall[] = []
  return { calls, watcher: new ToolCallWatcher((call) => calls.push(call), options) }
}
const tool = (id: string, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({ id: `tool:${id}`, kind: 'tool', name: 'bash', input: '{"command":"ls"}', state: 'running', ...extra })

test('a main conversation call is given as it starts and as it ends, with its arguments and result', () => {
  const { calls, watcher } = watching()
  watcher.event({ type: 'message_start' })
  watcher.event({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'client', args: { action: 'list' } })
  watcher.event({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'client', args: { action: 'list' } })
  watcher.event({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'client', result: { content: [{ type: 'text', text: 'one' }, { type: 'text', text: 'two' }] }, isError: false })
  assert.deepEqual(calls, [
    { agent: '#main', id: 'c1', name: 'client', args: { action: 'list' }, state: 'running' },
    { agent: '#main', id: 'c1', name: 'client', args: undefined, state: 'completed', output: 'one\ntwo' },
  ])
})

test('a main conversation call that fails says so, and one first seen ending gives only its end', () => {
  const { calls, watcher } = watching()
  watcher.event({ type: 'tool_execution_end', toolCallId: 'c2', toolName: 'bash', result: 'no such file', isError: true })
  assert.deepEqual(calls, [{ agent: '#main', id: 'c2', name: 'bash', args: undefined, state: 'failed', output: 'no such file' }])
})

test("a run's call is given once as it starts and once as it ends, however often the feed is looked at", () => {
  const { calls, watcher } = watching()
  watcher.activity({ 'run-1': [tool('a')] })
  watcher.activity({ 'run-1': [tool('a')] })
  watcher.activity({ 'run-1': [tool('a', { state: 'completed', output: 'done' })] })
  watcher.activity({ 'run-1': [tool('a', { state: 'completed', output: 'done' })] })
  assert.deepEqual(calls, [
    { agent: 'run-1', id: 'a', name: 'bash', args: '{"command":"ls"}', state: 'running' },
    { agent: 'run-1', id: 'a', name: 'bash', args: '{"command":"ls"}', state: 'completed', output: 'done' },
  ])
})

test("a run's call first seen already ended gives only its end, a failed one says so, and the words are no call", () => {
  const { calls, watcher } = watching()
  watcher.activity({ 'run-2': [{ id: 'message:1:0', kind: 'assistant', text: 'hi' }, tool('b', { state: 'failed', output: 'boom' })] })
  assert.deepEqual(calls, [{ agent: 'run-2', id: 'b', name: 'bash', args: '{"command":"ls"}', state: 'failed', output: 'boom' }])
})

test("the main chat's own feed is not heard twice, and no feed at all is quiet", () => {
  const { calls, watcher } = watching()
  watcher.activity({ '#main': [tool('m')] })
  watcher.activity(undefined)
  assert.deepEqual(calls, [])
})

test('looking at the past on the first look gives the calls still running and not those that ended', () => {
  const { calls, watcher } = watching({ skipFirstLook: true })
  watcher.activity({ 'run-3': [tool('old', { state: 'completed' }), tool('live')] })
  watcher.activity({ 'run-3': [tool('old', { state: 'completed' }), tool('live', { state: 'completed' }), tool('new')] })
  assert.deepEqual(calls.map(({ id, state }) => `${id}:${state}`), ['live:running', 'live:completed', 'new:running'])
})
