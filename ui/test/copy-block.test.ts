import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { fenceOf } from '../src/features/chat/CopyBlock.ts'
import { Markdown } from '../src/features/chat/markdown.ts'

const code = (className: string | undefined, text: string) => createElement('code', { className }, text)

test('a fence says its language and gives back its raw text', () => {
  assert.deepEqual(fenceOf(code('language-copy', 'Hi,\n\nThanks.\n')), { copy: true, text: 'Hi,\n\nThanks.' })
  assert.deepEqual(fenceOf(code('language-ts', 'const a = 1\n')), { copy: false, text: 'const a = 1' })
  assert.deepEqual(fenceOf(code(undefined, 'plain')), { copy: false, text: 'plain' })
})

test('a copy fence draws as text with a button, other fences as code with one', () => {
  const copy = renderToStaticMarkup(createElement(Markdown, { text: '```copy\nHi Sam,\nsee you **Friday**\n```' }))
  assert.match(copy, /Copy/)
  assert.match(copy, /whitespace-pre-wrap/)
  assert.doesNotMatch(copy, /<pre/)
  const other = renderToStaticMarkup(createElement(Markdown, { text: '```ts\nconst a = 1\n```' }))
  assert.match(other, /<pre[^>]*><code[^>]*language-ts/)
  assert.match(other, /aria-label="Copy"/)
})

test('the text of a fence is whole when spans mark what just arrived', () => {
  const marked = createElement('code', { className: 'language-copy' }, 'Hi ', createElement('span', null, 'Sam'), ',\n')
  assert.equal(fenceOf(marked).text, 'Hi Sam,')
})
