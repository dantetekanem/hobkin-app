import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bubbleNow, doingWords, GREETING_MS, GREETINGS, LEARNING_TIP, nextBubbleChange, pickFrom, reminderChoices, TIP_QUIET_MS, TIP_SLOT_MS, tipAt, tipChoices, tipWindow, TIPS } from '../src/features/chat/bubble.ts'

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

test('tips are brief, irregular and spread out, and each slot gives the same answer all the way through', () => {
  const windows = Array.from({ length: 60 }, (_, slot) => tipWindow(slot))
  const shown = windows.filter((window) => window !== null)
  assert.ok(shown.length > 20 && shown.length < 55, 'some slots stay quiet')
  for (const [slot, window] of windows.entries()) {
    if (!window) continue
    assert.ok(window.start >= slot * TIP_SLOT_MS + TIP_QUIET_MS, 'never right after the last one')
    assert.ok(window.end - window.start <= 15000 && window.end - window.start >= 6000, 'brief')
    assert.ok(window.end <= (slot + 1) * TIP_SLOT_MS)
  }
  assert.ok(new Set(shown.map((window) => window.start % TIP_SLOT_MS)).size > 10, 'the moment moves from slot to slot')

  const first = windows.findIndex((window) => window !== null)
  const window = windows[first]!
  assert.equal(tipAt(TIPS, window.start - 1), '')
  assert.equal(tipAt(TIPS, window.start), pickFrom(TIPS, first))
  assert.equal(tipAt(TIPS, window.end - 1), pickFrom(TIPS, first))
  assert.equal(tipAt(TIPS, window.end), '')
  assert.equal(tipAt([], window.start), '')
})

test('usage tips teach working shortcuts and never mix in report reminders', () => {
  const attention = [
    { title: 'Weekly deps', read: 1, reports: 6, ignored: true },
    { title: 'Inbox sweep', read: 5, reports: 5, ignored: false },
  ]
  assert.deepEqual(tipChoices({ learning: false }), [...TIPS, LEARNING_TIP])
  assert.deepEqual(tipChoices({ learning: true }), [...TIPS])
  assert.deepEqual(reminderChoices({ reportAttention: attention }), ['Weekly deps: 1 of 6 reports opened. Revisit it?'])
  assert.deepEqual(reminderChoices({}), [])
  assert.ok(TIPS.every((tip) => !/\bTab\b/.test(tip)), 'Tab is not for switching pages')
  assert.ok(TIPS.some((tip) => tip.includes('Ctrl+Option+P')) && TIPS.some((tip) => tip.includes('Cmd+K')))
  assert.ok(TIPS.every((tip) => !/\/(?!help\b|clear\b|reset\b|learning\b)[a-z]+/.test(tip)), 'tips name only slash commands the app has')
})

test('the bubble says what hobkin is doing, greets, or gives a tip or reminder, and stays out of the way of typing', () => {
  const openedAt = 10 * TIP_SLOT_MS
  const idle = { doing: null, typing: false, line: null, userName: null, openedAt }
  assert.deepEqual(bubbleNow({ ...idle, doing: 'thinking', typing: true, now: openedAt }), { kind: 'doing', text: "I'm thinking…" })
  assert.equal(bubbleNow({ ...idle, doing: 'thinking', line: 'problem', now: openedAt }), null)
  assert.deepEqual(bubbleNow({ ...idle, userName: 'Sam', now: openedAt + 1000 }), { kind: 'greeting', text: pickFrom(GREETINGS, Math.floor(openedAt / 1000))('Sam') })
  assert.equal(bubbleNow({ ...idle, userName: 'Sam', now: openedAt + GREETING_MS + 1 }), null)

  const slot = tipWindow(11) ? 11 : 12
  const at = tipWindow(slot)!.start
  assert.deepEqual(bubbleNow({ ...idle, now: at }), { kind: 'tip', text: tipAt(TIPS, at) })
  assert.equal(bubbleNow({ ...idle, typing: true, now: at }), null)
  assert.equal(bubbleNow({ ...idle, line: 'reason', now: at }), null)
  assert.equal(bubbleNow({ ...idle, line: 'said', now: at }), null)

  // A reminder takes some windows, labelled as a reminder, and a tip the rest.
  const kinds = new Set<string>()
  for (let n = 0; n < 60; n += 1) {
    const window = tipWindow(n)
    if (window) kinds.add(bubbleNow({ ...idle, reminders: ['Weekly deps: 1 of 6 reports opened. Revisit it?'], now: window.start })!.kind)
  }
  assert.deepEqual([...kinds].sort(), ['reminder', 'tip'])
})

test('the bubble looks again only when a greeting or a tip window starts or ends', () => {
  const openedAt = 10 * TIP_SLOT_MS
  assert.equal(nextBubbleChange(openedAt, openedAt), openedAt + GREETING_MS, 'the greeting ends first')
  const window = tipWindow(30)!
  assert.equal(nextBubbleChange(window.start - 5, 0), window.start)
  assert.equal(nextBubbleChange(window.start, 0), window.end)
  const after = nextBubbleChange(window.end, 0)
  assert.ok(after > window.end && after <= 33 * TIP_SLOT_MS, 'a quiet slot is skipped')
})

test('while a stop waits for its answer the row says so and the doing bubble gives way', () => {
  const openedAt = 0
  assert.equal(bubbleNow({ doing: 'thinking', typing: false, line: 'stopping', userName: null, openedAt, now: 1_000 }), null)
})
