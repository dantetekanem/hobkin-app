import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextReveal } from '../src/features/chat/stream-buffer.ts'

/** Everything shown of `text` while it is still being written, one look after another, until nothing more shows. */
const settle = (text: string, shown = '') => {
  for (let next = nextReveal(text, shown, false); next !== shown; next = nextReveal(text, shown, false)) shown = next
  return shown
}

test('a reply shows a finished line at a time, never the line still being written', () => {
  assert.equal(nextReveal('Hel', '', false), '')
  assert.equal(nextReveal('First line.\nSecond li', '', false), 'First line.\n')
  assert.equal(settle('First line.\nSecond li'), 'First line.\n')
  assert.equal(settle('- one\n- two\n- th'), '- one\n- two\n')
  // A blank line changes nothing on screen, so it waits for what follows it.
  assert.equal(settle('Para.\n\n'), 'Para.\n')
})

test('a code block waits for its first line, then grows a line at a time until it closes', () => {
  assert.equal(settle('Look:\n\n```ts\n'), 'Look:\n')
  assert.equal(settle('Look:\n\n```ts\nconst a = 1\n'), 'Look:\n\n```ts\nconst a = 1\n')
  assert.equal(settle('Look:\n\n```ts\nconst a = 1\nconst b = 2\n``'), 'Look:\n\n```ts\nconst a = 1\nconst b = 2\n')
  // A table header inside a code block is only code.
  assert.equal(settle('```\n| a | b |\n'), '```\n| a | b |\n')
  assert.equal(settle('```\nx\n```\nAfter.\n'), '```\nx\n```\nAfter.\n')
})

test('a table appears with its header and divider together, then a row at a time', () => {
  assert.equal(settle('Steps:\n\n| A | B |\n'), 'Steps:\n')
  assert.equal(settle('| A | B |\n| --- | --- |\n'), '| A | B |\n| --- | --- |\n')
  assert.equal(settle('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 |'), '| A | B |\n| --- | --- |\n| 1 | 2 |\n')
})

test('far behind, several lines show at once; caught up, one at a time', () => {
  const lines = Array.from({ length: 12 }, (_, index) => `Line ${index}.\n`)
  const text = lines.join('')
  assert.equal(nextReveal(text, '', false), lines.slice(0, 3).join(''))
  assert.equal(nextReveal(text, lines.slice(0, 10).join(''), false), lines.slice(0, 11).join(''))
})

test('when the reply ends or fails, everything shows at once, the unfinished last line too', () => {
  assert.equal(nextReveal('a\nb', 'a\n', true), 'a\nb')
  assert.equal(nextReveal('```ts\nconst a', '', true), '```ts\nconst a')
})

test('text the model rewrote goes back to what both versions agree on', () => {
  assert.equal(nextReveal('One.\nTwo!\nThree.\n', 'One.\nTwo.\n', false), 'One.\nTwo!\n')
})

test('no character is lost and the order holds, however the text arrives', () => {
  const reply = [
    '## Plan',
    '',
    'Ship on **Friday** after the review.',
    '',
    '- Tag the build',
    '- Tell the team',
    '',
    '| Step | Owner |',
    '| --- | --- |',
    '| Tag | hobkin |',
    '',
    '```ts',
    'const tag = "v1"',
    '```',
    '',
    'Done, nearly',
  ].join('\n')
  // A fixed spread of chunk sizes, as a model sends them: single letters, words, whole lines.
  const sizes = [1, 3, 7, 2, 19, 1, 5, 40, 4, 11]
  let text = ''
  let shown = ''
  for (let at = 0, step = 0; at < reply.length; at += sizes[step++ % sizes.length]!) {
    text = reply.slice(0, at + sizes[step % sizes.length]!)
    const next = nextReveal(text, shown, false)
    assert.ok(text.startsWith(next), 'what shows is always the start of what arrived')
    assert.ok(next.startsWith(shown), 'nothing shown goes away while the text only grows')
    assert.ok(next === '' || next.endsWith('\n'), 'nothing shows of a line still being written')
    assert.doesNotMatch(next, /```ts\n$/, 'an empty code block is never drawn')
    assert.doesNotMatch(next, /\| Owner \|\n$/, 'a table header never shows without its divider')
    shown = next
  }
  assert.equal(nextReveal(reply, shown, true), reply)
})
