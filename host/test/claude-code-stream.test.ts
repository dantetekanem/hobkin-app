import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JobActivity } from 'hobkin/src/cli/job-activity.mjs'
import type { ActivityEntry } from '#shared/protocol/activity.ts'
import { stepsOf } from '../../ui/src/features/agent-activity/steps.ts'
import { ClaudeStream } from '../src/claude-code/stream.ts'

// Records as `claude -p --output-format stream-json --verbose --include-partial-messages --replay-user-messages` prints them.
const SESSION = '5f3b8c2e-7a1d-4e6f-9b2a-1c3d5e7f9a0b'
const MODEL = 'claude-opus-4-5'
const init = { type: 'system', subtype: 'init', cwd: '/work', session_id: SESSION, model: MODEL, tools: ['Bash', 'Edit', 'Read', 'Agent'], permissionMode: 'default' }
const usage = (input: number, output: number, cacheWrite = 0, cacheRead = 0) => ({ input_tokens: input, output_tokens: output, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead })
const streamed = (event: Record<string, unknown>) => ({ type: 'stream_event', event, parent_tool_use_id: null, session_id: SESSION })
const assistant = (id: string, block: Record<string, unknown>, used = usage(10, 1), parent: string | null = null) => ({
  type: 'assistant',
  message: { id, type: 'message', role: 'assistant', model: MODEL, content: [block], stop_reason: null, usage: used },
  parent_tool_use_id: parent,
  session_id: SESSION,
})
const toolResult = (id: string, content: unknown, isError = false, parent: string | null = null) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  parent_tool_use_id: parent,
  session_id: SESSION,
})
const replay = (text: string) => ({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] }, parent_tool_use_id: null, session_id: SESSION, isReplay: true })
const textBlock = (index: number, ...deltas: string[]) => [
  streamed({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }),
  ...deltas.map((text) => streamed({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } })),
]

