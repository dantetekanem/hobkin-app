import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'
import { createElement, memo, useSyncExternalStore } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { mountCounting } from './render-count.ts'

// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
const { blocksOf, GrowingMarkdown, MessageText, sameBlock, StreamingMarkdown } = await import('../src/features/chat/markdown.ts')

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
  const Block = memo(function Block({ text }: { text: string; offset: number; marks: readonly number[]; still: boolean }) {
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
  await mounted.unmount()
})
