import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { ChatMessage } from '#shared/protocol/snapshot.ts'
import type { Units } from '#shared/review/assessment.ts'
import type { Review } from '#shared/review/types.ts'
import { askHobkin, changeAsk, questionAsk, type AskCommand } from '../src/features/review/panel/ask.ts'
import { atNewest, conversationOf, joinThread, reviewThread, THREAD_LIMIT, THREADS_KEPT, waitingAsks, type ThreadEntry } from '../src/features/review/panel/thread.ts'
import { whatMatters } from '../src/features/review/panel/sidebar.ts'
import { toStepUnit } from '../src/features/review/reading/model.ts'
import { createReviewMemory, memoryStorage } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

const sample = JSON.parse(readFileSync(new URL('../src/features/review/sample/review.json', import.meta.url), 'utf8')) as Review
const units = JSON.parse(readFileSync(new URL('../../packages/change-review/skills/change-review/examples/units.json', import.meta.url), 'utf8')) as Units
const review = { ...sample, id: 'change:hobkin:7d02c9', memoryScope: 'host:/home' } as Review
const about = `Review "${review.change.title}", step 3 of ${review.story.length}`
const message = (id: string, role: ChatMessage['role'], content: string, at: number, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, content, at, ...extra })

/** A host that takes every message, and the calls it got. Nothing is sent anywhere. */
function host(answer: (args: unknown) => { id: string; queued: boolean } = () => ({ id: 'm1', queued: false })) {
  const calls: { name: string; args: unknown }[] = []
  const command: AskCommand = async (name, args) => {
    calls.push({ name, args })
    return answer(args)
  }
  return { command, calls }
}

test("a quick Ask link sends the unit's question, or what would change its level, to hobkin with the step and the node, as the box does", async () => {
  const unit = toStepUnit(units.units[0]!)
  const question = questionAsk(unit, unit.questions[0]!)
  assert.equal(question, 'About "round_money changes its rounding mode for every caller, flag on or off": Is half-even rounding meant to apply to existing totals, or only to per-line tax?')
  const change = changeAsk(unit, unit.wouldChange[1]!)
  assert.equal(
    change,
    'About "round_money changes its rounding mode for every caller, flag on or off": the change review says this would make it safe: Also branch on `:per_line_tax_rounding` at `round_money:35`, keeping the old line as the flag-off path. How would we do it?',
  )
  assert.match(changeAsk(unit, unit.wouldChange[0]!), /would make it mid risk: Add a job test/)
  // Words that end without a stop get one, and a unit with no claim is asked about as it is.
  assert.equal(questionAsk({}, { text: 'Who reads the old key' }), 'Who reads the old key.')

  const session = createSession(review, createReviewMemory(memoryStorage()))
  session.getState().goTo(4)
  const step = review.story[4]!
  // The step has two nodes in focus, and the code panel shows the second.
  const shown = step.focus[1]!
  const { command, calls } = host()

  // A link in the code panel names the node whose code is shown.
  assert.equal(await askHobkin(session, command, question, { node: shown }), true)
  assert.deepEqual(calls, [{ name: 'conversation.send', args: { text: question, review: { id: review.id, step: step.id, node: shown } } }])
  // The box names the node the reviewer is on: the one they pointed at, else the first in focus. Its words are trimmed.
  assert.equal(await askHobkin(session, command, '  Why here?  '), true)
  assert.deepEqual(calls.at(-1)?.args, { text: 'Why here?', review: { id: review.id, step: step.id, node: step.focus[0] } })
  // Nothing goes without words.
  assert.equal(await askHobkin(session, command, '   '), false)
  assert.equal(calls.length, 2)

  // Each message shows at once in the review's conversation, and the panel stays open while the reviewer talks.
  assert.deepEqual(session.getState().asks.map((ask) => [ask.text, ask.state]), [[question, 'taken'], ['Why here?', 'taken']])
  assert.equal(session.getState().talking, true)
  session.getState().setTalking(false)
  assert.equal(session.getState().talking, false)
})

test('a message hobkin cannot take says why and stays in the conversation, and a queued one says it waits', async () => {
  const session = createSession(review, createReviewMemory(memoryStorage()))
  const failing: AskCommand = async () => {
    throw new Error('hobkin is not running.')
  }
  assert.equal(await askHobkin(session, failing, 'Is this safe?'), false)
  assert.deepEqual(session.getState().asks.map(({ text, state, error }) => ({ text, state, error })), [{ text: 'Is this safe?', state: 'failed', error: 'hobkin is not running.' }])
  const { command } = host(() => ({ id: 'm2', queued: true }))
  await askHobkin(session, command, 'And now?')
  assert.equal(session.getState().asks.at(-1)?.state, 'queued')
})

