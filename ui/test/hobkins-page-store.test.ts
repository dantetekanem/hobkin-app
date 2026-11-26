import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { Activity, createElement, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import type { ActivityEntry } from '../../shared/protocol/activity.ts'
import type { HobkinConversation, HobkinSummary, HobkinTurn } from '../../shared/protocol/hobkins.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
} })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })

const ID = '0a1b2c3d'
const run = (n: number) => `hobkin:${ID}:${n}`
const TURNS = 300
const summary: HobkinSummary = {
  id: ID,
  title: 'Tidy the docs',
  cwd: '/Users/someone/code/site',
  engine: { kind: 'tier', tier: 'mid' },
  state: 'waiting',
  turns: TURNS,
  run: null,
  last: { status: 'completed', said: 'Done.', at: '2026-11-26T10:00:00.000Z' },
  waiting: null,
  createdAt: '2026-11-13T10:00:00.000Z',
}
const turn = (n: number): HobkinTurn => ({ n, run: run(n), asked: `message ${n}`, askedAt: '2026-11-26T09:00:00.000Z', status: 'completed', reply: `Done ${n}.`, error: null, endedAt: '2026-11-26T09:01:00.000Z' })
const conversation: HobkinConversation = { hobkin: summary, turns: Array.from({ length: TURNS }, (_, index) => turn(index + 1)) }
// A command, words and a command, over and over: each step a row of its own.
const steps = (n: number, count: number): ActivityEntry[] =>
  Array.from({ length: count }, (_, index) =>
    index % 2
      ? { id: `message:${n}:${index}`, kind: 'assistant', text: `Looking at part ${index} of turn ${n}.`, at: n * 1000 + index }
      : { id: `tool:${n}:${index}`, kind: 'tool', name: 'bash', state: 'completed', input: JSON.stringify({ command: `npm test -- ${n}-${index}` }), output: 'ok', at: n * 1000 + index },
  )
// The newest turn has five rows of steps, the one before it sixty-one, every other turn three.
const saved = (job: string): ActivityEntry[] => {
  const n = Number(job.split(':').at(-1))
  return steps(n, n === TURNS ? 5 : n === TURNS - 1 ? 61 : 3)
}
const asked: { name: string; job?: string }[] = []

const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {
  throw new Error('Connection must stay stopped')
})
mock.method(HostConnection.prototype, 'command', async (name: string, args: { job?: string; id?: string }) => {
  asked.push({ name, ...(args.job ? { job: args.job } : {}) })
  if (name === 'hobkin.read') return structuredClone(conversation)
  if (name === 'activity.before') return { steps: saved(args.job!), more: false, found: false }
  throw new Error(`No ${name} here`)
})
const { hostStore, onWatchedChange } = await import('../src/lib/host/client.ts')
const { pageRows, pageTurns } = await import('../src/features/hobkins/conversation.ts')
const { useConversation } = await import('../src/features/hobkins/use-conversation.ts')
const { useDrawnSteps, useHeldJobs, useNewestFirst } = await import('../src/features/hobkins/turn-steps.ts')
const { HOLD_MS, useKeptPage, useShownPage } = await import('../src/features/hobkins/page-store.ts')
after(() => {
  mock.restoreAll()
  Reflect.deleteProperty(globalThis, 'window')
})

let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
const hello = (watch: boolean) =>
  send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' }, ...(watch ? { watch } : {}) })
hello(false)
send({ type: 'state', rev: rev++, reset: true, set: { runs: [], reports: [] } })

const NONE: readonly string[] = []
interface Page {
  drawn: readonly string[]
  settled: boolean
  read: boolean
}

/** What a durable hobkin's page reads to draw its turns, as the page and its preparation do. */
function usePage(id: string, hobkin: HobkinSummary): Page {
  const { conversation } = useConversation(id, hobkin, true)
  const turns = useMemo(() => pageTurns(conversation, hobkin, []), [conversation, hobkin])
  const [drawn, setDrawn] = useState(NONE)
  const { finished, known } = useDrawnSteps(id, drawn, { live: null })
  const rows = useMemo(() => pageRows(turns, { sending: null, activity: null, finished }), [turns, finished])
  const settled = useNewestFirst(id, drawn, setDrawn as Dispatch<SetStateAction<readonly string[]>>, { turns, rows, known, shown: null, window: 40 })
  return { drawn, settled, read: conversation !== null }
}

/** Mounts a page, lets every read it asks for answer, and gives what it drew last. */
async function openPage(hobkin = summary) {
  const seen: { page: Page | null } = { page: null }
  const Shown = () => {
    seen.page = usePage(ID, hobkin)
    return null
  }
  const mounted = await mountCounting(() => createElement(Shown))
  for (let round = 0; round < 10 && !seen.page?.settled; round++) await mounted.change(() => {})
  await mounted.change(() => {})
  return { mounted, seen }
}

test('a page draws its turns newest first: it reads only the turns whose rows reach its newest forty', async () => {
  const { mounted, seen } = await openPage()
  assert.equal(seen.page?.settled, true)
  assert.deepEqual(seen.page?.drawn, [run(TURNS), run(TURNS - 1)])
  // Turn 300 has seven rows; turn 299's sixty-three fill the forty. No other turn is read, where twenty were.
  assert.deepEqual(asked.filter(({ name }) => name === 'activity.before').map(({ job }) => job), [run(TURNS), run(TURNS - 1)])
  assert.equal(asked.filter(({ name }) => name === 'hobkin.read').length, 1)
  await mounted.unmount()
})