test("Claude's stream becomes the activity a Pi run gives", () => {
  const stream = new ClaudeStream({ cwd: '/work' })
  const activity = new JobActivity()
  const events: Record<string, unknown>[] = []
  const feed = (...records: Record<string, unknown>[]) => {
    for (const record of records) {
      for (const event of stream.accept(record).events) {
        events.push(event)
        activity.accept(event)
      }
    }
  }
  const said = () => activity.snapshot().flatMap((entry) => (entry.kind === 'assistant' ? [entry.text] : []))

  feed(
    init,
    replay('Fix the build.'),
    streamed({ type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: usage(10, 1, 200) } }),
    streamed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    streamed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'A private plan.' } }),
    assistant('msg_1', { type: 'thinking', thinking: 'A private plan.', signature: 'signed' }),
    streamed({ type: 'content_block_stop', index: 0 }),
    ...textBlock(1, "I'll check ", 'the'),
  )
  assert.deepEqual(said(), ["I'll check the"], 'the words stream in as Claude writes them')

  feed(
    ...textBlock(1, ' build.').slice(1),
    assistant('msg_1', { type: 'text', text: "I'll check the build." }),
    streamed({ type: 'content_block_stop', index: 1 }),
    streamed({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } }),
    streamed({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":' } }),
    assistant('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm run build', description: 'Build the project' } }),
    streamed({ type: 'content_block_stop', index: 2 }),
    streamed({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 45 } }),
    streamed({ type: 'message_stop' }),
    toolResult('toolu_1', "Exit code 2\nsrc/a.ts(1,1): error TS2304: Cannot find name 'foo'.", true),

    // Claude's own subagent works under its Agent call. Only the call shows.
    assistant('msg_2', { type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { description: 'Find where foo went', prompt: 'Find foo.', subagent_type: 'Explore' } }),
    assistant('msg_sub', { type: 'text', text: 'Words inside the subagent.' }, usage(5000, 40), 'toolu_agent'),
    assistant('msg_sub', { type: 'tool_use', id: 'toolu_sub', name: 'Read', input: { file_path: '/work/src/b.ts' } }, usage(5000, 40), 'toolu_agent'),
    toolResult('toolu_sub', 'export const bar = 1', false, 'toolu_agent'),
    toolResult('toolu_agent', [{ type: 'text', text: 'foo is now bar, in src/b.ts.' }]),

    // A reply without stream events still draws.
    assistant('msg_3', { type: 'text', text: 'Fixing the import.' }),
    assistant('msg_3', { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/work/src/a.ts', old_string: 'foo', new_string: 'bar' } }),
    toolResult('toolu_2', 'The file /work/src/a.ts has been updated successfully.'),

    streamed({ type: 'message_start', message: { id: 'msg_4', model: MODEL, usage: usage(30, 1) } }),
    ...textBlock(0, 'Build '),
    // The user's message arrives while Claude writes. Its receipt waits until the words it interrupts are whole.
    replay('Also update the README.'),
    ...textBlock(0, 'fixed.').slice(1),
    assistant('msg_4', { type: 'text', text: 'Build fixed.' }),
    streamed({ type: 'content_block_stop', index: 0 }),
    { type: 'result', subtype: 'success', is_error: false, result: 'Build fixed.', total_cost_usd: 0.02, session_id: SESSION },
  )

  const entries = activity.snapshot() as ActivityEntry[]
  const tools = entries.filter((entry) => entry.kind === 'tool')
  assert.deepEqual(said(), ["I'll check the build.", 'Fixing the import.', 'Build fixed.'])
  assert.deepEqual(tools.map(({ name, state }) => [name, state]), [['Bash', 'failed'], ['Agent', 'completed'], ['Edit', 'completed']])
  assert.deepEqual(JSON.parse(tools[0]!.input!), { command: 'npm run build', description: 'Build the project' })
  assert.match(tools[0]!.output!, /Command exited with code 2$/)
  assert.deepEqual(JSON.parse(tools[2]!.input!), { file_path: '/work/src/a.ts', old_string: 'foo', new_string: 'bar' })
  const everything = JSON.stringify(entries)
  assert.doesNotMatch(everything, /A private plan/, 'thinking never shows')
  assert.doesNotMatch(everything, /Words inside the subagent|toolu_sub/, "the subagent's own work is not drawn")

  // The canvas reads it with the rules it reads a Pi run with.
  const steps = stepsOf(entries, { cwd: '/work', ended: true })
  assert.deepEqual(steps.map((step) => step.kind), ['says', 'shell', 'tool', 'says', 'change', 'says'])
  const [, shell, , , edit] = steps
  assert.ok(shell?.kind === 'shell' && edit?.kind === 'change')
  const { command, output, failure, exitCode } = shell.commands[0]!
  assert.deepEqual({ command, output, failure, exitCode }, {
    command: 'npm run build',
    output: "src/a.ts(1,1): error TS2304: Cannot find name 'foo'.",
    failure: 'Command exited with code 2',
    exitCode: 2,
  })
  assert.deepEqual({ path: edit.change.path, hunks: edit.change.hunks, state: edit.change.state }, { path: 'src/a.ts', hunks: [{ oldText: 'foo', newText: 'bar' }], state: 'done' })

  // hobkin's receipt for a message matches the exact text sent, with nothing else in the message.
  const receipts = events.flatMap((event, index) => {
    const message = event.message as { role?: string; content?: { type: string; text: string }[] } | undefined
    return event.type === 'message_end' && message?.role === 'user' ? [{ index, text: message.content!.map((part) => part.text).join('') }] : []
  })
  assert.deepEqual(receipts.map(({ text }) => text), ['Fix the build.', 'Also update the README.'])
  const lastWords = events.findLastIndex((event) => event.type === 'message_end' && (event.message as { role: string }).role === 'assistant')
  assert.ok(receipts[1]!.index > lastWords, 'the receipt follows the words it arrived in')
})

