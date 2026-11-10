import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../src/features/chat/markdown.ts'

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))

const SAMPLE = [
  '# Release plan',
  '',
  'Ship on **Friday**, after the *last* review. See [the checklist](https://hobkin.dev/checklist) and run `pnpm test`.',
  '',
  '- Tag the build',
  '- Tell the team',
  '',
  '1. First',
  '2. Second',
  '',
  '| Step | Owner |',
  '| --- | --- |',
  '| Tag | hobkin |',
  '',
  '```ts',
  'const tag = "v1"',
  '```',
].join('\n')

test('renders markdown and neutralizes html', () => {
  const html = render(SAMPLE)
  assert.match(html, /<h1[^>]*>Release plan<\/h1>/)
  assert.match(html, /<strong[^>]*>Friday<\/strong>/)
  assert.match(html, /<em[^>]*>last<\/em>/)
  assert.match(html, /<ul[^>]*>\s*<li[^>]*>Tag the build<\/li>/)
  assert.match(html, /<ol[^>]*>\s*<li[^>]*>First<\/li>/)
  assert.match(html, /<table[^>]*>.*<th[^>]*>Step<\/th>.*<td[^>]*>hobkin<\/td>/s)
  assert.match(html, /<pre[^>]*><code[^>]*class="[^"]*language-ts[^"]*"[^>]*>const tag = &quot;v1&quot;\n<\/code><\/pre>/)
  assert.match(html, /<code[^>]*>pnpm test<\/code>/)

  // A link leaves the app: it opens outside, and the page it opens gets no handle on this window.
  assert.match(html, /<a [^>]*href="https:\/\/hobkin\.dev\/checklist"[^>]*>the checklist<\/a>/)
  const link = html.match(/<a [^>]*>/)?.[0] ?? ''
  assert.match(link, /target="_blank"/)
  assert.match(link, /rel="noopener noreferrer"/)

  // What a model writes is never markup of ours. HTML shows as the text it is, and nothing in it runs or loads.
  const hostile = render(
    [
      'Before <script>alert(1)</script> after.',
      '',
      '<img src=x onerror="alert(2)">',
      '',
      '<div onclick="alert(3)">click</div>',
      '',
      '[a trap](javascript:alert(4))',
      '',
      '![a pixel](https://tracker.example/pixel.png)',
      '',
      '<iframe src="https://example.com"></iframe>',
    ].join('\n'),
  )
  assert.doesNotMatch(hostile, /<script|<iframe|<img|<div onclick/i)
  assert.match(hostile, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(hostile, /&lt;img src=x onerror=&quot;alert\(2\)&quot;&gt;/)
  assert.doesNotMatch(hostile, /<[a-z][^>]*\son[a-z]+\s*=/i, 'no element carries an event handler')
  assert.doesNotMatch(hostile, /href="javascript:/i)
  assert.doesNotMatch(hostile, /<[a-z][^>]*\ssrc\s*=/i, 'nothing is fetched because a message said so')
  assert.match(hostile, /<a [^>]*>a pixel<\/a>/, 'a picture in a message shows as its words')

  assert.equal(render(''), '')
  assert.match(render('one\ntwo'), /one\s*<br\/?>\s*two|one\ntwo/)
})

test('the preview and the sent message render the same markdown', async () => {
  const { MessageText } = await import('../src/features/chat/markdown.ts')
  const preview = render(SAMPLE)
  const sent = renderToStaticMarkup(createElement(MessageText, { text: SAMPLE, role: 'user' }))
  const answered = renderToStaticMarkup(createElement(MessageText, { text: SAMPLE, role: 'assistant' }))

  // What the editor shows is what the conversation will show, for the user's messages and for hobkin's.
  assert.equal(sent, preview)
  assert.equal(answered, preview)
  for (const html of [sent, answered]) {
    assert.match(html, /<h1[^>]*>Release plan<\/h1>/)
    assert.match(html, /<table/)
    assert.match(html, /<pre[^>]*><code/)
    assert.match(html, /<a [^>]*href="https:\/\/hobkin\.dev\/checklist"/)
  }
})

test('a reply being written is the same markdown, with what just arrived marked to fade in', async () => {
  const { StreamingMarkdown } = await import('../src/features/chat/markdown.ts')
  const text = '## Plan\n\nShip on **Friday** after the review.\n\n- Tag the build'
  const html = renderToStaticMarkup(createElement(StreamingMarkdown, { text, marks: [text.indexOf('after'), text.indexOf('Tag')] }))
  const words = (markup: string) => markup.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()

  // The same words in the same structure as the stored message will have.
  assert.equal(words(html), words(render(text)))
  for (const tag of ['h2', 'p', 'strong', 'ul', 'li']) assert.match(html, new RegExp(`<${tag}[ >]`))

  // What arrived lately is wrapped on its own, each piece from where it began, and nothing before it is.
  const fresh = [...html.matchAll(/<span[^>]*data-fresh="(\d+)"[^>]*>([^<]*)<\/span>/g)].map(([, at, said]) => [Number(at), said])
  assert.deepEqual(fresh, [
    [text.indexOf('after'), 'after the review.'],
    [text.indexOf('Tag'), 'Tag the build'],
  ])
  assert.doesNotMatch(html.slice(0, html.indexOf('data-fresh')), /Friday<\/span>/)

  // With nothing marked there is nothing to fade, and hostile text is still only text.
  assert.doesNotMatch(renderToStaticMarkup(createElement(StreamingMarkdown, { text, marks: [] })), /data-fresh/)
  const hostile = renderToStaticMarkup(createElement(StreamingMarkdown, { text: 'Hi <script>alert(1)</script>', marks: [3] }))
  assert.doesNotMatch(hostile, /<script/i)
})
