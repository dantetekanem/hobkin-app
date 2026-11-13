import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, afterEach, test } from 'node:test'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore } from '../src/lib/host/client.ts'
import { applyHostMessage, applyLink, initialHostState } from '../src/lib/host/state.ts'
import type { StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'

const aliases = registerHooks({
  resolve(specifier, context, next) {
    return next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
  },
})
after(() => aliases.deregister())
const { runWork, useWorkUi } = await import('../src/features/work/store.ts')
const { agentControls, useAgentControl } = await import('../src/app/running-agents.ts')

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
  const replies = [deferred<StopExecutionReceipt>(), deferred<StopExecutionReceipt>()]
  const calls: [string, StopExecutionArgs][] = []
  const receipt = (args: StopExecutionArgs, message: string): StopExecutionReceipt => ({
    ...args,
    message,
    stop: { status: 'unknown' },
    closure: { status: 'unknown' },
    descendants: { status: 'unknown', agents: [], cleanupScope: 'captured-rpc-children', detachedCleanup: 'unknown' },
    queueRecovery: { status: 'not-attempted' },
  })
  t.mock.method(HostConnection.prototype, 'command', (name: string, args: StopExecutionArgs) => {
    calls.push([name, args])
    return replies[calls.length - 1]?.promise ?? Promise.resolve(receipt(args, 'Retry requested.'))
  })
  openHome('/home-a')
  hostStore.setState({
    owner: { state: 'live', limits: { images: 4, imageBytes: 1 } },
    snapshot: {
      runs: [{ id: 'work:a', title: 'A', state: 'ended', work: { slug: 'project', item: 'a' } }],
      stopControls: {
        home: '/home-a',
        epoch: 'owner:1',
        targets: ['work:a', 'session:b'].map(runId => ({
          kind: 'run',
          runId,
          parentId: null,
          rootId: runId,
          label: runId,
          canStop: true,
          canForce: true,
        })),
      },
    },
  })
  const a = runWork({ do: 'stop', run: 'work:a', how: 'not-approved' }, { live: true, place: 'map' })
  const b = runWork({ do: 'stop', run: 'session:b', how: 'for-now' }, { live: true, place: 'map' })
  assert.deepEqual(calls.map(([name, args]) => [name, args.target.runId, args.mode, args.how]), [
    ['execution.stop', 'work:a', 'stop', 'not-approved'],
    ['execution.stop', 'session:b', 'stop', undefined],
  ])
  replies[1]!.resolve(receipt(calls[1]![1], 'B requested.'))
  await b
  await runWork({ do: 'stop', run: 'session:b', how: 'for-now' }, { live: true, place: 'map' })
  assert.equal(calls.length, 3)
  replies[0]!.resolve(receipt(calls[0]![1], 'A requested.'))
  await a
  assert.match(useWorkUi.getState().said['stop:session:b']!.text, /Retry requested/)
  assert.equal(useWorkUi.getState().said['stop:session:b']?.tone, 'refused')
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
