import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { actionItemCountFrom, agentsFrom, connectionFrom, mainModelFrom, projectsFrom } from '../src/lib/host/frame.ts'
import { initialHostState } from '../src/lib/host/state.ts'

test('the agents are the runs going on now, without hobkin itself', () => {
  const snapshot: WireSnapshot = {
    runs: [
      { id: 'main', title: 'Conversation', state: 'running', kind: 'main' },
      { id: 'w1', title: 'Fix the login redirect', state: 'running', kind: 'background', effort: 'high', work: { slug: 'storefront', item: '3fa9c1' }, scheduleId: 'work' },
      { id: 'r1', title: 'Morning recap', state: 'running', kind: 'background', effort: 'low', scheduleId: 'morning-recap' },
      { id: 's1', title: 'Look into the flaky test', state: 'running', kind: 'background', cwd: '/Users/someone/code/billing-api' },
      // A session hobkin ran as a job carries a schedule id of its own, and is still a session.
      { id: 'session:hobkin-review-1a2b', title: 'Review routines', state: 'running', kind: 'background', effort: 'medium', scheduleId: 'session.hobkin-review-1a2b', cwd: '/Users/someone/.hobkin' },
      { id: 'old', title: 'Yesterday', state: 'completed', kind: 'background' },
      { title: 'routines/daily/broken.md: Invalid', state: 'invalid' },
    ],
    jobActivity: {
      w1: [
        { id: 'message:1:0', kind: 'assistant', text: 'Let me look.' },
        { id: 'tool:a', kind: 'tool', name: 'grep', state: 'running' },
      ],
      r1: [{ id: 'message:1:0', kind: 'assistant', text: 'Writing the recap.' }],
    },
  }
  const agents = agentsFrom(snapshot)

  assert.deepEqual(
    agents.map(({ id, title, project, doing, tier, kind }) => ({ id, title, project, doing, tier, kind })),
    [
      { id: 'w1', title: 'Fix the login redirect', project: 'storefront', doing: 'running grep', tier: 'high', kind: 'work' },
      { id: 'r1', title: 'Morning recap', project: 'routine', doing: 'writing', tier: 'fast', kind: 'routine' },
      { id: 's1', title: 'Look into the flaky test', project: 'billing-api', doing: 'starting', tier: 'mid', kind: 'session' },
      { id: 'session:hobkin-review-1a2b', title: 'Review routines', project: '.hobkin', doing: 'starting', tier: 'mid', kind: 'session' },
    ],
  )
  assert.equal(agents[0]!.mood, 'searching')
  assert.deepEqual(agents.map(({ hue }) => hue), agentsFrom(snapshot).map(({ hue }) => hue), 'an agent keeps its color')
  assert.ok(agents.every(({ hue }) => hue >= 0 && hue < 360))
  assert.deepEqual(agentsFrom({}), [])
})

test('an agent that has begun emitting events is thinking until its first visible step', () => {
  const runs: WireSnapshot['runs'] = [{ id: 'work:site:do:1', title: 'Fix login', state: 'running', kind: 'background' }]
  assert.equal(agentsFrom({ runs })[0]?.doing, 'starting')
  assert.equal(agentsFrom({ runs, jobActivity: { 'work:site:do:1': [] } })[0]?.doing, 'thinking')
})

test('an ended agent keeps its identity for a reopened canvas without rejoining the running dock', () => {
  const run = { id: 'work:site:do:1', title: 'site: Fix login', state: 'running', kind: 'background', effort: 'high', work: { slug: 'site', item: 'fix' } } as const
  const [working] = agentsFrom({ runs: [run] })
  for (const state of ['completed', 'failed', 'interrupted']) {
    const snapshot: WireSnapshot = { runs: [{ ...run, state }] }
    assert.deepEqual(agentsFrom(snapshot), [])
    assert.deepEqual(agentsFrom(snapshot, { includeEnded: true }), [{ ...working, doing: state, mood: 'idle' }])
  }
  assert.deepEqual(agentsFrom({ runs: [{ id: 'main', title: 'Chat', kind: 'main', state: 'completed' }] }, { includeEnded: true }), [])
})

test('the frame reads what waits on the user, the model and the projects from the snapshot', () => {
  assert.equal(actionItemCountFrom({ decisions: [{}, {}], waiting: { asks: [{}], branches: [{}, {}], note: 'not rows' } }), 5)
  assert.equal(actionItemCountFrom({}), 0)
  assert.deepEqual(mainModelFrom({ main: { harness: 'pi', model: 'openai/gpt-5', effort: 'high' } }), { model: 'openai/gpt-5', effort: 'high' })
  assert.deepEqual(mainModelFrom({}), { model: '', effort: '' })

  const work = {
    projects: [
      { slug: 'storefront', name: 'storefront', priority: 'P0', state: 'chosen', open: 4, prs: 1, branches: 1, left: 0 },
      { slug: 'old-site', name: 'old-site', priority: 'P3', state: 'dropped', open: 0, prs: 0, branches: 0, left: 0 },
    ],
  }
  assert.deepEqual(projectsFrom({ work }), [{ slug: 'storefront', name: 'storefront', priority: 'P0', queued: 4, waiting: 2 }])
  assert.deepEqual(projectsFrom({}), [])
})

test('the connection says in a word where the data comes from', () => {
  const status = (state: Partial<typeof initialHostState>) => connectionFrom({ ...initialHostState, ...state }).status

  assert.equal(status({}), 'sample', 'until a host answers, the frame shows sample data')
  assert.equal(status({ link: 'none' }), 'sample')
  assert.equal(status({ link: 'open', home: '/home', owner: { state: 'opening' } }), 'connecting')
  assert.equal(status({ link: 'open', home: '/home', owner: { state: 'live', limits: { images: 4, imageBytes: 67108864 } } }), 'live')
  assert.equal(status({ link: 'open', home: '/home', owner: { state: 'failed', message: 'No models available' } }), 'offline')
  assert.equal(status({ link: 'lost', home: '/home', owner: { state: 'live', limits: { images: 4, imageBytes: 67108864 } } }), 'offline', 'a host that went away is offline, not sample')
})
