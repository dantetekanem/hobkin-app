import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { decideLink } from '../src/features/viewer/catch.ts'

// The reader's Markdown is TSX, which Node reads once Vite's own transformer has turned it into JavaScript.
const { transformSync } = (await import(createRequire(import.meta.resolve('vite')).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string }
}
registerHooks({
  load: (url, context, next) => {
    if (!url.endsWith('.tsx')) return next(url, context)
    const file = fileURLToPath(url)
    return { format: 'module', source: transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } }).code, shortCircuit: true }
  },
})
const { ReportMarkdown } = await import('../src/features/reports/ReportMarkdown.tsx')

const render = (text: string) => renderToStaticMarkup(createElement(ReportMarkdown, { text }))
/** The files a report's links open, in order. */
const files = (html: string) => [...html.matchAll(/data-file="([^"]*)"/g)].map((match) => match[1])

test('a report links every local path: in its words, in inline code and in a code block line, full or from ~/', () => {
  const html = render(
    [
      'Wrote /Users/x/notes.md and ~/image.jpg.',
      '',
      'See `~/Poetry/x/README.md`, run `open ~/shots/a.png` or read [the plan](~/plans/a.md) and ![shot](/tmp/shot.png).',
      '',
      '```',
      'cat /var/log/system.log',
      '~/Poetry/x/out.md',
      '```',
    ].join('\n'),
  )
  assert.deepEqual(files(html), ['/Users/x/notes.md', '~/image.jpg', '~/Poetry/x/README.md', '~/shots/a.png', '~/plans/a.md', '/tmp/shot.png', '/var/log/system.log', '~/Poetry/x/out.md'])
  // A whole inline code that is a path is the link; one with other words keeps them, with the path linked inside.
  assert.match(html, /<a [^>]*data-file="~\/Poetry\/x\/README\.md"[^>]*><code[^>]*>~\/Poetry\/x\/README\.md<\/code><\/a>/)
  assert.match(html, /<code[^>]*>open <a [^>]*data-file="~\/shots\/a\.png"[^>]*>~\/shots\/a\.png<\/a><\/code>/)
  assert.match(html, /<pre[^>]*><code[^>]*>cat <a [^>]*data-file="\/var\/log\/system\.log"[^>]*>\/var\/log\/system\.log<\/a>\n<a [^>]*data-file="~\/Poetry\/x\/out\.md"/)
  // A file opens no window of its own: the app's link catcher opens it in the sheet.
  for (const anchor of html.match(/<a [^>]*data-file=[^>]*>/g) ?? []) {
    assert.match(anchor, /href="#"/)
    assert.doesNotMatch(anchor, /target=/)
  }
})

test('a report keeps web links, report links and words that only look like paths as they were', () => {
  const html = render(
    [
      'See https://hobkin.invalid/Users/x/a.md, [the site](https://hobkin.invalid), [the last one](hobkin-report:run-1) and and/or /api/users src/app/main.ts.',
      '',
      '```',
      'curl https://hobkin.invalid/tmp/x.log',
      '```',
    ].join('\n'),
  )
  assert.deepEqual(files(html), [])
  assert.match(html, /<a [^>]*href="https:\/\/hobkin\.invalid\/Users\/x\/a\.md"[^>]*target="_blank"/)
  assert.match(html, /<a [^>]*href="https:\/\/hobkin\.invalid"[^>]*target="_blank"/)
  assert.match(html, /<a [^>]*href="hobkin-report:run-1"/)
  // A path inside a link's own words is not linked twice.
  assert.equal((render('[see /Users/x/a.md](https://hobkin.invalid)').match(/<a /g) ?? []).length, 1)
})

test("a fold's label and inside link paths the same way", () => {
  const html = render(['<details><summary>Logs in `/tmp/run.log`</summary>', '', 'Kept at ~/logs/run.md', '</details>'].join('\n'))
  assert.deepEqual(files(html), ['/tmp/run.log', '~/logs/run.md'])
})

test('⌘-click on a file opens it in its app when a host can, and a plain click opens the sheet', () => {
  const mac = { inMacWindow: true, hasHost: true }
  assert.equal(decideLink({ href: '#', file: '/Users/x/a.md', meta: true }, mac), 'app')
  assert.equal(decideLink({ href: '#', file: '/Users/x/a.md', meta: true }, { inMacWindow: false, hasHost: true }), 'app')
  assert.equal(decideLink({ href: '#', file: '/Users/x/a.md', meta: false }, mac), 'file')
  // With no host to open it, the sheet says why it cannot be shown.
  assert.equal(decideLink({ href: '#', file: '/Users/x/a.md', meta: true }, { inMacWindow: true, hasHost: false }), 'file')
  // A web link is the same with ⌘ as without.
  assert.equal(decideLink({ href: 'https://hobkin.invalid', file: null, meta: true }, mac), 'system')
})
