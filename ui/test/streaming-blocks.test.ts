import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement, memo, useSyncExternalStore } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mountCounting } from './render-count.ts'

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
const { blocksOf, GrowingMarkdown, MessageText, sameBlock, StreamingMarkdown } = await import('../src/features/chat/markdown.ts')

/** Unmounts a counted tree and takes away the page it gave React, so Motion draws on the server again. */
async function unmount(mounted: { unmount: () => Promise<void> }) {
  await mounted.unmount()
  Reflect.deleteProperty(globalThis, 'window')
}

/** A reply that grows from outside React, as the host's words do. */
function growing(first: string) {
  let value = first
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    set(next: string) {
      value = next
      for (const listener of listeners) listener()
    },
    use: () => useSyncExternalStore(subscribe, () => value),
  }
}

test('a 20 KB reply growing by one word parses only its last block', async () => {
  const part = '## A step\n\nThe agent reads `src/app.ts` and **changes** it.\n\n- one\n- two\n\n1. first\n\n2. second, a loose list\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n> quoted\n\nThen it says more words. '
  const reply = part.repeat(Math.ceil(20000 / part.length)).slice(0, 20000)
  // Drawn block by block, it is the same Markdown as drawn whole.
  assert.equal(renderToStaticMarkup(createElement(GrowingMarkdown, { text: reply })), renderToStaticMarkup(createElement(MessageText, { text: reply, role: 'assistant' })))
  // Words that arrived in one piece fade in together, even when the piece began in the block before.
  const small = 'The first block ends here.\n\nThe second one.'
  assert.match(renderToStaticMarkup(createElement(StreamingMarkdown, { text: small, marks: [0, 16] })), /data-fresh="16"[^>]*>The second one\./)

  const text = growing(reply)
  const marks = [0, 19000]
  const parsed: string[] = []
  const Block = memo(function Block({ text }: { text: string; offset: number; marks: readonly number[]; prefix: string; drawn: number; still: boolean }) {
    parsed.push(text)
    return null
  }, sameBlock)
  // The blocks as StreamingMarkdown draws them: one memo block each, from blocksOf.
  function Reply() {
    return blocksOf(text.use(), marks).map(({ key, ...block }) => createElement(Block, { key, ...block, still: false }))
  }
  const mounted = await mountCounting(() => createElement(Reply))
  const blocks = blocksOf(reply).length
  assert.ok(blocks > 10, `${blocks} blocks`)
  assert.equal(parsed.length, blocks)
  parsed.length = 0

  await mounted.change(() => text.set(`${reply}word `))
  assert.deepEqual(parsed, [blocksOf(`${reply}word `).at(-1)!.text])
  await unmount(mounted)
})

/** A paragraph long enough to be a block of its own. */
const PAD = `${'This paragraph is long enough to make its own block of more than five hundred characters. '.repeat(7)}`

