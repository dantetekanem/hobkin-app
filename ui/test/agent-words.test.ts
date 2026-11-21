import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement } from 'react'
import type { HobkinSummary } from '../../shared/protocol/hobkins.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import type { RunSummary, WireSnapshot } from '../../shared/protocol/snapshot.ts'
import { listedAgents, wordsOf } from '../src/features/hobkins/list.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { countListBuilds } from './list-builds.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => { throw new Error('Connection must stay stopped') })
mock.method(HostConnection.prototype, 'command', async () => { throw new Error('Nothing here sends commands') })
const { hostStore } = await import('../src/lib/host/client.ts')
const { useAgentWords } = await import('../src/app/running-agents.ts')
after(() => {
  mock.restoreAll()
  mock.timers.reset()
  Reflect.deleteProperty(globalThis, 'window')
})

const hobkin = (id: string, rest: Partial<HobkinSummary>): HobkinSummary => ({
  id, title: `Hobkin ${id}`, cwd: '/fake/site', engine: { kind: 'tier', tier: 'mid' }, state: 'waiting', turns: 1, run: null, last: null, waiting: null, createdAt: '2026-11-21T10:00:00.000Z', ...rest,
})
const run = (id: string, rest: Partial<RunSummary> = {}): RunSummary => ({ id, title: `Run ${id}`, state: 'running', kind: 'background', cwd: '/fake/app', ...rest })
const said = (text: string) => [{ id: 'message:1:0', kind: 'assistant' as const, text }]

function snapshotOfEveryKind(): WireSnapshot {
  return {
    hobkins: [
      hobkin('0a1b2c3d', { state: 'working', run: 'hobkin:0a1b2c3d:2' }),
      hobkin('ffff0000', { last: { status: 'completed', said: 'The deploy\n is green.', at: '2026-11-21T10:05:00.000Z' }, waiting: { since: '2026-11-21T10:05:00.000Z', seen: false } }),
      hobkin('12345678', {}),
    ],
    runs: [
      run('w1'),
      run('w2', { state: 'completed' }),
      run('hobkin:0a1b2c3d:2', { scheduleId: 'hobkin.0a1b2c3d' }),
      run('silent'),
    ],
    jobActivity: {
      w1: said('## Reading the index\n\nThen the tests.'),
      w2: said('Done with it.'),
      'hobkin:0a1b2c3d:2': said('Tidying the docs.'),
    },
  }
}

test("a row's words are what the agents list says of its agent, read without building the list", () => {
  const snapshot = snapshotOfEveryKind()
  const ids = ['hobkin:0a1b2c3d', 'hobkin:ffff0000', 'hobkin:12345678', 'w1', 'w2', 'hobkin:0a1b2c3d:2', 'silent', 'gone']
  const listed = listedAgents(snapshot)
  const builds = countListBuilds(snapshot.runs!)

  const words = ids.map((id) => wordsOf(snapshot, id))

  assert.deepEqual(words, ids.map((id) => listed.find((agent) => agent.id === id)?.update))
  assert.deepEqual(words, ['Tidying the docs.', 'The deploy is green.', undefined, 'Reading the index', undefined, undefined, undefined, undefined])
  assert.equal(builds.count, 0, 'no agents list was built')
})

test('useAgentWords follows its own agent from the host, and says the sample words without one', async () => {
  const sample = { id: 'w1', title: 'Run w1', project: 'app', doing: 'writing', mood: 'thinking', tier: 'mid', hue: 1, kind: 'work', update: 'Sample words' } as const
  let words: (string | undefined)[] = []
  const Row = () => {
    words.push(useAgentWords(sample))
    return null
  }
  const mounted = await mountCounting(() => createElement(Row))
  assert.deepEqual(words, ['Sample words'], 'no host has answered, so the row says what the sample agent says')

  const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
  words = []
  await mounted.change(() => {
    send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
    send({ type: 'state', rev: 1, reset: true, set: { runs: [run('w1'), run('w9')] }, activity: [{ op: 'reset', job: 'w1', entries: said('Reading the index.') }, { op: 'reset', job: 'w9', entries: said('Elsewhere.') }] })
  })
  assert.equal(words.at(-1), 'Reading the index.')
  const drawn = words.length
  await mounted.change(() => send({ type: 'state', rev: 2, activity: [{ op: 'update', job: 'w9', entry: { id: 'message:1:0', kind: 'assistant', text: 'Elsewhere, still.' } }] }))
  assert.equal(words.length, drawn, "another agent's words do not draw the row")
  await mounted.change(() => send({ type: 'state', rev: 3, activity: [{ op: 'update', job: 'w1', entry: { id: 'message:1:0', kind: 'assistant', text: 'Running the tests.' } }] }))
  assert.equal(words.at(-1), 'Running the tests.')
  await mounted.unmount()
})
