import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hobkinOfAgent, type HobkinSummary } from '#shared/protocol/hobkins.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { agentsFrom } from '../src/lib/host/frame.ts'
import { agentGroups, durableAgents, listedAgents } from '../src/features/hobkins/list.ts'

const base = { turns: 2, last: null, waiting: null, createdAt: '2026-11-13T10:00:00.000Z' } as const

const working: HobkinSummary = {
  ...base,
  id: '0a1b2c3d',
  title: 'Tidy the docs',
  cwd: '/Users/someone/code/site',
  engine: { kind: 'tier', tier: 'high' },
  state: 'working',
  run: 'hobkin:0a1b2c3d:2',
}
const waiting: HobkinSummary = {
  ...base,
  id: 'ffff0000',
  title: 'Watch the deploy',
  cwd: '/Users/someone',
  engine: { kind: 'pi', model: 'openai/gpt-5', effort: 'xhigh' },
  state: 'waiting',
  run: null,
  last: { status: 'completed', said: 'The deploy is green.\nNothing else changed.', at: '2026-11-13T10:05:00.000Z' },
  waiting: { since: '2026-11-13T10:05:00.000Z', seen: false },
}

const turn = { id: 'hobkin:0a1b2c3d:2', title: 'Tidy the docs', state: 'running', kind: 'background', effort: 'high', scheduleId: 'hobkin.0a1b2c3d', cwd: '/Users/someone/code/site' } as const
const agent = { id: 'w1', title: 'Fix the login redirect', state: 'running', kind: 'background', effort: 'high', work: { slug: 'storefront', item: '3fa9c1' }, scheduleId: 'work' } as const

test('a durable hobkin stays listed and its turns are not agents', () => {
  const snapshot: WireSnapshot = {
    runs: [agent, turn, { ...turn, id: 'hobkin:0a1b2c3d:1', state: 'completed' }],
    hobkins: [working, waiting],
    jobActivity: {
      'hobkin:0a1b2c3d:2': [
        { id: 'message:1:0', kind: 'assistant', text: 'Reading the  index.' },
        { id: 'tool:a', kind: 'tool', name: 'grep', state: 'running' },
      ],
    },
  }

  // Each durable hobkin is an agent of the list, working or waiting, addressed by its own agent id. Its turns are not.
  const listed = listedAgents(snapshot)
  assert.deepEqual(listed.map(({ id }) => id), ['hobkin:0a1b2c3d', 'hobkin:ffff0000', 'w1'])
  assert.deepEqual(listed.map(({ id }) => hobkinOfAgent(id)), ['0a1b2c3d', 'ffff0000', null])
  assert.deepEqual(agentsFrom(snapshot).map(({ id }) => id), ['w1'], 'a turn in flight is never an agent of its own')
  assert.deepEqual(agentsFrom(snapshot, { includeEnded: true }).map(({ id }) => id), ['w1'], 'nor a finished one')
  // A routine the user happened to name `hobkin.nightly` is a routine like any other, and stays listed.
  const nightly = { id: 'hobkin.nightly:2026-11-13', title: 'Nightly', state: 'running', kind: 'background', scheduleId: 'hobkin.nightly' } as const
  assert.deepEqual(agentsFrom({ runs: [nightly, turn] }).map(({ id }) => id), ['hobkin.nightly:2026-11-13'])

  const [busy, idle] = listed
  assert.deepEqual(
    { doing: busy!.doing, mood: busy!.mood, update: busy!.update, project: busy!.project, tier: busy!.tier, kind: busy!.kind, durable: busy!.durable },
    {
      doing: 'running grep',
      mood: 'searching',
      update: 'Reading the index.',
      project: 'site',
      tier: 'high',
      kind: 'session',
      durable: { id: '0a1b2c3d', state: 'working', run: 'hobkin:0a1b2c3d:2', unseen: false, engine: working.engine, cwd: working.cwd },
    },
    'while it works it reads as its turn does',
  )
  assert.deepEqual(
    { doing: idle!.doing, mood: idle!.mood, update: idle!.update, tier: idle!.tier, unseen: idle!.durable?.unseen, run: idle!.durable?.run },
    { doing: 'waiting', mood: 'idle', update: 'The deploy is green. Nothing else changed.', tier: 'max', unseen: true, run: null },
    'while it waits it says what it said last, and whether the user has looked',
  )
  assert.equal(busy!.hue, listedAgents(snapshot)[0]!.hue, 'it keeps its color')

  // The turn ends: the hobkin waits, and is still listed.
  const after: WireSnapshot = {
    ...snapshot,
    runs: [agent, { ...turn, state: 'completed' }],
    hobkins: [{ ...working, state: 'waiting', run: null, waiting: { since: '2026-11-13T10:09:00.000Z', seen: true } }, waiting],
  }
  assert.deepEqual(listedAgents(after).map(({ id, doing }) => [id, doing]), [
    ['hobkin:0a1b2c3d', 'waiting'],
    ['hobkin:ffff0000', 'waiting'],
    ['w1', 'starting'],
  ])
  assert.equal(listedAgents(after)[0]!.hue, busy!.hue, 'the same color across its turns')

  // Ended, it leaves the list. A host older than durable hobkins has none.
  assert.deepEqual(listedAgents({ ...after, hobkins: [waiting] }).map(({ id }) => id), ['hobkin:ffff0000', 'w1'])
  assert.deepEqual(durableAgents({}), [])
  assert.equal(durableAgents({ hobkins: [{ ...waiting, engine: { kind: 'claude' } }] })[0]!.tier, 'mid')
})

test('the durable hobkins are a group of their own, above the agents that come and go', () => {
  const snapshot: WireSnapshot = { runs: [agent, { ...agent, id: 'w2' }], hobkins: [working, waiting] }
  const ids = (agents: readonly { id: string }[]) => agents.map(({ id }) => id)

  // Each group has its own rows, and Up and Down walk them all: the durable hobkins first, whatever order they came in.
  const groups = agentGroups([...listedAgents(snapshot)].reverse())
  assert.deepEqual(ids(groups.durable), ['hobkin:ffff0000', 'hobkin:0a1b2c3d'])
  assert.deepEqual(ids(groups.others), ['w2', 'w1'], 'the count over the others is theirs alone')
  assert.deepEqual(ids(groups.walk), ['hobkin:ffff0000', 'hobkin:0a1b2c3d', 'w2', 'w1'])

  // A group with nothing in it is empty, so it draws no header and no line.
  assert.deepEqual(ids(agentGroups(listedAgents({ runs: [agent] })).durable), [])
  assert.deepEqual(ids(agentGroups(listedAgents({ hobkins: [waiting] })).others), [])
})