/** The review's 36 replies (lanes/v1/review.md, finding 4): every Markdown construct that could reach across a blank line. */
const CASES: Record<string, string> = {
  'reference definition inside a block quote': `See [the docs][d].\n\n${PAD}\n\n> [d]: https://example.com`,
  'reference definition indented four spaces in a list item': `See [the docs][d].\n\n${PAD}\n\n1.  item\n\n    [d]: https://example.com`,
  'reference label with an escaped bracket': `See [a\\]b].\n\n${PAD}\n\n[a\\]b]: https://example.com`,
  'footnote': `A claim.[^1]\n\n${PAD}\n\n[^1]: The source.`,
  'unclosed fence': `${PAD}\n\n\`\`\`ts\nconst a = 1\n\nconst b = 2`,
  'fence in a list item with a blank line': `${PAD}\n\n- item\n\n  \`\`\`\n  one\n\n  two\n  \`\`\`\n\nafter`,
  'nested list across a blank line': `${PAD}\n\n- one\n  - nested\n\n- two\n\ntext`,
  'list continues after a blank line (ordered)': `${PAD}\n\n1. first\n\n2. second\n\n3. third`,
  'list item continues with an indented paragraph': `${PAD}\n\n- item\n\n  more of the item\n\n- next`,
  'loose list where the next item changes marker': `${PAD}\n\n- a\n\n* b\n\n+ c`,
  'list then paragraph then list': `${PAD}\n\n- a\n\npara\n\n- b`,
  'table after blank': `${PAD}\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nafter`,
  'block quote across a blank line': `${PAD}\n\n> one\n\n> two`,
  'block quote lazy continuation': `${PAD}\n\n> one\ncontinued\n\nafter`,
  'setext heading after blank': `${PAD}\n\nTitle\n=====\n\nbody`,
  'setext underline alone after blank': `${PAD}\n\n---\n\nbody`,
  'html block with blank lines': `${PAD}\n\n<details>\n\nhidden\n\n</details>`,
  'indented code block across a blank line': `${PAD}\n\n    code one\n\n    code two\n\nafter`,
  'indented code after a paragraph': `${PAD}\n\npara\n\n    code\n\n    more\nnext`,
  'fence opened with tildes and backticks inside': `${PAD}\n\n~~~\n\`\`\`\n\nstill code\n~~~\n\nafter`,
  'inline triple backticks at line start': `${PAD}\n\n\`\`\`x\`\`\` is inline\n\npara\n\n${PAD}\n\nend`,
  'fence with four backticks closed by three': `${PAD}\n\n\`\`\`\`\ncode\n\`\`\`\n\nstill code\n\`\`\`\`\n\nafter`,
  'tab-indented continuation': `${PAD}\n\n- item\n\n\tcontinued\n\nafter`,
  'list item at margin after a list in a quote': `${PAD}\n\n> - a\n\n- b`,
  'ordered list with paren continues': `${PAD}\n\n1) a\n\n2) b`,
  'definition list of links later used earlier, plain [x]': `Use [x].\n\n${PAD}\n\n[x]: <https://example.com>`,
  'html comment': `${PAD}\n\n<!--\n\ncomment\n\n-->\n\nafter`,
  'list item then blank then lazy line at margin': `${PAD}\n\n- a\n\nb\n- c`,
  'empty list item': `${PAD}\n\n-\n\n  foo`,
  'thematic break vs list': `${PAD}\n\n- a\n\n* * *\n\nb`,
  'hr after list': `${PAD}\n\n- a\n\n---`,
  'list item followed by blank and a heading': `${PAD}\n\n- a\n\n# H`,
  'code fence inside block quote with blank': `${PAD}\n\n> \`\`\`\n> a\n>\n> b\n> \`\`\`\n\nafter`,
  'numbered item 10 continues': `${PAD}\n\n9. a\n\n10. b`,
  'numbered list 1 with 10 digit': `${PAD}\n\n1. a\n\n1234567890. b`,
  'paragraph then list then continuation para indented 3': `${PAD}\n\n1. a\n\n   b\n\nc`,
}

/** Markup without the inline styles Motion writes for an element's first frame. */
const unstyled = (markup: string) => markup.replaceAll(/ style="[^"]*"/g, '')
const whole = (text: string) => renderToStaticMarkup(createElement(MessageText, { text, role: 'assistant' }))
const offsets = (text: string) => blocksOf(text).map((block) => block.offset)

test('each of the 36 replies, drawn block by block once complete, is the Markdown drawn whole', () => {
  for (const [name, text] of Object.entries(CASES)) {
    assert.equal(renderToStaticMarkup(createElement(GrowingMarkdown, { text })), whole(text), name)
    assert.equal(unstyled(renderToStaticMarkup(createElement(StreamingMarkdown, { text, marks: [] }))), whole(text), name)
  }
})

