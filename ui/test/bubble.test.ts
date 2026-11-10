import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bubbleNow, doingWords, GREETINGS, LEARNING_TIP, nextBubbleChange, pickFrom, TIP_EVERY_MS, TIP_SHOW_MS, tipAt, tipChoices, TIPS } from '../src/features/chat/bubble.ts'

test("hobkin says what it is doing in its own words, as the terminal's working row does", () => {
  const said = Object.fromEntries(['thinking', 'writing', 'working', 'researching', 'delegating', 'retrying', 'compacting'].map((word) => [word, doingWords(word)]))
  assert.deepEqual(said, {
    thinking: "I'm thinking…",
    writing: "I'm writing…",
    working: "I'm working…",
    researching: "I'm researching…",
    delegating: "I'm handing this to a session…",
    retrying: "I'm trying again…",
    compacting: "I'm compacting our conversation…",
  })
  // A word hobkin adds later still reads as hobkin speaking.
  assert.equal(doingWords('pondering'), "I'm pondering…")
})

test("tips follow the terminal's clock: one tip for the first 30 seconds of every 3 minutes", () => {
  assert.equal(TIP_EVERY_MS, 180000)
  assert.equal(TIP_SHOW_MS, 30000)
  // hobkin's own pick (`src/cli/ui.mjs:223`): the first window shows its second tip.
  assert.equal(tipAt(TIPS, 0), TIPS[1])
  assert.equal(pickFrom(TIPS, 0), TIPS[1])
  // The same tip for the whole window, then nothing until the next one.
  assert.equal(tipAt(TIPS, TIP_SHOW_MS - 1), TIPS[1])
  assert.equal(tipAt(TIPS, TIP_SHOW_MS), '')
  assert.equal(tipAt(TIPS, TIP_EVERY_MS - 1), '')
  assert.equal(tipAt(TIPS, TIP_EVERY_MS), pickFrom(TIPS, 1))
  assert.equal(tipAt([], 0), '')

  // The learning tip joins only while learning is off, and a report the user keeps leaving unread gets its own.
  const attention = [
    { title: 'Weekly deps', read: 1, reports: 6, ignored: true },
    { title: 'Inbox sweep', read: 5, reports: 5, ignored: false },
  ]
  assert.deepEqual(tipChoices({ learning: false, reportAttention: attention }), [...TIPS, LEARNING_TIP, 'Weekly deps: 1 of 6 reports opened. Revisit it?'])
  assert.deepEqual(tipChoices({ learning: true }), [...TIPS])
  assert.ok(TIPS.every((tip) => !/\/(?!help\b|clear\b|reset\b|learning\b)[a-z]+/.test(tip)), 'tips name only slash commands the app has')
})

test('the bubble says what hobkin is doing, greets, or gives a tip, and stays out of the way of typing', () => {
  const openedAt = 10 * TIP_EVERY_MS + 50000
  const idle = { doing: null, typing: false, line: null, userName: null, openedAt }

  // A turn under way: what hobkin is doing, even while the user writes a follow-up.
  assert.deepEqual(bubbleNow({ ...idle, doing: 'thinking', typing: true, now: openedAt }), { kind: 'doing', text: "I'm thinking…" })
  // A problem has the row to itself.
  assert.equal(bubbleNow({ ...idle, doing: 'thinking', line: 'problem', now: openedAt }), null)

  // Opening the window with a name known: hobkin's greeting, for the first 30 seconds.
  assert.deepEqual(bubbleNow({ ...idle, userName: 'Sam', now: openedAt + 1000 }), { kind: 'greeting', text: pickFrom(GREETINGS, Math.floor(openedAt / 1000))('Sam') })
  assert.equal(bubbleNow({ ...idle, userName: 'Sam', now: openedAt + TIP_SHOW_MS + 1 }), null, 'then quiet until a tip is due')

  // Idle, with nothing written: the tip of the window, and nothing between windows.
  const tipTime = 11 * TIP_EVERY_MS + 1000
  assert.deepEqual(bubbleNow({ ...idle, now: tipTime }), { kind: 'tip', text: tipAt(TIPS, tipTime) })
  assert.equal(bubbleNow({ ...idle, now: tipTime + TIP_SHOW_MS }), null)
  // Typing, or a line that explains something, keeps tips and greetings away.
  assert.equal(bubbleNow({ ...idle, typing: true, now: tipTime }), null)
  assert.equal(bubbleNow({ ...idle, line: 'reason', now: tipTime }), null)
  assert.equal(bubbleNow({ ...idle, line: 'said', now: tipTime }), null)
  assert.deepEqual(bubbleNow({ ...idle, tips: [LEARNING_TIP], now: tipTime }), { kind: 'tip', text: LEARNING_TIP })
})

test('the bubble looks again only when a greeting or a tip window starts or ends', () => {
  const openedAt = 10 * TIP_EVERY_MS + 50000
  assert.equal(nextBubbleChange(openedAt, openedAt), openedAt + TIP_SHOW_MS, 'the greeting ends first')
  const later = openedAt + TIP_SHOW_MS
  assert.equal(nextBubbleChange(later, openedAt), 11 * TIP_EVERY_MS, 'then the next tip begins')
  assert.equal(nextBubbleChange(11 * TIP_EVERY_MS + 5, openedAt), 11 * TIP_EVERY_MS + TIP_SHOW_MS, 'and ends')
})
