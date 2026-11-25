import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TeamsAgent } from '../../shared/protocol/teams.ts'
import { stampOf } from '../src/features/agent-activity/stamp.ts'
import { agentsCount, describeTeamsAgent, firstLine, standing, stillRead, stillShown, teamsAgentsOf, teamsSummary, whatIsKept, whoSaid } from '../src/features/teams/rules.ts'

// Local times, so the rules hold in any time zone the tests run in.
const at = (hour: number, minute: number, second: number) => new Date(2026, 10, 15, hour, minute, second).getTime()
const agent = (name: string, state: TeamsAgent['state'], startedAt: number, extra: Partial<TeamsAgent> = {}): TeamsAgent => ({
  key: `call:${name}`, name, task: `Task of ${name}`, state, startedAt, from: 'run', ...extra,
})

test('running agents come first, then queued and unknown, then failed and done', () => {
  const all = {
    turn1: [agent('scout', 'done', at(14, 0, 0), { endedAt: at(14, 3, 0) }), agent('fixer', 'running', at(14, 1, 0))],
    turn2: [agent('scout', 'running', at(14, 5, 0)), agent('lint', 'failed', at(14, 4, 0), { endedAt: at(14, 4, 1) })],
    other: [agent('elsewhere', 'running', at(13, 0, 0))],
    turn3: [agent('waiting', 'queued', at(14, 6, 0)), agent('lost', 'unknown', at(13, 59, 0))],
  }
  const shown = teamsAgentsOf(all, ['turn1', 'turn2', 'turn3', 'turn2'])
  assert.deepEqual(shown.map((row) => `${row.run}:${row.name}:${row.state}`), [
    'turn1:fixer:running', 'turn2:scout:running', 'turn3:waiting:queued', 'turn3:lost:unknown',
    'turn2:lint:failed', 'turn1:scout:done',
  ])
  assert.equal(new Set(shown.map((row) => row.id)).size, shown.length, 'the same name in two turns is two rows')
  assert.deepEqual(teamsAgentsOf(undefined, ['turn1']), [])
  assert.deepEqual(teamsAgentsOf(all, []), [])
  assert.equal(teamsSummary(shown), '6 teams agents · 2 running, 1 queued, 1 unknown, 1 failed, 1 done')
  assert.equal(teamsSummary(shown.slice(0, 1)), '1 teams agent · 1 running')
  assert.equal(teamsSummary([]), '')
})

test('a done agent leaves the strip, and a failed or unknown one stays', () => {
  const all = {
    turn1: [agent('scout', 'done', at(14, 0, 0), { endedAt: at(14, 3, 0) }), agent('fixer', 'running', at(14, 1, 0))],
    turn2: [agent('lint', 'failed', at(14, 4, 0), { endedAt: at(14, 4, 1) }), agent('lost', 'unknown', at(13, 59, 0)), agent('waiting', 'queued', at(14, 6, 0))],
  }
  const shown = stillShown(teamsAgentsOf(all, ['turn1', 'turn2']))
  assert.deepEqual(shown.map((row) => `${row.name}:${row.state}`), ['fixer:running', 'waiting:queued', 'lost:unknown', 'lint:failed'])
  assert.deepEqual(stillShown(teamsAgentsOf({ turn1: [agent('scout', 'done', at(14, 0, 0))] }, ['turn1'])), [])
})

