import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { after, mock, test } from 'node:test'
import { createElement, useState } from 'react'
import { FEED_STEPS, type ActivityEntry } from '../../shared/protocol/activity.ts'
import type { HostMessage } from '../../shared/protocol/messages.ts'
import { applyHostMessage } from '../src/lib/host/state.ts'
import { mountCounting } from './render-count.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
const { HostConnection } = await import('../src/lib/host/connection.ts')
mock.method(HostConnection.prototype, 'start', () => {
  throw new Error('Connection must stay stopped')
})
/** Each page of older steps the window asks for, and the bytes of the answer. */
const asked: string[] = []
mock.method(HostConnection.prototype, 'command', async (name: string, args: { before: string }) => {
  if (name !== 'activity.before') throw new Error(`Nothing here sends ${name}`)
  asked.push(args.before)
  const at = Number(args.before.slice('tool:'.length))
  return { steps: Array.from({ length: 3 }, (_, index) => step(at - 3 + index)), more: true, found: true }
})
const { hostStore } = await import('../src/lib/host/client.ts')
const { useOlderSteps } = await import('../src/features/agent-activity/older-steps.ts')
after(() => {
  mock.restoreAll()
  Reflect.deleteProperty(globalThis, 'window')
})

const step = (n: number): ActivityEntry => ({ id: `tool:${n}`, kind: 'tool', name: 'bash', state: 'completed', input: '{"command":"true"}', output: '' })
let rev = 1
const send = (message: HostMessage) => hostStore.setState((state) => applyHostMessage(state, message), true)
/** A job's feed, its newest FEED_STEPS steps, ending at step `last`. */
const feedTo = (last: number, job = 'busy') => send({ type: 'state', rev: rev++, activity: [{ op: 'reset', job, entries: Array.from({ length: FEED_STEPS }, (_, index) => step(last - FEED_STEPS + 1 + index)) }] })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

send({ type: 'hello', protocol: 1, home: '/fake/home', model: 'live', models: null, viewState: null, owner: { state: 'live', limits: { images: 4, imageBytes: 1 } }, signIn: { status: 'signed-in' } })
send({ type: 'state', rev: rev++, reset: true, set: { runs: [{ id: 'busy', kind: 'background', state: 'running', title: 'Busy', cwd: '/fake' }, { id: 'whole', kind: 'background', state: 'running', title: 'Whole', cwd: '/fake' }], reports: [], busy: true } })

test('a page whose older steps are out of view asks the host nothing as each tool call lets a step go, and once when they come into view', async () => {
  feedTo(1000)
  let older: ReturnType<typeof useOlderSteps> | null = null
  let show = (_shown: boolean) => {}
  const Page = () => {
    const [shown, setShown] = useState(true)
    show = setShown
    older = useOlderSteps('busy', { follows: shown })
    return null
  }
  const mounted = await mountCounting(() => createElement(Page))
  await mounted.change(() => older!.loadMore())
  await mounted.change(settle)
  assert.deepEqual(asked, ['tool:801'], 'the first page, right before the feed')
  assert.equal(older!.steps.length, 3)

  // The user goes back down: the pages are out of view while tool calls go on.
  await mounted.change(() => show(false))
  for (let last = 1001; last <= 1005; last++) {
    await mounted.change(() => feedTo(last))
    await mounted.change(settle)
  }
  assert.deepEqual(asked, ['tool:801'], 'no page asked for while none of it is in view')

  // Scrolled back up to them: the page right before the feed joins them to it again, once.
  await mounted.change(() => show(true))
  await mounted.change(settle)
  assert.deepEqual(asked, ['tool:801', 'tool:806'])
  await mounted.unmount()
})

test('a page drawn whole asks again at each tool call while it holds older steps, as before', async () => {
  asked.length = 0
  feedTo(2000, 'whole')
  let older: ReturnType<typeof useOlderSteps> | null = null
  const Page = () => {
    older = useOlderSteps('whole')
    return null
  }
  const mounted = await mountCounting(() => createElement(Page))
  await mounted.change(() => older!.loadMore())
  await mounted.change(settle)
  await mounted.change(() => feedTo(2001, 'whole'))
  await mounted.change(settle)
  assert.deepEqual(asked, ['tool:1801', 'tool:1802'])
  await mounted.unmount()
})
