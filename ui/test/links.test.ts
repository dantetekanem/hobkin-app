import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../src/features/chat/markdown.ts'
import { decideLink, type LinkEnvironment } from '../src/features/viewer/catch.ts'
import { localPathOf, splitPaths } from '../src/features/viewer/paths.ts'

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { text }))
const paths = (text: string) => splitPaths(text).flatMap((piece) => ('path' in piece ? [piece.path] : []))

test('absolute and home paths in text are found, and prose that only looks like a path is not', () => {
  assert.deepEqual(paths('Open /Users/x/notes.md or ~/Poetry/x/README.md.'), ['/Users/x/notes.md', '~/Poetry/x/README.md'])
  assert.deepEqual(paths('see (/tmp/out.log), then /var/log/system.log: done'), ['/tmp/out.log', '/var/log/system.log'])
  assert.deepEqual(paths('/Users/x/a.ts:12'), ['/Users/x/a.ts'])
  assert.deepEqual(paths('and/or 1/2 /api/users src/app/main.ts ./here.md https://example.com/Users/x ~ alone /tmp'), [])
  assert.deepEqual(splitPaths('a /tmp/x. b'), [{ text: 'a ' }, { path: '/tmp/x' }, { text: '. b' }])
  assert.deepEqual(splitPaths('nothing here'), [{ text: 'nothing here' }])
})

test('a link destination is a local file when it is a full path or starts with ~/', () => {
  assert.equal(localPathOf('/Users/x/notes.md'), '/Users/x/notes.md')
  assert.equal(localPathOf('~/Poetry/x/README.md'), '~/Poetry/x/README.md')
  assert.equal(localPathOf('/Users/x/My%20Docs/a.md'), '/Users/x/My Docs/a.md')
  for (const href of ['https://example.com/Users/x', '//example.com/x', 'mailto:a@b.c', '#top', './a.md', 'a.md', '', undefined]) assert.equal(localPathOf(href), null, String(href))
})

test('markdown shows local paths as file links and keeps web links as they were', () => {
  const html = render(['Read /Users/x/notes.md and `~/Poetry/x/README.md`, or [the plan](~/plans/a.md), or [site](https://hobkin.dev).', '', '```', '/Users/x/in-a-block.md', '```'].join('\n'))
  assert.match(html, /<a [^>]*data-file="\/Users\/x\/notes\.md"[^>]*>\/Users\/x\/notes\.md<\/a>/)
  assert.match(html, /<a [^>]*data-file="~\/Poetry\/x\/README\.md"[^>]*><code[^>]*>~\/Poetry\/x\/README\.md<\/code><\/a>/)
  assert.match(html, /<a [^>]*data-file="~\/plans\/a\.md"[^>]*>the plan<\/a>/)
  const file = html.match(/<a [^>]*data-file="\/Users\/x\/notes\.md"[^>]*>/)?.[0] ?? ''
  assert.doesNotMatch(file, /target=/, 'a file does not open a window')
  const site = html.match(/<a [^>]*href="https:\/\/hobkin\.dev"[^>]*>/)?.[0] ?? ''
  assert.match(site, /target="_blank"/)
  assert.doesNotMatch(site, /data-file/)
  assert.doesNotMatch(html.match(/<pre>.*<\/pre>/s)?.[0] ?? '', /<a /, 'code blocks stay code')
  // A path inside a link's own words is not linked twice.
  assert.equal((render('[see /Users/x/a.md](https://hobkin.dev)').match(/<a /g) ?? []).length, 1)
})

const mac: LinkEnvironment = { inMacWindow: true, hasHost: true }

test('a click is caught for a file anywhere, and for the web only in the Mac window with a host', () => {
  assert.equal(decideLink({ href: '#', file: '/Users/x/a.md' }, { inMacWindow: false, hasHost: false }), 'file')
  assert.equal(decideLink({ href: 'https://example.com', file: null }, mac), 'system')
  assert.equal(decideLink({ href: 'HTTP://example.com', file: null }, mac), 'system')
  assert.equal(decideLink({ href: 'mailto:a@b.c', file: null }, mac), 'system')
  assert.equal(decideLink({ href: 'slack://channel?team=T0000&id=C0000', file: null }, mac), 'system', 'the Slack app opens it')
  // In a browser tab, or with no host to ask, the link works as a link does.
  assert.equal(decideLink({ href: 'https://example.com', file: null }, { inMacWindow: false, hasHost: true }), 'default')
  assert.equal(decideLink({ href: 'https://example.com', file: null }, { inMacWindow: true, hasHost: false }), 'default')
  // Not ours: the page's own anchors, other kinds of address and anchors with no address.
  for (const href of ['#section', '/settings', 'tel:123', 'javascript:alert(1)', '', null]) assert.equal(decideLink({ href, file: null }, mac), 'default', String(href))
})