test("Claude's stream tells hobkin's pulse when the run works, each request, its thinking, its tool input and each reply's output", () => {
  const stream = new ClaudeStream({ cwd: '/work' })
  const events = (...records: Record<string, unknown>[]) => records.flatMap((record) => stream.accept(record).events)
  // Each event by what it is, as `pulse.mjs` reads it: its type, the part of a reply an update carries, whose message ends.
  const named = (list: Record<string, unknown>[]) => list.map((event) => {
    const part = event.assistantMessageEvent as { type: string } | undefined
    const message = event.message as { role: string } | undefined
    if (part) return `${event.type}:${part.type}`
    return event.type === 'message_end' ? `${event.type}:${message!.role}` : String(event.type)
  })
  const stop = streamed({ type: 'message_stop' })
  const result = { type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: SESSION }

  assert.deepEqual(events(init), [], 'Claude has not taken a message yet')
  const first = events(
    replay('Fix the build.'),
    streamed({ type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: usage(10, 1, 200) } }),
    streamed({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
    streamed({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'A private plan.' } }),
    assistant('msg_1', { type: 'thinking', thinking: 'A private plan.', signature: 'signed' }),
    streamed({ type: 'content_block_stop', index: 0 }),
    ...textBlock(1, "I'll check."),
    assistant('msg_1', { type: 'text', text: "I'll check." }),
    streamed({ type: 'content_block_stop', index: 1 }),
    streamed({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: {} } }),
    streamed({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":"npm test"}' } }),
    assistant('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }),
    streamed({ type: 'content_block_stop', index: 2 }),
    streamed({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 45 } }),
    stop,
    toolResult('toolu_1', 'All tests pass.'),
    streamed({ type: 'message_start', message: { id: 'msg_2', model: MODEL, usage: usage(20, 1) } }),
    ...textBlock(0, 'Done.'),
    assistant('msg_2', { type: 'text', text: 'Done.' }),
    streamed({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 3 } }),
    stop,
    result,
  )
  assert.deepEqual(named(first), [
    'agent_start', 'message_end:user',
    'message_update:thinking_start', 'message_update:thinking_delta',
    'message_start', 'message_update:text_delta', 'message_end:assistant',
    'message_update:toolcall_start', 'message_update:toolcall_delta', 'tool_execution_start',
    'turn_end',
    'tool_execution_end', 'turn_start',
    'message_start', 'message_update:text_delta', 'message_end:assistant',
    'turn_end',
    'agent_end',
  ])
  const parts = first.flatMap((event) => (event.assistantMessageEvent ? [event.assistantMessageEvent] : []))
  assert.deepEqual(parts.slice(0, 2), [{ type: 'thinking_start', contentIndex: 0 }, { type: 'thinking_delta', contentIndex: 0, delta: 'A private plan.' }])
  assert.deepEqual(parts.slice(3, 5), [{ type: 'toolcall_start', contentIndex: 2 }, { type: 'toolcall_delta', contentIndex: 2, delta: '{"command":"npm test"}' }])
  const outputs = first.filter((event) => event.type === 'turn_end').map((event) => event.message)
  assert.deepEqual(outputs, [{ role: 'assistant', usage: { output: 45 } }, { role: 'assistant', usage: { output: 3 } }], "each reply's whole output, as Claude counts it")

  // A reply that comes without a request marked before it, as after Claude retried one, marks its own.
  assert.deepEqual(named(events(
    replay('And the README.'),
    streamed({ type: 'message_start', message: { id: 'msg_3', model: MODEL, usage: usage(30, 1) } }),
    stop,
    streamed({ type: 'message_start', message: { id: 'msg_4', model: MODEL, usage: usage(30, 1) } }),
  )), ['agent_start', 'message_end:user', 'turn_end', 'turn_start'], 'a message queued for after the result starts the run again')
  assert.deepEqual(named(stream.end().events), ['agent_end'], 'a stream cut off ends the run')
  assert.deepEqual(stream.end().events, [], 'once')
})

