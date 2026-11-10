import assert from 'node:assert/strict'
import { test } from 'node:test'
import { liveMarkdown } from '../src/features/chat/live-markdown.ts'

/** The styled pieces only, as `text|style style`. Plain text carries no style. */
const styled = (text: string) =>
  liveMarkdown(text)
    .filter(({ styles }) => styles.length)
    .map(({ text: piece, styles }) => `${piece}|${styles.join(' ')}`)
const joined = (text: string) => liveMarkdown(text).map(({ text: piece }) => piece).join('')

test('the styled text is the typed text, character for character, so it lies exactly under the input', () => {
  const samples = [
    '',
    '\n\n',
    '# Plan\n\nShip **on Friday**, after the *last* review. See [the checklist](https://hobkin.dev/x) and run `pnpm test`.\n',
    '```ts\nconst a = `b` ** 2\n```\n> quoted _words_\n- [ ] one\n12. two\n---\n~~gone~~ \\*not em\\*',
    'unclosed **bold and `code and [link]( and ~~ and _x',
    'tabs\tand\r\nwindows lines\r\n# heading\r\n',
    '2 * 3 = 6, snake_case_name, a*b*c, **, __, ``, [], ![]()',
  ]
  for (const sample of samples) assert.equal(joined(sample), sample, JSON.stringify(sample))

  // And for text no one would write on purpose.
  let seed = 7
  const next = () => (seed = (seed * 16807) % 2147483647)
  const alphabet = '#*_`~[]()!>-+ 1.x\n\\h'
  for (let round = 0; round < 300; round++) {
    const text = Array.from({ length: next() % 60 }, () => alphabet[next() % alphabet.length]).join('')
    assert.equal(joined(text), text, JSON.stringify(text))
  }
})

test('headings, emphasis, code and links take their look as they are typed', () => {
  assert.deepEqual(styled('# Plan the **release**'), ['# |heading mark', 'Plan the |heading', '**|heading strong mark', 'release|heading strong', '**|heading strong mark'])
  assert.deepEqual(styled('Some *italic* and ~~struck~~ and `code`.'), ['*|em mark', 'italic|em', '*|em mark', '~~|strike mark', 'struck|strike', '~~|strike mark', '`|code mark', 'code|code', '`|code mark'])
  assert.deepEqual(styled('see [the docs](https://x.test/a) now'), ['[|mark', 'the docs|link', '](|mark', 'https://x.test/a|url', ')|mark'])
  assert.deepEqual(styled('![chart](chart.png)'), ['![|mark', 'chart|link', '](|mark', 'chart.png|url', ')|mark'])
  assert.deepEqual(styled('<https://x.test> and https://y.test/z.'), ['<|mark', 'https://x.test|url', '>|mark', 'https://y.test/z|link'])
  assert.deepEqual(styled('a \\*literal\\* star'), ['\\|mark', '\\|mark'])
})

test('blocks: fenced code stays code to its closing fence, and quotes, lists, tasks and rules are marked', () => {
  assert.deepEqual(styled('```ts\nconst a = **b**\n```\nafter **x**'), ['```ts|fence', 'const a = **b**|block', '```|fence', '**|strong mark', 'x|strong', '**|strong mark'])
  // An unclosed fence runs to the end, as in Markdown.
  assert.deepEqual(styled('~~~\nstill code'), ['~~~|fence', 'still code|block'])
  assert.deepEqual(styled('> quoted *em*'), ['>|quote mark', ' quoted |quote', '*|quote em mark', 'em|quote em', '*|quote em mark'])
  assert.deepEqual(styled('- item\n2. two\n- [x] done'), ['-|bullet', '2.|bullet', '-|bullet', '[x] |task'])
  assert.deepEqual(styled('---'), ['---|rule'])
  assert.deepEqual(styled('* * *'), ['* * *|rule'])
})

test('what only looks like Markdown stays plain', () => {
  for (const text of ['2 * 3 = 6', 'snake_case_name', '**not closed', 'a ** b ** c', '#hashtag', '`unclosed', '[no link]', 'price: $5 *each', 'x_y_z']) {
    assert.deepEqual(styled(text), [], text)
  }
})