test('a page opened again reads nothing it holds, and has its turns drawn before any answer', async () => {
  const before = asked.length
  const seen: { first: Page | null; page: Page | null } = { first: null, page: null }
  const Shown = () => {
    const page = usePage(ID, summary)
    seen.first ??= page
    seen.page = page
    return null
  }
  const mounted = await mountCounting(() => createElement(Shown))
  assert.equal(seen.first?.read, true, 'its conversation, from the first draw')
  assert.deepEqual(seen.page?.drawn, [run(TURNS), run(TURNS - 1)])
  assert.equal(seen.page?.settled, true)
  assert.deepEqual(asked.slice(before), [], 'no read of the conversation nor of a turn')

  // Its conversation changed: it is read again, and only that.
  await mounted.unmount()
  const later = { ...summary, last: { status: 'completed' as const, said: 'More.', at: '2026-11-26T11:00:00.000Z' } }
  const { mounted: again } = await openPage(later)
  assert.deepEqual(asked.slice(before).map(({ name }) => name), ['hobkin.read'])
  await again.unmount()
})

test('a page kept hidden keeps its turns watched from outside, and reads nothing when shown again', async () => {
  const watched: string[][] = []
  const stop = onWatchedChange((jobs) => watched.push([...jobs]))
  const show: { set: ((mode: 'visible' | 'hidden') => void) | null } = { set: null }
  const inside = { effects: 0 }
  const Inside = () => {
    usePage(ID, summary)
    useEffect(() => {
      inside.effects += 1
      return () => void (inside.effects -= 1)
    }, [])
    return null
  }
  const Kept = () => {
    const [mode, setMode] = useState<'visible' | 'hidden'>('visible')
    show.set = setMode
    useHeldJobs(useKeptPage(ID).drawn)
    return createElement(Activity, { mode, children: createElement(Inside) })
  }
  const mounted = await mountCounting(() => createElement(Kept))
  await mounted.change(() => {})
  const before = asked.length
  const held = (jobs: readonly string[] | undefined) => Boolean(jobs?.includes(run(TURNS)) && jobs.includes(run(TURNS - 1)))
  assert.ok(held(watched.at(-1)), 'its turns are watched')
  const changes = watched.length

  await mounted.change(() => show.set!('hidden'))
  assert.equal(inside.effects, 0, 'hidden, the page runs no effects')
  assert.equal(watched.length, changes, 'and its turns stay watched')
  await mounted.change(() => show.set!('visible'))
  await mounted.change(() => {})
  assert.equal(inside.effects, 1)
  assert.equal(watched.length, changes, 'shown again, nothing changes for the host')
  assert.deepEqual(asked.slice(before), [], 'nothing read again on show')
  stop()
  await mounted.unmount()
})

test('the page being left stays until the next one is ready, or for HOLD_MS at most, and a page kept shows at once', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  try {
    const seen: { pages: ReturnType<typeof useShownPage> | null; ask: ((agent: string | null) => void) | null } = { pages: null, ask: null }
    const Frame = ({ keep }: { keep: number }) => {
      const [asked, setAsked] = useState<string | null>('a')
      seen.ask = setAsked
      seen.pages = useShownPage(asked, { keep, frozen: false })
      return null
    }
    const mounted = await mountCounting(() => createElement(Frame, { keep: 2 }))
    const pages = () => seen.pages!
    assert.equal(pages().shown, 'a', 'the first page shows at once')
    assert.equal(pages().preparing, null)

    await mounted.change(() => seen.ask!('b'))
    assert.equal(pages().shown, 'a', 'the page being left stays')
    assert.equal(pages().preparing, 'b')
    await mounted.change(() => pages().ready('b'))
    assert.equal(pages().shown, 'b')
    assert.equal(pages().preparing, null)
    assert.deepEqual(pages().mounted, ['a', 'b'], 'the page left is kept')

    await mounted.change(() => seen.ask!('c'))
    await mounted.change(() => mock.timers.tick(HOLD_MS - 1))
    assert.equal(pages().shown, 'b', 'not ready, within the cap')
    await mounted.change(() => mock.timers.tick(1))
    assert.equal(pages().shown, 'c', 'shown anyway once the cap is over')
    assert.deepEqual(pages().mounted, ['a', 'b', 'c'])

    await mounted.change(() => seen.ask!('a'))
    assert.equal(pages().shown, 'a', 'a kept page shows at once')
    assert.deepEqual(pages().mounted, ['b', 'c', 'a'])
    await mounted.change(() => seen.ask!('d'))
    await mounted.change(() => pages().ready('d'))
    assert.deepEqual(pages().mounted, ['c', 'a', 'd'], 'the last two left are kept')
    await mounted.change(() => seen.ask!(null))
    assert.equal(pages().shown, null, 'no agent: at once')
    await mounted.unmount()
  } finally {
    mock.timers.reset()
  }
})

test('a turn the host holds is known once its whole steps come after the window watched it, not from its tail', async () => {
  hello(true)
  const tail: ActivityEntry[] = [{ id: 'message:t:1', kind: 'assistant', text: 'Done.', at: 1 }]
  const job = run(7)
  send({ type: 'state', rev: rev++, reset: true, set: { runs: [], reports: [] }, activity: [{ op: 'reset', job, entries: tail }] })
  const seen: { known: boolean | null } = { known: null }
  const Turn = () => {
    seen.known = useDrawnSteps(`${ID}-other`, [job], { live: null }).known(job)
    return null
  }
  const mounted = await mountCounting(() => createElement(Turn))
  await mounted.change(() => {})
  assert.equal(seen.known, false, 'its tail is not its steps')
  await mounted.change(() => send({ type: 'state', rev: rev++, activity: [{ op: 'reset', job, entries: [...steps(7, 3), ...tail] }] }))
  assert.equal(seen.known, true)
  await mounted.unmount()
})
