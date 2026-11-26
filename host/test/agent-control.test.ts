import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { agentHandlers, type AgentsApp } from '../src/agents.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand, type HostHandlers } from '../src/commands.ts'

const RUNS: RunSummary[] = [
  { id: 'main:1', kind: 'main', state: 'running', title: 'hobkin' },
  { id: 'work:shop:7', kind: 'background', state: 'running', title: 'Fix the cart total', model: 'anthropic/claude-opus-5-5', effort: 'high', tier: 'high', work: { slug: 'shop', item: '7' } },
  { id: 'session:deploy', kind: 'background', state: 'waiting', title: 'Watch the deploy', scheduleId: 'session.deploy', model: 'openai/gpt-6', effort: 'low' },
  { id: 'session:crab', kind: 'background', state: 'running', title: 'Tidy the docs', onClaudeCode: true },
  { id: 'session:turn', kind: 'background', state: 'running', title: 'A durable hobkin turn', scheduleId: 'hobkin.a1b2c3d4' },
  { id: 'session:done', kind: 'background', state: 'completed', title: 'Old' },
]

/** hobkin's application as far as stopping agents goes: it records each kill. */
function fakeApp() {
  const calls: unknown[][] = []
  const app = {
    workAction: async (...args: unknown[]) => (calls.push(['work', ...args]), { message: 'Stopped.' }),
    kill: async (run: string) => (calls.push(['kill', run]), true),
    runner: { messageCheck: async () => ({ running: [] }) },
  } satisfies AgentsApp
  return { calls, handlers: agentHandlers({ app: () => app, runs: () => RUNS }) }
}

test('agent.list lists the agents that work or wait, as the window lists them, each with its model and thinking level', async () => {
  const { handlers } = fakeApp()

  const listed = await runCommand(handlers, 'agent.list', {})

  assert.deepEqual(listed, {
    ok: true,
    value: {
      agents: [
        { run: 'work:shop:7', title: 'Fix the cart total', state: 'running', model: 'anthropic/claude-opus-5-5', effort: 'high', tier: 'high', work: { slug: 'shop', item: '7' } },
        { run: 'session:deploy', title: 'Watch the deploy', state: 'waiting', model: 'openai/gpt-6', effort: 'low' },
        { run: 'session:crab', title: 'Tidy the docs', state: 'running', onClaudeCode: true },
      ],
    },
  })
})

test("hobkin finds, stops, ends and changes agents through its client tool, and still never talks to a durable hobkin as the user", async () => {
  const { calls, handlers } = fakeApp()
  const ended: string[] = []
  const all: HostHandlers = { ...handlers, 'hobkin.end': async ({ id }) => (ended.push(id), { ok: true }) }
  const client = createClientTool({ run: (name, args) => runCommand(all, name, args) })
  const use = (params: { action: 'list' | 'run'; name?: string; args?: Record<string, unknown> }) => client.execute('call', params)

  const offered = ((await use({ action: 'list' })).details as { name: string }[]).map(({ name }) => name)
  for (const name of ['agent.list', 'agent.stop', 'agent.change', 'hobkin.list', 'hobkin.end', 'hobkin.change']) assert.ok(offered.includes(name), name)
  for (const name of ['hobkin.start', 'hobkin.say']) assert.ok(!offered.includes(name), name)

  await use({ action: 'run', name: 'agent.stop', args: { run: 'session:deploy' } })
  await use({ action: 'run', name: 'hobkin.end', args: { id: 'a1b2c3d4' } })
  await assert.rejects(use({ action: 'run', name: 'hobkin.say', args: { id: 'a1b2c3d4', text: 'Stop now.' } }), /hobkin cannot run hobkin.say/)

  assert.deepEqual(calls, [['kill', 'session:deploy']])
  assert.deepEqual(ended, ['a1b2c3d4'])
})
