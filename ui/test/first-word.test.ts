import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { after, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import type { CommandName } from '#shared/commands/registry.ts'
import type { ClientMessage, HelloMessage } from '#shared/protocol/messages.ts'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { ShownFacts } from '#shared/protocol/timings.ts'
import { createFirstWord, type FirstWordState } from '../src/features/chat/first-word.ts'
import { HostConnection } from '../src/lib/host/connection.ts'
import { hostStore, reportShown } from '../src/lib/host/client.ts'
import type { LiveTurn } from '../src/lib/host/live.ts'
import { applyHostMessage, applyLink, initialHostState, sentAtArg } from '../src/lib/host/state.ts'

const aliasHooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('@/')) return nextResolve(specifier, context)
    return nextResolve(pathToFileURL(resolve(import.meta.dirname, '../src', specifier.slice(2))).href, context)
  },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } } })
after(() => {
  Reflect.deleteProperty(globalThis, 'window')
  aliasHooks.deregister()
})
const { useChat } = await import('../src/features/chat/chat-store.ts')
const { emptyDraft } = await import('../src/features/chat/draft.ts')

const SENT_AT = Date.parse('2026-11-14T10:00:00Z')
const stored = (id: string, content: string, role: ChatMessage['role'] = 'assistant'): ChatMessage => ({ id, role, content, at: SENT_AT - 60000 })
/** hobkin waiting for the user, with one reply of an earlier turn on screen. */
const idle: FirstWordState = { link: 'open', epoch: 1, timings: true, snapshot: { busy: false }, live: null, messages: [stored('m0', 'An earlier reply.')] }
const answering = (state: Partial<FirstWordState> = {}): FirstWordState => ({ ...idle, snapshot: { busy: true }, ...state })
const writing = (...blocks: string[]): LiveTurn => ({ known: ['m0'], replies: [{ serial: 0, blocks, done: false }], opened: 1 })

/** A measure on a clock the test moves, with frames the test paints. */
function measuring() {
  let clock = SENT_AT
  const frames: (() => void)[] = []
  const reports: ShownFacts[] = []
  const firstWord = createFirstWord({ now: () => clock, afterPaint: (then) => void frames.push(then), report: (facts) => void reports.push(facts) })
  return {
    firstWord,
    reports,
    at: (ms: number) => void (clock = SENT_AT + ms),
    paint: () => frames.splice(0).forEach((then) => then()),
  }
}

test('a message that starts its own turn reports, once, when the first words of the reply arrived and when they showed', () => {
  const { firstWord, reports, at, paint } = measuring()
  const measure = firstWord.sent(SENT_AT, idle)
  firstWord.accepted(measure, { id: 'run-1', queued: false })
  at(120)
  firstWord.observe(answering())
  at(300)
  firstWord.observe(answering({ live: writing('') }))
  firstWord.observe(answering({ live: writing('  ') }))
  at(310)
  firstWord.observe(answering({ live: writing('Hel') }))
  at(450)
  firstWord.drawn('live:0')
  firstWord.drawn('live:0')
  assert.deepEqual(reports, [], 'nothing before the frame')
  at(466)
  paint()
  assert.deepEqual(reports, [{ id: 'run-1', arrivedMs: 310, shownMs: 466 }])

  at(900)
  firstWord.observe(answering({ live: writing('Hello\nThere') }))
  firstWord.drawn('live:0')
  paint()
  assert.equal(reports.length, 1, 'once per turn')
})

test("words that come before the host's answer count, and are reported once it answers", () => {
  const { firstWord, reports, at, paint } = measuring()
  const measure = firstWord.sent(SENT_AT, idle)
  at(40)
  firstWord.observe(answering({ live: writing('Done.') }))
  at(60)
  firstWord.drawn('live:0')
  paint()
  assert.deepEqual(reports, [])
  at(90)
  firstWord.accepted(measure, { id: 'run-2', queued: false })
  assert.deepEqual(reports, [{ id: 'run-2', arrivedMs: 40, shownMs: 60 }])
})

test('a message that steers a running turn, or one sent while hobkin answers or a reply is on its way, is not measured', () => {
  const { firstWord, reports, paint } = measuring()
  const steering = firstWord.sent(SENT_AT, idle)
  firstWord.observe(answering({ live: writing('Hello') }))
  firstWord.drawn('live:0')
  paint()
  firstWord.accepted(steering, { id: 'run-1', queued: true })
  assert.equal(firstWord.sent(SENT_AT, answering()), null, 'hobkin answering')
  assert.equal(firstWord.sent(SENT_AT, { ...idle, live: writing('Hel') }), null, 'a reply still on its way')
  assert.deepEqual(reports, [])
})

test('nothing is measured without a host that takes timings', () => {
  const { firstWord } = measuring()
  assert.equal(firstWord.sent(SENT_AT, { ...idle, timings: false }), null)
  assert.equal(firstWord.sent(SENT_AT, { ...idle, link: 'lost' }), null)
})