test('only a definition reaches back: a late character class or HTML line keeps the blocks before it, and so does a late definition', () => {
  const reply = `See [the docs][d].\n\n${PAD}\n\n${PAD}\n\n${PAD}\n\nTo match it, use `
  const before = offsets(reply)
  assert.ok(before.length > 2, `${before.length} blocks`)
  for (const more of ['`[^a-z]` and ', '\n\n<br>\n\nthen ', '\n\n[d]: https://example.invalid\n\nand ']) {
    assert.deepEqual(offsets(`${reply}${more}`).slice(0, before.length), before, more)
  }
  // The definition still makes the link in the first block.
  assert.match(renderToStaticMarkup(createElement(GrowingMarkdown, { text: `${reply}\n\n[d]: https://example.invalid\n` })), /<a href="https:\/\/example.invalid"[^>]*>the docs<\/a>/)
})

test('a definition that arrives late parses the blocks before it again once, and what was shown does not rise again', async () => {
  const reply = `See [the docs][d].\n\n${PAD}\n\n${PAD}\n\nThe end `
  const defined = `${reply}\n\n[d]: https://example.invalid\n`
  const text = growing(reply)
  const parsed: string[] = []
  const Block = memo(function Block({ text }: { text: string; offset: number; marks: readonly number[]; prefix: string; drawn: number; still: boolean }) {
    parsed.push(text)
    return null
  }, sameBlock)
  function Reply() {
    return blocksOf(text.use()).map(({ key, ...block }) => createElement(Block, { key, ...block, still: false }))
  }
  const mounted = await mountCounting(() => createElement(Reply))
  const blocks = blocksOf(defined).length
  parsed.length = 0

  await mounted.change(() => text.set(defined))
  assert.equal(parsed.length, blocks)
  parsed.length = 0
  await mounted.change(() => text.set(`${defined}More `))
  assert.deepEqual(parsed, [blocksOf(`${defined}More `).at(-1)!.text])
  await unmount(mounted)

  // Drawn again with the definition, the paragraph shown before it keeps its place: it does not start from below.
  const html = renderToStaticMarkup(createElement(StreamingMarkdown, { text: defined, marks: [0, reply.length] }))
  const first = html.slice(0, html.indexOf('</p>'))
  assert.doesNotMatch(first, /opacity:0/)
  assert.match(first, /<a href="https:\/\/example.invalid"/)
})

test("a growing step on an agent's page draws every character that arrived, plainly, as the whole text draws it", () => {
  for (const [name, text] of Object.entries(CASES)) {
    for (let length = 1; length <= text.length; length++) {
      const arrived = text.slice(0, length)
      const markup = renderToStaticMarkup(createElement(GrowingMarkdown, { text: arrived }))
      // No word marked fresh to fade in, and no element that moves: Motion writes an inline style on each.
      assert.doesNotMatch(markup, /data-fresh|style=/, `${name} at ${length}`)
      assert.equal(markup, whole(arrived), `${name} at ${length}`)
    }
  }
  // The middle of a line shows as it arrives, not held back to its last whole word.
  assert.match(renderToStaticMarkup(createElement(GrowingMarkdown, { text: 'The agent reads the fi' })), />The agent reads the fi</)
})

test("one more word of a growing step on an agent's page parses only its last block", async () => {
  const reply = `${PAD}\n\n${PAD}\n\n${PAD}\n\nThe agent reads the fi`
  const text = growing(reply)
  const parsed: string[] = []
  // The blocks as GrowingMarkdown draws them: one memo block each, drawn again only for its text or its prefix.
  const Block = memo(function Block({ text }: { text: string; prefix: string }) {
    parsed.push(text)
    return null
  })
  function Step() {
    return blocksOf(text.use()).map(({ key, text: block, prefix }) => createElement(Block, { key, text: block, prefix }))
  }
  const mounted = await mountCounting(() => createElement(Step))
  parsed.length = 0
  await mounted.change(() => text.set(`${reply}le `))
  assert.deepEqual(parsed, [blocksOf(`${reply}le `).at(-1)!.text])
  await unmount(mounted)
})