test("each reply's usage goes in the session record once it is final, with what Claude counted elsewhere", () => {
  let clock = 0
  const stream = new ClaudeStream({ cwd: '/work', now: () => new Date(Date.UTC(2026, 10, 12, 9, 0, clock++)), newId: () => `line-${clock}` })
  const lines = (...records: Record<string, unknown>[]) => records.flatMap((record) => stream.accept(record).lines)
  const reply = (used: Record<string, number>) => ({ role: 'assistant', provider: 'anthropic', model: MODEL, usage: { ...used, cost: { total: 0 } }, stopReason: 'stop' })

  const [header] = lines(init)
  assert.deepEqual(header, { type: 'session', version: 3, id: SESSION, timestamp: '2026-11-12T09:00:00.000Z', cwd: '/work' })
  assert.equal(stream.sessionId, SESSION)
  assert.equal(stream.model, MODEL)

  // A reply's output is only final once it is over: Claude's message_delta carries it.
  assert.deepEqual(lines(
    streamed({ type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: usage(10, 1, 200) } }),
    assistant('msg_1', { type: 'text', text: 'Looking.' }, usage(10, 1, 200)),
    assistant('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/work/a.ts' } }, usage(10, 1, 200)),
    streamed({ type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 45 } }),
  ), [])
  const afterTool = lines(toolResult('toolu_1', 'one line'))
  assert.deepEqual(afterTool.map((line) => line.message), [
    reply({ input: 10, output: 45, cacheRead: 0, cacheWrite: 200, totalTokens: 255 }),
    { role: 'toolResult', toolCallId: 'toolu_1', toolName: 'Read', content: [], isError: false },
  ])
  assert.ok(afterTool.every((line) => line.type === 'message' && typeof line.id === 'string' && typeof line.timestamp === 'string'))

  // A subagent's tool results keep the record growing while it works. Its tokens come from Claude's own count at the end.
  assert.deepEqual(lines(
    assistant('msg_sub', { type: 'text', text: 'Inside.' }, usage(5000, 400), 'toolu_agent'),
    assistant('msg_sub', { type: 'tool_use', id: 'toolu_sub', name: 'Grep', input: { pattern: 'foo' } }, usage(5000, 400), 'toolu_agent'),
    toolResult('toolu_sub', 'found', false, 'toolu_agent'),
  ).map((line) => line.message), [{ role: 'toolResult', toolCallId: 'toolu_sub', toolName: 'Grep', content: [], isError: false }])

  const atResult = lines(
    assistant('msg_2', { type: 'text', text: 'Done.' }, usage(20, 30, 0, 200)),
    assistant('msg_2', { type: 'text', text: 'Done.' }, usage(20, 30, 0, 200)),
    {
      type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.05, session_id: SESSION,
      modelUsage: {
        [MODEL]: { inputTokens: 30, outputTokens: 75, cacheReadInputTokens: 200, cacheCreationInputTokens: 200, costUSD: 0.04 },
        'claude-haiku-4-5': { inputTokens: 5000, outputTokens: 400, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.01 },
      },
    },
  )
  assert.deepEqual(atResult.map((line) => line.message), [
    reply({ input: 20, output: 30, cacheRead: 200, cacheWrite: 0, totalTokens: 250 }),
    reply({ input: 5000, output: 400, cacheRead: 0, cacheWrite: 0, totalTokens: 5400 }),
  ])
  assert.equal(stream.tokens, 255 + 50 + 5400, 'fresh tokens: input, cache writes and output')
  assert.equal(stream.result?.result, 'Done.')
  assert.deepEqual(lines(assistant('msg_2', { type: 'text', text: 'Done.' }, usage(20, 30, 0, 200))), [], 'a reply already recorded is not counted twice')

  assert.deepEqual(stream.failed('Claude AI usage limit reached.')?.message, {
    role: 'assistant', provider: 'anthropic', model: MODEL,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } },
    stopReason: 'error', errorMessage: 'Claude AI usage limit reached.',
  })
  assert.equal(new ClaudeStream({ cwd: '/work' }).failed('No session to say it in.'), null)
})

test("a tool result's line names its tool and keeps a failure's words, as hobkin's hold brief reads them", () => {
  const stream = new ClaudeStream({ cwd: '/work' })
  const results = (...records: Record<string, unknown>[]) =>
    records.flatMap((record) => stream.accept(record).lines).map((line) => line.message as Record<string, unknown>).filter((message) => message?.role === 'toolResult')
  results(init)

  // What a failed call said, up to a bound.
  const failed = `Exit code 1\n${'npm ERR! Missing script: "test"\n'.repeat(100)}`
  assert.deepEqual(results(
    assistant('msg_1', { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }),
    toolResult('toolu_1', failed, true),
  ), [{ role: 'toolResult', toolCallId: 'toolu_1', toolName: 'Bash', content: [{ type: 'text', text: failed.slice(0, 2000) }], isError: true }])

  // A call that worked keeps none of its output.
  assert.deepEqual(results(
    assistant('msg_2', { type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/work/package.json' } }),
    toolResult('toolu_2', [{ type: 'text', text: '{ "name": "work" }' }]),
  ), [{ role: 'toolResult', toolCallId: 'toolu_2', toolName: 'Read', content: [], isError: false }])

  // A subagent's calls are named as well, though they are not drawn.
  assert.deepEqual(results(
    assistant('msg_sub', { type: 'tool_use', id: 'toolu_sub', name: 'Grep', input: { pattern: 'foo' } }, usage(10, 1), 'toolu_agent'),
    toolResult('toolu_sub', [{ type: 'text', text: 'No files found' }], true, 'toolu_agent'),
  ), [{ role: 'toolResult', toolCallId: 'toolu_sub', toolName: 'Grep', content: [{ type: 'text', text: 'No files found' }], isError: true }])
})