test('the conversation about the review shows what was asked with the replies under it, oldest first as a chat reads, and a reply as hobkin writes it', () => {
  const messages = [
    message('m1', 'user', 'Unrelated.', 1),
    message('m2', 'user', 'Why is the word cleared here?', 3, { about }),
    message('m3', 'assistant', 'Because the turn ended.', 4),
    message('m4', 'assistant', 'And the next turn starts empty.', 5),
    message('m5', 'user', 'Is that tested?', 6, { about }),
  ]
  const thread = reviewThread(messages, review.change.title)
  const lines = (exchanges: ReturnType<typeof conversationOf>) => exchanges.map((exchange) => exchange.lines.map((line) => [line.who, line.text, line.state ?? null]))

  // hobkin is answering the newest question: its reply shows as it is written, under that question.
  const writing = conversationOf({ thread, asks: [], writing: 'Yes, in test/doing.test.mjs', busy: true })
  assert.deepEqual(lines(writing), [
    [['you', 'Why is the word cleared here?', null], ['hobkin', 'Because the turn ended.', null], ['hobkin', 'And the next turn starts empty.', null]],
    [['you', 'Is that tested?', null], ['hobkin', 'Yes, in test/doing.test.mjs', 'writing']],
  ])
  assert.deepEqual(writing.map((exchange) => exchange.waiting), [false, false])
  // Before its first word, the question waits for hobkin.
  assert.deepEqual(conversationOf({ thread, asks: [], writing: null, busy: true }).map((exchange) => exchange.waiting), [false, true])

  // A question just sent shows at once, before the conversation stores it.
  const asks = [{ key: 'a1', text: 'And the third case?', at: 10, state: 'sending' as const }]
  const sent = conversationOf({ thread, asks, writing: null, busy: true })
  assert.deepEqual(lines(sent).at(-1), [['you', 'And the third case?', 'sending']])
  assert.equal(sent.at(-1)!.waiting, true)
  // Once the conversation shows it, it is the stored one that shows, once.
  const stored = reviewThread([...messages, message('m6', 'user', 'And the third case?', 11, { about })], review.change.title)
  assert.deepEqual(waitingAsks(asks, stored), { waiting: [], settled: ['a1'] })
  assert.deepEqual(waitingAsks(asks, thread), { waiting: asks, settled: [] }, 'a message stored before it was sent is not its copy')
  // One that failed says why, and waits for nothing.
  const failed = conversationOf({ thread: [], asks: [{ ...asks[0]!, state: 'failed', error: 'hobkin is not running.' }], writing: null, busy: false })
  assert.deepEqual(failed.map((exchange) => [exchange.waiting, exchange.lines[0]!.error]), [[false, 'hobkin is not running.']])
})

test('the conversation comes back when the review opens again, after the chat has moved on, been cleared, or the review was built again', () => {
  const messages = [
    message('m1', 'user', 'Why is the word cleared here?', 3, { about }),
    message('m2', 'assistant', 'Because the turn ended.', 4),
    message('m3', 'user', 'Thanks, something else.', 5),
    message('m4', 'assistant', 'Sure.', 6),
  ]
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  memory.getState().keepThread(review, reviewThread(messages, review.change.title))

  // hobkin keeps only its last hundred messages, and the chat can be cleared: the review keeps its own copy.
  const later = reviewThread(messages.slice(2), review.change.title)
  assert.deepEqual(later, [])
  const restarted = createReviewMemory(storage)
  const rebuilt = { ...review, snapshot: 'f'.repeat(64) } as Review
  const kept = joinThread(restarted.getState().threadOf(rebuilt), later)
  assert.deepEqual(kept.map((entry) => [entry.id, entry.who]), [['m1', 'you'], ['m2', 'hobkin']])

  // Kept again with more, nothing doubles, it stays in order, and only the newest are kept.
  const more: ThreadEntry[] = [{ id: 'm2', who: 'hobkin', text: 'Because the turn ended.', at: 4 }, { id: 'm9', who: 'you', text: 'And then?', at: 9 }]
  restarted.getState().keepThread(rebuilt, more)
  assert.deepEqual(restarted.getState().threadOf(review).map((entry) => entry.id), ['m1', 'm2', 'm9'])
  const many = Array.from({ length: THREAD_LIMIT + 10 }, (_, index) => ({ id: `x${index}`, who: 'you' as const, text: 'x', at: index }))
  assert.deepEqual(joinThread([], many).map((entry) => entry.id), many.slice(10).map((entry) => entry.id))
  // Only the reviews talked about last keep theirs, so the browser's storage stays small.
  for (let index = 0; index < THREADS_KEPT; index += 1) restarted.getState().keepThread({ ...review, id: `change:hobkin:r${index}` } as Review, [{ id: `r${index}`, who: 'you', text: 'x', at: 100 + index }])
  assert.deepEqual(restarted.getState().threadOf(review), [], 'the one talked about longest ago gave way')
  assert.equal(restarted.getState().threadOf({ ...review, id: 'change:hobkin:r0' } as Review).length, 1)
  // Another review, or the same one from another host, has its own conversation.
  assert.deepEqual(restarted.getState().threadOf({ ...review, id: 'change:hobkin:other' } as Review), [])
  assert.deepEqual(restarted.getState().threadOf({ ...review, memoryScope: 'sample' } as Review), [])
})

