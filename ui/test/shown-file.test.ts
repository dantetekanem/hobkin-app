import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { FileContent } from '../../shared/protocol/files.ts'
import { Markdown } from '../src/features/chat/markdown.ts'
import { keptShown, loadShown, PAGE_POLICY, sealedPage, shownOf } from '../src/features/viewer/shown-file.ts'

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))

const PIXEL = 'data:image/png;base64,iVBORw0KGgo='
const picture = (path: string): FileContent => ({ kind: 'image', path, name: path.split('/').at(-1)!, bytes: 8, type: 'image/png', url: PIXEL })
const text = (path: string, words: string): FileContent => ({ kind: 'text', path, name: path.split('/').at(-1)!, bytes: words.length, text: words, markdown: false })

test('a file shows in a conversation as a picture, as a still page, or as the link it was', () => {
  assert.deepEqual(shownOf(picture('/tmp/shot.png')), { kind: 'picture', url: PIXEL })

  const page = shownOf(text('/tmp/mockup.html', '<p>Hello</p>'))
  assert.equal(page.kind, 'page')
  assert.equal(shownOf(text('/tmp/Mockup.HTM', '<p>Hello</p>')).kind, 'page', 'by its name, whatever its case')

  assert.deepEqual(shownOf(text('/tmp/notes.md', '# Notes')), { kind: 'link' }, 'any other file opens in the viewer, as before')
})

test('a page is sealed before it is framed: its policy comes first and lets nothing load from the network', () => {
  const sealed = sealedPage('<!DOCTYPE html>\n<html><head><title>Mockup</title></head><body><p>Hello</p></body></html>')
  const policy = `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`

  assert.ok(sealed.startsWith(`<!DOCTYPE html>${policy}`), 'right after the doctype, so the page keeps its layout mode')
  assert.match(sealed, /<p>Hello<\/p>/)
  assert.match(PAGE_POLICY, /default-src 'none'/)
  assert.doesNotMatch(PAGE_POLICY, /https?:|\*|script-src|connect-src/, 'no address, no script and no request is let through')

  // A comment ahead of the doctype stays ahead of it, so the doctype still counts.
  assert.ok(sealedPage('<!-- made by an agent -->\n<!doctype html><p>Hello</p>').startsWith(`<!-- made by an agent -->\n<!doctype html>${policy}`))

  // A page with no doctype gets none, and the policy still comes first.
  assert.ok(sealedPage('<p>Hello</p>').startsWith(policy))
})

test('a sealed page keeps no link element, which could look up or reach a host the page chose', () => {
  const hints = [
    '<link rel="dns-prefetch" href="//tracker.example">',
    '<LINK\n  rel=preconnect href=https://tracker.example>',
    // Taking the inner one out must not leave the outer one whole.
    '<li<link rel=x>nk rel="dns-prefetch" href="//tracker.example">',
  ]
  for (const hint of hints) {
    const sealed = sealedPage(`<!doctype html><head>${hint}<style>p { color: red }</style></head><p>Hello</p>`)
    assert.doesNotMatch(sealed, /<link/i, hint)
    assert.match(sealed, /<style>p \{ color: red \}<\/style>/, 'its own styles stay')
  }
})

test('a file is read once for every picture of it, and what it showed is kept for a while', async () => {
  const reads: string[] = []
  const read = async (path: string) => {
    reads.push(path)
    return picture(path)
  }
  const at = 1_000_000

  assert.equal(keptShown('/tmp/once.png', at), null)
  const [first, second] = await Promise.all([loadShown('/tmp/once.png', read, at), loadShown('/tmp/once.png', read, at)])
  assert.deepEqual(first, { kind: 'picture', url: PIXEL })
  assert.equal(second, first)
  assert.deepEqual(reads, ['/tmp/once.png'], 'two pictures of one file ask once')
  assert.equal(keptShown('/tmp/once.png', at + 30_000), first, 'drawn again soon after, it is not read again')

  // The file may have been written again since: later it is read anew.
  assert.equal(keptShown('/tmp/once.png', at + 120_000), null)
  await loadShown('/tmp/once.png', read, at + 120_000)
  assert.equal(reads.length, 2)
})

test('a file that cannot be read shows as the link it was, and is not asked for again at once', async () => {
  let asked = 0
  const refuse = async (): Promise<FileContent> => {
    asked += 1
    throw new Error('There is no file at /tmp/gone.png.')
  }

  assert.deepEqual(await loadShown('/tmp/gone.png', refuse, 5_000), { kind: 'link' })
  assert.deepEqual(await loadShown('/tmp/gone.png', refuse, 6_000), { kind: 'link' })
  assert.equal(asked, 1)
})

test('a picture of a local file draws in the message once its file is read, and opens the viewer on a click', async () => {
  const path = '/Users/someone/shots/navigator.png'
  const before = render(`Here it is:\n\n![The navigator, open](${path})`)
  assert.match(before, /<a [^>]*data-file="\/Users\/someone\/shots\/navigator\.png"[^>]*>The navigator, open<\/a>/, 'until then it is its words, linked to the file')
  assert.doesNotMatch(before, /<img/)

  await loadShown(path, async () => picture(path))
  const drawn = render(`Here it is:\n\n![The navigator, open](${path})`)
  assert.match(drawn, /<a [^>]*data-file="\/Users\/someone\/shots\/navigator\.png"[^>]*><img [^>]*src="data:image\/png;base64,iVBORw0KGgo="[^>]*alt="The navigator, open"/)
})

test('a picture of a local page draws it in a frame that runs nothing, with its words linked to the file', async () => {
  const path = '/Users/someone/mockups/row.html'
  await loadShown(path, async () => text(path, '<!doctype html><p>A row</p>'))

  const drawn = render(`![The row, as it would look](${path})`)
  const frame = drawn.match(/<iframe [^>]*>/)?.[0] ?? ''
  assert.match(frame, /sandbox="allow-same-origin"/, 'no scripts, no forms, no popups')
  assert.doesNotMatch(frame, /allow-scripts/)
  assert.match(frame, /srcDoc="&lt;!doctype html&gt;&lt;meta http-equiv=&quot;Content-Security-Policy&quot;/i, 'the sealed page, never an address')
  assert.doesNotMatch(frame, /\ssrc="/)
  assert.match(drawn, /<a [^>]*data-file="\/Users\/someone\/mockups\/row\.html"[^>]*>The row, as it would look<\/a>/)
})

test('a picture at an address on the network is still only its words: nothing is fetched because a message said so', () => {
  const drawn = render('![a pixel](https://tracker.example/pixel.png) and ![a page](http://localhost:3000/index.html)')
  assert.doesNotMatch(drawn, /<img|<iframe/)
  assert.match(drawn, /<a [^>]*href="https:\/\/tracker\.example\/pixel\.png"[^>]*>a pixel<\/a>/)
  assert.match(drawn, /<a [^>]*href="http:\/\/localhost:3000\/index\.html"[^>]*>a page<\/a>/)
})
