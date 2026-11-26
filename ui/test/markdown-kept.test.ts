import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { GrowingMarkdown, Markdown } from '../src/features/chat/markdown.ts'
import { drawnOnce, KEPT_CHARS, KEPT_TEXTS, keptSize, LONGEST_KEPT } from '../src/features/chat/markdown-kept.ts'

/** A drawing that counts the texts it draws. Each one starts the kept trees over, as a hot update of `markdown.ts` does. */
function counting() {
  const drawn: string[] = []
  const draw = (text: string): ReactElement => {
    drawn.push(text)
    return createElement('p', null, text)
  }
  return { drawn, draw }
}

const REPLY = '## Plan\n\nShip on **Friday**, after [the review](https://hobkin.dev/review), from `~/Poetry/hobkin`.\n\n- Tag the build\n- Tell the team\n\n```ts\nconst tag = "v1"\n```'

test('a text drawn again is not parsed again, and draws the same', () => {
  const { drawn, draw } = counting()

  const first = drawnOnce('one', draw)
  const again = drawnOnce('one', draw)

  assert.equal(again, first)
  assert.deepEqual(drawn, ['one'])
})

test("a message drawn again is the tree its first draw made, and so is an agent's words once they rest", () => {
  const drawMessage = Markdown.type

  const tree = drawMessage({ text: REPLY })
  const html = renderToStaticMarkup(createElement(Markdown, { text: REPLY }))

  // A page opened again, or a row drawn again.
  assert.equal(drawMessage({ text: REPLY }), tree)
  assert.equal(renderToStaticMarkup(createElement(Markdown, { text: REPLY })), html)
  assert.match(html, /<h2[^>]*>Plan<\/h2>/)
  assert.match(html, /data-file="~\/Poetry\/hobkin"/)
  assert.equal(renderToStaticMarkup(createElement(GrowingMarkdown, { text: REPLY, whole: true })), html)
  assert.equal(keptSize().texts, 1)
})

test('the kept texts are bounded by count, the least lately used going first', () => {
  const { drawn, draw } = counting()
  for (let at = 0; at < KEPT_TEXTS; at += 1) drawnOnce(`text ${at}`, draw)

  // Used again, the first text is the newest, so one more pushes out the second.
  drawnOnce('text 0', draw)
  drawnOnce('one more', draw)
  drawnOnce('text 0', draw)
  drawnOnce('text 1', draw)

  assert.equal(keptSize().texts, KEPT_TEXTS)
  assert.deepEqual(drawn.slice(KEPT_TEXTS), ['one more', 'text 1'])
})

test('the kept texts are bounded by their characters, and a text too long to keep pushes nothing out', () => {
  const { drawn, draw } = counting()
  const long = (at: number) => `${at}`.padEnd(LONGEST_KEPT, '.')
  const fit = KEPT_CHARS / LONGEST_KEPT

  for (let at = 0; at <= fit; at += 1) drawnOnce(long(at), draw)
  const drawnBefore = drawn.length
  drawnOnce(long(fit), draw)
  drawnOnce(long(0), draw)

  assert.ok(keptSize().chars <= KEPT_CHARS)
  assert.deepEqual(drawn.slice(drawnBefore), [long(0)])

  const kept = keptSize()
  const huge = 'x'.repeat(LONGEST_KEPT + 1)
  drawnOnce(huge, draw)
  drawnOnce(huge, draw)

  assert.equal(drawn.filter((text) => text === huge).length, 2)
  assert.deepEqual(keptSize(), kept)
})

test('words still being written are not kept', () => {
  renderToStaticMarkup(createElement(Markdown, { text: 'warm' }))
  const kept = keptSize()

  // Every piece of an agent's reply as it arrives: its blocks parse again each time.
  for (let at = 1; at <= REPLY.length; at += 7) renderToStaticMarkup(createElement(GrowingMarkdown, { text: REPLY.slice(0, at) }))

  assert.deepEqual(keptSize(), kept)
})

test('a new drawing does not draw with the trees of the old one', () => {
  const old = counting()
  drawnOnce('one', old.draw)

  // A hot update of `markdown.ts` draws with new components: what the old ones drew is not shown again.
  const updated = counting()
  drawnOnce('one', updated.draw)

  assert.deepEqual(updated.drawn, ['one'])
  assert.equal(keptSize().texts, 1)
})
