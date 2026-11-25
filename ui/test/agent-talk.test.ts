import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HobkinSummary } from '../../shared/protocol/hobkins.ts'
import type { StopControlTarget } from '../../shared/protocol/snapshot.ts'
import { agentTalk, draftWithTakenBack, stoppedTurn, takenNoteIds, talkTurn, waitingRows } from '../src/features/work/talk.ts'
import { initialHostState, type HostState } from '../src/lib/host/state.ts'

const control = (runId: string): StopControlTarget => ({ kind: 'run', runId, parentId: null, rootId: runId, label: 'Run', canStop: true, canForce: true })
const hobkin = (fields: Partial<HobkinSummary>): HobkinSummary => ({
  id: 'a1b2c3d4', title: 'Fix the tests', cwd: '/tmp', engine: { kind: 'tier', tier: 'mid' }, state: 'waiting', turns: 1, run: null,
  last: null, waiting: null, createdAt: '2026-11-25T09:00:00.000Z', ...fields,
})
const live = (snapshot: HostState['snapshot']): HostState => ({
  ...initialHostState, link: 'open', home: '/h', epoch: 1, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } },
  snapshot: { stopControls: { home: '/h', epoch: 'e', targets: [] }, ...snapshot },
})

test("a run's turn and a durable hobkin's are stopped the same way, through the run in flight", () => {
  const working = live({ stopControls: { home: '/h', epoch: 'e', targets: [control('once:recap'), control('hobkin:a1b2c3d4:2')] }, hobkins: [hobkin({ state: 'working', run: 'hobkin:a1b2c3d4:2' })] })

  assert.equal(talkTurn(working, { kind: 'run', run: 'once:recap' })?.runId, 'once:recap')
  assert.equal(talkTurn(working, { kind: 'hobkin', id: 'a1b2c3d4' })?.runId, 'hobkin:a1b2c3d4:2')
  assert.equal(talkTurn(live({ hobkins: [hobkin({})] }), { kind: 'hobkin', id: 'a1b2c3d4' }), undefined, 'a waiting hobkin has nothing to stop')
})

test('a durable hobkin whose last turn the user stopped can be continued; a stopped run has ended', () => {
  const stopped = hobkin({ last: { status: 'interrupted', said: '', at: '2026-11-25T10:00:00.000Z' } })

  assert.equal(stoppedTurn(live({ hobkins: [stopped] }), { kind: 'hobkin', id: 'a1b2c3d4' }), true)
  assert.equal(stoppedTurn(live({ hobkins: [{ ...stopped, state: 'working', run: 'hobkin:a1b2c3d4:2' }] }), { kind: 'hobkin', id: 'a1b2c3d4' }), false)
  assert.equal(stoppedTurn(live({ hobkins: [hobkin({ last: { status: 'completed', said: 'Done.', at: '2026-11-25T10:00:00.000Z' } })] }), { kind: 'hobkin', id: 'a1b2c3d4' }), false)
  assert.equal(stoppedTurn(live({}), { kind: 'run', run: 'once:recap' }), false)
})

test("each agent's own commands are behind one way to talk to it", async () => {
  const asked: [string, unknown][] = []
  const run = async (name: string, args: unknown) => {
    asked.push([name, args])
    if (name === 'agent.say') return { queued: true, unsent: [{ text: 'Only weekdays' }] }
    if (name === 'hobkin.say') return { started: false, queued: true, run: 'hobkin:a1b2c3d4:2' }
    return { unsent: [{ noteId: 'n1', text: 'Then sum it up' }] }
  }

  const toRun = agentTalk({ kind: 'run', run: 'once:recap' }, run as never)
  const toHobkin = agentTalk({ kind: 'hobkin', id: 'a1b2c3d4' }, run as never)
  const interrupted = await toRun.say({ text: 'Do this instead', noteId: 'n2', queue: 'interrupt' })
  const followed = await toHobkin.say({ text: 'Then sum it up', noteId: 'n1', sentAt: 5, queue: 'follow-up' })

  assert.deepEqual(interrupted, { queued: true, started: false, run: 'once:recap', unsent: [{ text: 'Only weekdays' }] })
  assert.deepEqual(followed, { queued: true, started: false, run: 'hobkin:a1b2c3d4:2', unsent: [] })
  assert.deepEqual(await toHobkin.takeBack(), [{ noteId: 'n1', text: 'Then sum it up' }])
  assert.deepEqual(await toRun.takeBack(), [{ noteId: 'n1', text: 'Then sum it up' }])
  assert.deepEqual(asked, [
    ['agent.say', { run: 'once:recap', text: 'Do this instead', noteId: 'n2', queue: 'interrupt' }],
    ['hobkin.say', { id: 'a1b2c3d4', text: 'Then sum it up', noteId: 'n1', sentAt: 5, queue: 'follow-up' }],
    ['hobkin.dequeue', { id: 'a1b2c3d4' }],
    ['agent.dequeue', { run: 'once:recap' }],
  ])
})

test('what waits for the turn shows as rows until the turn reads it, and comes back into the box ahead of what is typed', () => {
  const notes = [
    { id: 'a', text: 'Only weekdays', at: 1, queue: 'steer' as const, waiting: true },
    { id: 'b', text: 'Then sum it up', at: 2, queue: 'follow-up' as const, waiting: true },
    { id: 'c', text: 'Read already', at: 3, queue: 'steer' as const, waiting: false },
  ]

  assert.deepEqual(waitingRows(notes).map(({ key, queue, text }) => [key, queue, text]), [['a', 'steer', 'Only weekdays'], ['b', 'follow-up', 'Then sum it up']])
  const unsent = [{ noteId: 'a', text: 'Only weekdays' }, { text: 'Then sum it up' }]

  assert.equal(draftWithTakenBack('half a thought', unsent), 'Only weekdays\n\nThen sum it up\n\nhalf a thought')
  assert.deepEqual(takenNoteIds(unsent), ['a'])
})