test('an agent the user is reading stays, marked done, until they close it, and then it leaves', () => {
  const before = teamsAgentsOf({ turn1: [agent('scout', 'running', at(14, 0, 0)), agent('fixer', 'running', at(14, 1, 0))] }, ['turn1'])
  const after = teamsAgentsOf({ turn1: [agent('scout', 'done', at(14, 0, 0), { endedAt: at(14, 3, 0) }), agent('fixer', 'running', at(14, 1, 0))] }, ['turn1'])
  const names = (agents: readonly { name: string; state: string }[]) => agents.map((row) => `${row.name}:${row.state}`)

  // The list is open while scout finishes: scout stays in it, done.
  let read = stillRead(new Set(), before, { list: true })
  read = stillRead(read, after, { list: true })
  assert.deepEqual(names(stillShown(after, read)), ['fixer:running', 'scout:done'])
  // The list closes: scout leaves.
  read = stillRead(read, after, { list: false })
  assert.deepEqual(names(stillShown(after, read)), ['fixer:running'])
  // A list opened after it finished does not bring it back.
  assert.deepEqual(names(stillShown(after, stillRead(new Set(), after, { list: true }))), ['fixer:running'])

  // Scout's own sheet is open while it finishes, with no list: it stays, the last one too, until the sheet closes.
  const scout = before[0]!.id
  const alone = after.filter((row) => row.id === scout)
  read = stillRead(new Set(), before, { list: false, agent: scout })
  read = stillRead(read, alone, { list: false, agent: scout })
  assert.deepEqual(names(stillShown(alone, read)), ['scout:done'])
  assert.deepEqual(stillShown(alone, stillRead(read, alone, { list: false })), [])
})

test('an opened agent says what it was asked and what hobkin has of its work', () => {
  const now = at(15, 0, 0)
  assert.equal(firstLine('\n  Find the bug in the login flow\nthen fix it'), 'Find the bug in the login flow')
  assert.equal(firstLine('x'.repeat(200)).length, 96)
  assert.ok(firstLine('x'.repeat(200)).endsWith('…'))
  assert.equal(firstLine(''), 'No task was given.')

  const running = agent('scout', 'running', at(14, 5, 7), { phase: 'grep' })
  assert.deepEqual(standing(running, now), { word: 'running', note: 'grep', time: stampOf(at(14, 5, 7), now) })
  const done = agent('scout', 'done', at(14, 5, 7), { endedAt: at(14, 9, 30) })
  assert.deepEqual(standing(done, now), { word: 'done', time: stampOf(at(14, 9, 30), now) })
  assert.deepEqual(standing(agent('lost', 'unknown', at(14, 0, 0)), now), { word: 'unknown', time: null })
  assert.match(describeTeamsAgent(done, now), /^scout, done at .*09:30.*; asked: Task of scout$/)
  assert.match(describeTeamsAgent(agent('lost', 'unknown', at(14, 0, 0)), now), /how it ended is not known/)
  const onLuna = { ...done, modelSlot: 'read-review', model: 'openai-codex/gpt-6-luna', thinking: 'max' }
  assert.match(describeTeamsAgent(onLuna, now), /^scout, done at .*09:30.*; Read-review tier: openai-codex\/gpt-6-luna at max; asked: Task of scout$/)

  assert.deepEqual(whatIsKept(agent('bare', 'running', at(14, 0, 0))), { steps: false, messages: false })
  assert.deepEqual(whatIsKept(agent('full', 'done', at(14, 0, 0), {
    steps: [{ id: 'message:1:0', kind: 'assistant', text: 'Reading', at: at(14, 0, 2) }],
    messages: [{ by: 'run', text: 'Look at the store', at: at(14, 0, 3) }],
  })), { steps: true, messages: true })

  assert.equal(whoSaid({ by: 'run', text: '' }, 'scout', 'Nightly digest'), 'Nightly digest')
  assert.equal(whoSaid({ by: 'agent', text: '' }, 'scout', 'Nightly digest'), 'scout')
  assert.equal(whoSaid({ by: 'peer', peer: 'fixer', text: '' }, 'scout', 'Nightly digest'), 'fixer')
  assert.equal(whoSaid({ by: 'peer', text: '' }, 'scout', 'Nightly digest'), 'Another teams agent')
})

test("the agents' one line says how many, as the tasks line does", () => {
  const shown = teamsAgentsOf({ turn1: [agent('lint', 'failed', at(14, 4, 0)), agent('test-gate', 'running', at(14, 1, 0)), agent('observability', 'running', at(14, 2, 0))] }, ['turn1'])
  assert.equal(agentsCount(shown), '3 agents')
  assert.equal(agentsCount(shown.slice(2)), '1 agent')
})