test("a reply with no words reports nothing, and a later turn's words are not taken for it", () => {
  const { firstWord, reports, at, paint } = measuring()
  firstWord.accepted(firstWord.sent(SENT_AT, idle), { id: 'run-1', queued: false })
  firstWord.observe(answering())
  firstWord.observe(answering({ live: writing() }))
  // Stopped, failed or only tools: the turn ends with nothing said.
  firstWord.observe(idle)
  at(5000)
  firstWord.observe(answering({ live: writing('A routine woke me.') }))
  firstWord.drawn('live:0')
  paint()
  assert.deepEqual(reports, [])
})

test('only the new reply counts as shown: an earlier one drawn again does not, and one stored before it was drawn live does', () => {
  const { firstWord, reports, at, paint } = measuring()
  firstWord.accepted(firstWord.sent(SENT_AT, idle), { id: 'run-3', queued: false })
  at(200)
  const reply = { ...idle, snapshot: { busy: false }, messages: [...idle.messages, stored('u1', 'Plan the week', 'user'), stored('m1', 'Monday first.')] }
  firstWord.observe(reply)
  at(250)
  for (const key of ['m0', 'u1', 'local:note:1']) firstWord.drawn(key)
  paint()
  assert.deepEqual(reports, [], 'an earlier reply, the message itself and a note of the window')
  firstWord.drawn('m1')
  at(270)
  paint()
  assert.deepEqual(reports, [{ id: 'run-3', arrivedMs: 200, shownMs: 270 }])
})

test('a refused send, a reconnect and a turn the host would not keep the times of report nothing', () => {
  const { firstWord, reports, at, paint } = measuring()
  const refused = firstWord.sent(SENT_AT, idle)
  firstWord.refused(refused)
  firstWord.accepted(refused, { id: 'run-1', queued: false })
  firstWord.observe(answering({ live: writing('Hi') }))
  firstWord.drawn('live:0')
  paint()

  firstWord.accepted(firstWord.sent(SENT_AT, idle), { id: 'run-2', queued: false })
  firstWord.observe(answering({ epoch: 2, live: writing('Hi') }))
  firstWord.drawn('live:0')
  paint()

  // The window's clock went back while the reply came.
  firstWord.accepted(firstWord.sent(SENT_AT, idle), { id: 'run-3', queued: false })
  at(-50)
  firstWord.observe(answering({ live: writing('Hi') }))
  firstWord.drawn('live:0')
  paint()
  assert.deepEqual(reports, [])
})

const hello = (timings: boolean): HelloMessage => ({
  type: 'hello', protocol: 1, home: '/isolated', model: 'scripted', owner: { state: 'live', limits: { images: 4, imageBytes: 1_000_000 } },
  signIn: { status: 'signed-in' }, models: null, viewState: null, ...(timings ? { timings: true as const } : {}),
})

test("the window holds the host's word that it takes timings only from that host's hello, and forgets it when the connection goes", () => {
  const taking = applyHostMessage(initialHostState, hello(true))
  assert.equal(taking.timings, true)
  assert.equal(applyHostMessage(taking, hello(false)).timings, false, 'a host from before says nothing')
  assert.equal(applyLink(taking, 'lost').timings, false)
  assert.deepEqual(sentAtArg(taking, SENT_AT), { sentAt: SENT_AT })
  assert.deepEqual(sentAtArg(initialHostState, SENT_AT), {})
})

test('a host that did not say it takes timings is sent no sentAt and no shown message; one that did gets both', async (t) => {
  const commands: { name: CommandName; args: unknown; resolve(value: unknown): void }[] = []
  const sent: ClientMessage[] = []
  t.mock.method(HostConnection.prototype, 'command', (name: CommandName, args: unknown) => new Promise((resolve) => commands.push({ name, args, resolve })))
  t.mock.method(HostConnection.prototype, 'send', (message: ClientMessage) => (sent.push(message), true))
  const sendDraft = async (text: string) => {
    useChat.setState({ draft: { ...emptyDraft, text }, problem: null })
    const sending = useChat.getState().send()
    const call = commands.find(({ name, args }) => name === 'conversation.send' && (args as { text?: string }).text === text)!
    call.resolve({ id: `run-${text}`, queued: false })
    assert.equal(await sending, true)
    return call.args as Record<string, unknown>
  }

  hostStore.setState(applyHostMessage(initialHostState, hello(false)), true)
  assert.deepEqual(await sendDraft('To an older host'), { text: 'To an older host' })
  reportShown({ id: 'run-1', arrivedMs: 300, shownMs: 466 })
  assert.deepEqual(sent.filter(({ type }) => type === 'shown'), [])

  hostStore.setState(applyHostMessage(initialHostState, hello(true)), true)
  const before = Date.now()
  const args = await sendDraft('To a host that takes timings')
  assert.equal(args.text, 'To a host that takes timings')
  assert.ok(typeof args.sentAt === 'number' && args.sentAt >= before && args.sentAt <= Date.now(), 'when the user sent it')
  reportShown({ id: 'run-2', arrivedMs: 300, shownMs: 466 })
  assert.deepEqual(sent.filter(({ type }) => type === 'shown'), [{ type: 'shown', id: 'run-2', arrivedMs: 300, shownMs: 466 }])

  hostStore.setState(initialHostState, true)
  useChat.setState({ draft: emptyDraft, outbox: { ...useChat.getState().outbox, entries: [] } })
})
