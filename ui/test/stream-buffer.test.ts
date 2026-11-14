import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextReveal } from '../src/features/chat/stream-buffer.ts'

/** Everything shown of `text` while it is still being written, one look after another, until nothing more shows. */
const settle = (text: string, shown = '') => {
  for (let next = nextReveal(text, shown, false); next !== shown; next = nextReveal(text, shown, false)) shown = next
  return shown
}

test('the line still being written shows up to its last whole word', () => {
  assert.equal(nextReveal('Hel', '', false), '')
  assert.equal(nextReveal('Hello wor', '', false), 'Hello')
  assert.equal(nextReveal('Hello world ', '', false), 'Hello world')
  assert.equal(settle('First line.\nSecond li'), 'First line.\nSecond')
  assert.equal(settle('- one\n- two\n- three ite'), '- one\n- two\n- three')
  // A blank line changes nothing on screen, so it waits for what follows it.
  assert.equal(settle('Para.\n\n'), 'Para.\n')
  assert.equal(settle('Para.\n\nNext wo'), 'Para.\n\nNext')
})

test('a paragraph grows a word at a time, and what showed stays', () => {
  let shown = ''
  for (const [text, expected] of [
    ['Th', ''],
    ['The qu', 'The'],
    ['The quick brown fo', 'The quick brown'],
    ['The quick brown fox jumps', 'The quick brown fox'],
    ['The quick brown fox jumps.\n', 'The quick brown fox jumps.\n'],
  ] as const) {
    shown = nextReveal(text, shown, false)
    assert.equal(shown, expected, text)
  }
})

test('a heading, list item or quote waits for its first whole word', () => {
  for (const text of ['## Pla', '- ', '- Ta', '> qu', '1. Fi', '- [ ] Ta', '* * *']) assert.equal(settle(text), '', text)
  assert.equal(settle('## Plan for'), '## Plan')
  assert.equal(settle('Intro.\n\n## Pl'), 'Intro.\n')
  assert.equal(settle('> - [x] Tag the'), '> - [x] Tag')
})

test('a code block waits for its first word of code, then grows as it arrives until it closes', () => {
  assert.equal(settle('Look:\n\n```ts\n'), 'Look:\n')
  // An opening still being written waits too, even with a space in it.
  assert.equal(settle('Look:\n\n```ts file.ts '), 'Look:\n')
  assert.equal(settle('Look:\n\n```ts\nconst a = 1'), 'Look:\n\n```ts\nconst a =')
  assert.equal(settle('Look:\n\n```ts\nconst a = 1\n'), 'Look:\n\n```ts\nconst a = 1\n')
  assert.equal(settle('Look:\n\n```ts\nconst a = 1\nconst b = 2\n``'), 'Look:\n\n```ts\nconst a = 1\nconst b = 2\n')
  // Inside a code block, what looks like Markdown is only code.
  assert.equal(settle('```\n| a | b |\n'), '```\n| a | b |\n')
  assert.equal(settle('```\nconst x = **y and'), '```\nconst x = **y')
  assert.equal(settle('```\nx\n```\nAfter.\n'), '```\nx\n```\nAfter.\n')
})

test('a table appears with its header and divider together, then a whole row at a time', () => {
  assert.equal(settle('Steps:\n\n| A | B'), 'Steps:\n')
  assert.equal(settle('Steps:\n\n| A | B |\n'), 'Steps:\n')
  assert.equal(settle('Steps:\n\n| A | B |\n| --- | -'), 'Steps:\n')
  assert.equal(settle('| A | B |\n| --- | --- |\n'), '| A | B |\n| --- | --- |\n')
  assert.equal(settle('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | fo'), '| A | B |\n| --- | --- |\n| 1 | 2 |\n')
})

test('emphasis, code and links still open hold the rest of their line back', () => {
  assert.equal(settle('Ship on **Friday after'), 'Ship on')
  assert.equal(settle('Ship on **Friday** after the'), 'Ship on **Friday** after')
  assert.equal(settle('an *italic wo'), 'an')
  assert.equal(settle('a __strong one'), 'a')
  assert.equal(settle('it is ~~gone and'), 'it is')
  assert.equal(settle('run `pnpm test and'), 'run')
  assert.equal(settle('run `pnpm test` now ok'), 'run `pnpm test` now')
  assert.equal(settle('see [the docs](https://x.test/a'), 'see')
  assert.equal(settle('see ![chart](chart.png) and ![b'), 'see ![chart](chart.png) and')
  assert.equal(settle('see [the docs](https://x.test/a) now'), 'see [the docs](https://x.test/a)')
  // A link's words inside the brackets are not emphasis that waits.
  assert.equal(settle('see [**the docs](https://x.test/a) and'), 'see [**the docs](https://x.test/a)')
  // The rest of the line shows once the line is finished, whatever it holds.
  assert.equal(settle('Ship on **Friday\n'), 'Ship on **Friday\n')
})

test('what only looks like Markdown shows as it arrives', () => {
  for (const [text, shown] of [
    ['2 * 3 = 6 and', '2 * 3 = 6'],
    ['snake_case_name is', 'snake_case_name'],
    ['about ~5 minutes in ~/.hobkin now', 'about ~5 minutes in ~/.hobkin'],
    ['a \\*literal star', 'a \\*literal'],
    ['#hashtag here', '#hashtag'],
    ['see [no link] and', 'see [no link]'],
    ['a | b', ''],
  ] as const) {
    assert.equal(settle(text), shown, text)
  }
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
  assert.equal(nextReveal('Ship on **Fri', 'Ship on', true), 'Ship on **Fri')
})

test('text the model rewrote goes back to what both versions agree on', () => {
  assert.equal(nextReveal('One.\nTwo!\nThree.\n', 'One.\nTwo.\n', false), 'One.\nTwo!\n')
  assert.equal(nextReveal('Hello there frie', 'Hello world', false), 'Hello there')
})

test('no character is lost and the order holds, however the text arrives', () => {
  const reply = [
    '## Plan',
    '',
    'Ship on **Friday** after the review, with `pnpm test` and [the list](https://x.test/a).',
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
    const line = next.slice(next.lastIndexOf('\n') + 1)
    assert.ok(text.startsWith(next), 'what shows is always the start of what arrived')
    assert.ok(next.startsWith(shown), 'nothing shown goes away while the text only grows')
    assert.ok(next === '' || next.endsWith('\n') || /\s/.test(text[next.length]!), 'a line still being written shows only whole words')
    assert.doesNotMatch(next, /```ts\n?$/, 'an empty code block is never drawn')
    assert.doesNotMatch(next, /\| Step[^\n]*\n?$/, 'a table header never shows without its divider')
    assert.doesNotMatch(next, /(^|\n)(#+|-)\s*$/, 'a heading or list item never shows without a word')
    assert.equal((line.match(/\*\*/g)?.length ?? 0) % 2, 0, 'bold never shows still open')
    assert.equal((line.match(/`/g)?.length ?? 0) % 2, 0, 'code never shows still open')
    assert.doesNotMatch(line, /\[[^\]]*$|\]\([^)]*$/, 'a link never shows still open')
    shown = next
  }
  assert.equal(nextReveal(reply, shown, true), reply)
})