test('a message sent from the review is kept with the review at once, comes back when the review opens again, and shows once when the conversation has it', async () => {
  const storage = memoryStorage()
  const memory = createReviewMemory(storage)
  const session = createSession(review, memory)
  const keep = (entry: ThreadEntry) => memory.getState().keepThread(review, [entry])
  const lines = (thread: readonly ThreadEntry[], asks = session.getState().asks) =>
    conversationOf({ thread, asks, writing: null, busy: false }).map((exchange) => exchange.lines.map((line) => [line.who, line.text, line.state ?? null]))

  // hobkin is busy: it takes the message, to read after what it is doing. The review keeps it at once.
  const { command } = host(() => ({ id: 'm1', queued: true }))
  assert.equal(await askHobkin(session, command, 'Why here?', { keep }), true)
  const kept = memory.getState().threadOf(review)
  assert.deepEqual(kept.map(({ who, text }) => [who, text]), [['you', 'Why here?']])
  // While the review is open it shows once, with where it stands.
  assert.deepEqual(lines(kept), [[['you', 'Why here?', 'queued']]])

  // The review closes, the window starts again, and the review opens again: the message is still there.
  const reopened = createReviewMemory(storage)
  assert.deepEqual(lines(reopened.getState().threadOf(review), []), [[['you', 'Why here?', null]]])

  // hobkin's conversation shows it, with a reply: it shows once, with the reply under it.
  const sentAt = kept[0]!.at
  reopened.getState().keepThread(review, reviewThread([message('m7', 'user', 'Why here?', sentAt + 5, { about }), message('m8', 'assistant', 'Because the turn ended.', sentAt + 9)], review.change.title))
  assert.deepEqual(lines(reopened.getState().threadOf(review), []), [[['you', 'Why here?', null], ['hobkin', 'Because the turn ended.', null]]])
  // The message it stood for is no message still on its way.
  assert.deepEqual(waitingAsks(session.getState().asks, reopened.getState().threadOf(review)).waiting, [])

  // A message the conversation never stored takes no other message's place: the next one shows once, and it stays.
  const later = { id: 'm9', who: 'you' as const, text: 'And the cache key?', at: sentAt + 50 }
  const lost = [{ id: 'sent:1:ask9', who: 'you' as const, text: 'Never stored.', at: 1 }, ...reopened.getState().threadOf(review), { id: `sent:${sentAt + 40}:ask8`, who: 'you' as const, text: 'And the cache key?', at: sentAt + 40 }, later]
  assert.deepEqual(lines(lost, []).flat().map(([, text]) => text), ['Never stored.', 'Why here?', 'Because the turn ended.', 'And the cache key?'])

  // A message that did not go is not kept: it waits in the open review to be sent again.
  const failing: AskCommand = async () => {
    throw new Error('hobkin is not running.')
  }
  assert.equal(await askHobkin(session, failing, 'Lost?', { keep }), false)
  assert.equal(memory.getState().threadOf(review).some((entry) => entry.text === 'Lost?'), false)
  // Another review keeps its own.
  assert.deepEqual(memory.getState().threadOf({ ...review, id: 'change:hobkin:other' } as Review), [])
})

test("a quick link in what matters sends its words to hobkin as the box does: with the step and the node, shown at once, and kept", async () => {
  const memory = createReviewMemory(memoryStorage())
  const session = createSession(review, memory)
  session.getState().goTo(4)
  const step = review.story[4]!
  const matters = whatMatters(review, { story: '', summary: { level: 'high', critical: false, needsYou: 1, worthALook: 0, safe: 0, storyBy: 'host', at: '' }, units }, review.story, [])
  const words = matters.units[0]!.asks
  const { command, calls } = host()

  assert.equal(await askHobkin(session, command, words, { keep: (entry) => memory.getState().keepThread(review, [entry]) }), true)
  assert.deepEqual(calls, [{ name: 'conversation.send', args: { text: words, review: { id: review.id, step: step.id, node: step.focus[0] } } }])
  // It is in the conversation under the box at once, the panel stays open while the reviewer talks, and the review keeps it.
  assert.deepEqual(session.getState().asks.map(({ text }) => text), [words])
  assert.equal(session.getState().talking, true)
  assert.deepEqual(memory.getState().threadOf(review).map(({ text }) => text), [words])
})

test('the conversation keeps to its newest reply while the reviewer reads there, and stays where they scrolled up to', () => {
  // At the foot, or within a few pixels of it: the next reply scrolls into view.
  assert.equal(atNewest({ scrollTop: 600, scrollHeight: 900, clientHeight: 300 }), true)
  assert.equal(atNewest({ scrollTop: 590, scrollHeight: 900, clientHeight: 300 }), true)
  // Scrolled up to read something older: it stays there.
  assert.equal(atNewest({ scrollTop: 400, scrollHeight: 900, clientHeight: 300 }), false)
  // A conversation shorter than its box is always at its newest.
  assert.equal(atNewest({ scrollTop: 0, scrollHeight: 200, clientHeight: 300 }), true)
})
