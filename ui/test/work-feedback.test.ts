import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { runWork, useWorkUi } from '../src/features/work/store.ts'
import { agentControls, useAgentControl } from '../src/app/running-agents.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function openHome(home: string) {
  hostStore.setState({ ...initialHostState, home, link: 'open' }, true)
  useWorkUi.setState({ busy: {}, said: {} })
}

afterEach(() => {
  hostStore.setState(initialHostState, true)
  useWorkUi.setState({ busy: {}, said: {} })
})

test('disconnect, home change, and reset discard old work feedback', async t => {
  const replies = Array.from({ length: 3 }, () => deferred<{ message: string }>())
  let calls = 0
  t.mock.method(HostConnection.prototype, 'command', () => replies[calls++]!.promise)
  const boundaries = [
    () => hostStore.setState(state => applyLink(state, 'lost')),
    () => hostStore.setState({ home: '/home-b' }),
    () => hostStore.setState(state => applyHostMessage(state, { type: 'state', rev: 1, reset: true, set: {} })),
  ]

  for (const [index, changeHost] of boundaries.entries()) {
    openHome('/home-a')
    const oldAction = runWork({ do: 'priority', slug: 'storefront', priority: 'P0' }, { live: true, place: 'storefront' })
    assert.deepEqual(useWorkUi.getState().busy, { storefront: true })
    agentControls.interrupt('missing')
    assert.ok(useAgentControl.getState().result)
    changeHost()
    assert.deepEqual(useAgentControl.getState(), { target: null, busy: false, result: null })
    assert.deepEqual(useWorkUi.getState().busy, {}, 'a new host context releases the old pending indicator')
    assert.deepEqual(useWorkUi.getState().said, {}, 'old feedback is removed at the boundary')
    if (index === 0) replies[index]!.reject(new Error('Disconnected from hobkin.'))
    else replies[index]!.resolve({ message: `old reply ${index}` })
    const said = await oldAction
    if (index === 0) assert.deepEqual(said, { tone: 'refused', text: 'Disconnected from hobkin.' })
    assert.deepEqual(useWorkUi.getState().busy, {})
    assert.deepEqual(useWorkUi.getState().said, {}, 'a late reply cannot be attributed to the new context')
  }
})

test('map Stops own their target independently, preserve reasons, and permit settled retry', async t => {
  const replies = [deferred<{ message: string }>(), deferred<{ message: string }>()]
  const calls: unknown[] = []
  t.mock.method(HostConnection.prototype, 'command', (name: string, args: unknown) => {
    calls.push([name, args])
    return replies[calls.length - 1]?.promise ?? Promise.resolve({ message: 'Retry requested.' })
  })
  openHome('/home-a')
  const a = runWork({ do: 'stop', run: 'work:a', how: 'not-approved' }, { live: true, place: 'map' })
  const b = runWork({ do: 'stop', run: 'session:b', how: 'for-now' }, { live: true, place: 'map' })
  assert.deepEqual(calls, [
    ['agent.stop', { run: 'work:a', how: 'not-approved' }],
    ['agent.stop', { run: 'session:b', how: 'for-now' }],
  ])
  replies[1]!.resolve({ message: 'B requested.' })
  await b
  await runWork({ do: 'stop', run: 'session:b', how: 'for-now' }, { live: true, place: 'map' })
  assert.equal(calls.length, 3)
  replies[0]!.resolve({ message: 'A requested.' })
  await a
  assert.equal(useWorkUi.getState().said['stop:session:b']?.text, 'Retry requested.')
})

test('an old epoch cannot clear or replace a newer operation; host command targets stay exact', async t => {
  const replies = Array.from({ length: 3 }, () => deferred<{ message: string }>())
  const calls: unknown[] = []
  t.mock.method(HostConnection.prototype, 'command', (name: Parameters<HostConnection['command']>[0], args: Parameters<HostConnection['command']>[1]) => {
    calls.push([name, args])
    return replies[calls.length - 1]!.promise
  })
  openHome('/same-home')

  const oldAction = runWork({ do: 'agents', agents: 2 }, { live: true, place: 'agents' })
  hostStore.setState(state => applyHostMessage(state, { type: 'state', rev: 1, reset: true, set: {} }))
  const newAction = runWork({ do: 'agents', agents: 3 }, { live: true, place: 'agents' })
  replies[0]!.resolve({ message: 'old host reply' })
  await oldAction
  assert.deepEqual(useWorkUi.getState().busy, { agents: true }, 'the old operation cannot clear the new busy marker')
  assert.deepEqual(useWorkUi.getState().said, {}, 'the old operation cannot publish feedback in the new epoch')

  replies[1]!.resolve({ message: 'saved 3' })
  await newAction
  assert.deepEqual(useWorkUi.getState().busy, {})
  assert.deepEqual(useWorkUi.getState().said, { agents: { tone: 'done', text: 'saved 3' } })

  const priority = runWork({ do: 'priority', slug: 'storefront', priority: 'P0' }, { live: true, place: 'storefront' })
  assert.deepEqual(calls, [
    ['work.agents', { agents: 2 }],
    ['work.agents', { agents: 3 }],
    ['work.project', { slug: 'storefront', priority: 'P0' }],
  ])
  replies[2]!.resolve({ message: 'saved priority' })
  await priority
})
