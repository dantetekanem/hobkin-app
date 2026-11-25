import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { MAX_FILE_BYTES, MAX_IMAGE_BYTES, openablePath, readForViewer } from '../src/files.ts'
import { imageTypeOf } from '../src/image-type.ts'
import { openableUrl, openInSystem } from '../src/open.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

test('only http, https and mailto addresses are openable', () => {
  for (const url of ['https://example.com/a?b=1', 'http://example.com', 'mailto:someone@example.com']) {
    assert.equal(openableUrl(url).href, new URL(url).href, url)
  }
  for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'ftp://example.com', 'data:text/html,x', '-a Calculator', '/Applications/Calculator.app', 'https://', 'not a url']) {
    assert.throws(() => openableUrl(url), url)
  }
})

test('the real opener runs open with the address as one argument and no shell', () => {
  const ran: { file: string; args: readonly string[]; shell: unknown }[] = []
  const run = ((file: string, args: readonly string[], options?: { shell?: unknown }) => {
    ran.push({ file, args, shell: options?.shell })
  }) as never
  openInSystem('https://example.com/a b;rm -rf', run, 'darwin')
  assert.deepEqual(ran, [{ file: 'open', args: ['https://example.com/a%20b;rm%20-rf'], shell: undefined }])
  assert.throws(() => openInSystem('file:///etc/hosts', run, 'darwin'))
  assert.equal(ran.length, 1, 'a refused address ran nothing')
})

test('system.open opens only what the opener is handed, and refuses other addresses', { timeout: 30000 }, async (t) => {
  const opened: string[] = []
  const host = await hostFor(t, { openSystem: (url) => opened.push(url) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  assert.deepEqual(await client.run('system.open', { url: 'https://example.com/docs' }), { ok: true })
  assert.deepEqual(await client.run('system.open', { url: 'mailto:a@example.com' }), { ok: true })
  assert.deepEqual(opened, ['https://example.com/docs', 'mailto:a@example.com'])
  for (const url of ['file:///etc/hosts', 'javascript:alert(1)', 'ftp://example.com/x', '/Applications/Calculator.app', 'https://']) {
    const refused = await client.command('system.open', { url })
    assert.equal(refused.ok, false, url)
  }
  assert.equal(opened.length, 2, 'nothing else was opened')
})

test('a host with no opener opens nothing', { timeout: 30000 }, async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  assert.deepEqual(await client.run('system.open', { url: 'https://example.com' }), { ok: true })
})

function fixtures(t: Parameters<typeof temporaryDirectory>[0]) {
  const root = temporaryDirectory(t)
  const home = join(root, 'home')
  mkdirSync(join(home, 'Poetry'), { recursive: true })
  writeFileSync(join(home, 'Poetry', 'README.md'), '# Title\n\nSome *words*.\n')
  writeFileSync(join(root, 'notes.txt'), 'plain notes\n')
  writeFileSync(join(root, 'code.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]))
  writeFileSync(join(root, 'latin1.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))
  writeFileSync(join(root, 'big.txt'), 'x'.repeat(MAX_FILE_BYTES + 1))
  writeFileSync(join(root, 'empty.md'), '')
  mkdirSync(join(root, 'folder'))
  symlinkSync(join(root, 'notes.txt'), join(root, 'link.txt'))
  symlinkSync(join(root, 'folder'), join(root, 'folder-link'))
  symlinkSync(join(root, 'nowhere'), join(root, 'dangling'))
  writeFileSync(join(root, 'shot.dat'), PNG)
  writeFileSync(join(root, 'icon.svg'), SVG)
  writeFileSync(join(root, 'fake.png'), 'not really a picture\n')
  return { root, home }
}

/** A real 1 by 1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script>alert(1)</script><rect width="4" height="4"/></svg>\n'

/** Bytes from text and byte lists, in order. */
const bytesOf = (...parts: (string | number[])[]) => Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part) : Buffer.from(part))))

test('an image is known by its bytes, not its name', () => {
  const cases: [string, Buffer, string | null][] = [
    ['png', PNG, 'image/png'],
    ['jpeg', bytesOf([0xff, 0xd8, 0xff, 0xe0, 0, 0x10], 'JFIF', [0]), 'image/jpeg'],
    ['gif', bytesOf('GIF89a', [1, 0, 1, 0, 0, 0, 0]), 'image/gif'],
    ['webp', bytesOf('RIFF', [0x1a, 0, 0, 0], 'WEBPVP8 '), 'image/webp'],
    ['avif', bytesOf([0, 0, 0, 0x1c], 'ftypavif', [0, 0, 0, 0], 'avifmif1miaf'), 'image/avif'],
    ['avif as a compatible brand', bytesOf([0, 0, 0, 0x18], 'ftypmif1', [0, 0, 0, 0], 'mif1avif'), 'image/avif'],
    ['bmp', bytesOf('BM', [0x46, 0, 0, 0, 0, 0, 0, 0, 0x36, 0, 0, 0, 0x28, 0, 0, 0]), 'image/bmp'],
    ['ico', bytesOf([0, 0, 1, 0, 1, 0, 16, 16]), 'image/x-icon'],
    ['svg', Buffer.from(SVG), 'image/svg+xml'],
    ['svg after a mark, a prolog, a comment and a doctype', bytesOf('\ufeff<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [ <!ENTITY a "b"> ]>\n<svg viewBox="0 0 4 4"></svg>'), 'image/svg+xml'],
    ['a cut PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), null],
    ['heic', bytesOf([0, 0, 0, 0x18], 'ftypheic', [0, 0, 0, 0], 'mif1heic'), null],
    ['text that starts like a bitmap', bytesOf('BMW service notes, all of them\n'), null],
    ['a page with an svg inside', bytesOf('<!doctype html><html><body><svg></svg></body></html>'), null],
    ['plain text', bytesOf('plain notes\n'), null],
    ['nothing', Buffer.alloc(0), null],
  ]
  for (const [name, bytes, type] of cases) assert.equal(imageTypeOf(bytes), type, name)
})

test('file.read answers an image with its own bytes as a data URL, whatever its name', async (t) => {
  const { root, home } = fixtures(t)
  assert.deepEqual(await readForViewer(join(root, 'shot.dat'), { home }), {
    kind: 'image',
    path: join(root, 'shot.dat'),
    name: 'shot.dat',
    bytes: PNG.length,
    type: 'image/png',
    url: `data:image/png;base64,${PNG.toString('base64')}`,
  })
  const svg = await readForViewer(join(root, 'icon.svg'), { home })
  assert.equal(svg.kind === 'image' && svg.type, 'image/svg+xml')
  assert.equal(svg.kind === 'image' && Buffer.from(svg.url.replace('data:image/svg+xml;base64,', ''), 'base64').toString(), SVG, 'an SVG goes as an image, never as markup')
  const fake = await readForViewer(join(root, 'fake.png'), { home })
  assert.equal(fake.kind === 'text' && fake.text, 'not really a picture\n', 'a name that says image does not make one')
})

test('file.read refuses an image over 20 MB, and still refuses other binary files', async (t) => {
  const { root, home } = fixtures(t)
  const big = join(root, 'big.png')
  writeFileSync(big, Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(MAX_IMAGE_BYTES + 1 - 8)]))
  await assert.rejects(readForViewer(big, { home }), /image is too large.*20 MB/i)
  const read = await readForViewer(big, { home, maxImageBytes: MAX_IMAGE_BYTES + 10 })
  assert.equal(read.bytes, MAX_IMAGE_BYTES + 1, 'the cap is the only reason it was refused, and an image may pass the text limit')
  await assert.rejects(readForViewer(join(root, 'binary.bin'), { home }), /not a text file/i)
})

test('file.read gives the text of a regular file, with ~/ and symlinks resolved', async (t) => {
  const { root, home } = fixtures(t)
  const readme = await readForViewer('~/Poetry/README.md', { home })
  assert.deepEqual(readme, { kind: 'text', path: join(home, 'Poetry', 'README.md'), name: 'README.md', text: '# Title\n\nSome *words*.\n', bytes: 23, markdown: true })

  assert.deepEqual(await readForViewer(join(root, 'notes.txt'), { home }), { kind: 'text', path: join(root, 'notes.txt'), name: 'notes.txt', text: 'plain notes\n', bytes: 12, markdown: false })
  const code = await readForViewer(join(root, 'code.ts'), { home })
  assert.deepEqual({ kind: code.kind, markdown: code.kind === 'text' && code.markdown }, { kind: 'text', markdown: false })
  assert.deepEqual(await readForViewer(join(root, 'empty.md'), { home }), { kind: 'text', path: join(root, 'empty.md'), name: 'empty.md', text: '', bytes: 0, markdown: true })

  const viaLink = await readForViewer(join(root, 'link.txt'), { home })
  assert.equal(viaLink.path, join(root, 'notes.txt'), 'the answer names the file the link points at')
  assert.equal(viaLink.name, 'notes.txt')
})

test('file.read refuses what is not a small text file, with a plain reason', async (t) => {
  const { root, home } = fixtures(t)
  const refusal = async (path: string) => {
    try {
      await readForViewer(path, { home })
    } catch (error) {
      return (error as Error).message
    }
    return assert.fail(`${path} was read`)
  }
  assert.match(await refusal(join(root, 'binary.bin')), /not a text file/i)
  assert.match(await refusal(join(root, 'latin1.txt')), /not a text file/i)
  assert.match(await refusal(join(root, 'big.txt')), /too large.*2 MB/i)
  assert.match(await refusal(join(root, 'folder')), /not a regular file/i)
  assert.match(await refusal(join(root, 'folder-link')), /not a regular file/i)
  assert.match(await refusal(join(root, 'dangling')), /no file/i)
  assert.match(await refusal(join(root, 'missing.md')), /no file/i)
  assert.match(await refusal('relative/notes.md'), /absolute|~\//)
  assert.match(await refusal('~other/notes.md'), /absolute|~\//)
  assert.match(await refusal('/dev/null'), /not a regular file/i)
  assert.equal(await readForViewer(join(root, 'big.txt'), { home, maxBytes: MAX_FILE_BYTES + 10 }).then((file) => file.bytes), MAX_FILE_BYTES + 1, 'the cap is the only reason it was refused')
})

test('a file opens in its default app only when it is plain and cannot run', async (t) => {
  const { root, home } = fixtures(t)
  assert.equal(await openablePath(join(root, 'link.txt'), { home }), join(root, 'notes.txt'))
  assert.equal(await openablePath('~/Poetry/README.md', { home }), join(home, 'Poetry', 'README.md'))
  // Binary and big files may open in their app: it is the app that reads them. Programs never do.
  assert.equal(await openablePath(join(root, 'binary.bin'), { home }), join(root, 'binary.bin'))
  writeFileSync(join(root, 'run.command'), 'echo hi\n')
  writeFileSync(join(root, 'tool'), 'echo hi\n')
  chmodSync(join(root, 'tool'), 0o755)
  mkdirSync(join(root, 'Thing.app'))
  for (const name of ['run.command', 'tool', 'Thing.app', 'missing.txt']) {
    await assert.rejects(openablePath(join(root, name), { home }), name)
  }
})

test('file.read and file.open run over the socket; only file.open reaches the opener', { timeout: 30000 }, async (t) => {
  const { root } = fixtures(t)
  const opened: string[] = []
  const host = await hostFor(t, { openFile: (path) => opened.push(path) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const read = await client.run<{ text: string; markdown: boolean }>('file.read', { path: join(root, 'notes.txt') })
  assert.equal(read.text, 'plain notes\n')
  const image = await client.run<{ kind: string; type: string; url: string }>('file.read', { path: join(root, 'shot.dat') })
  assert.deepEqual(image, { kind: 'image', path: join(root, 'shot.dat'), name: 'shot.dat', bytes: PNG.length, type: 'image/png', url: `data:image/png;base64,${PNG.toString('base64')}` })
  const refused = await client.command('file.read', { path: join(root, 'binary.bin') })
  assert.equal(refused.ok, false)
  assert.equal(!refused.ok && refused.error.code, 'unavailable')
  assert.equal((await client.command('file.read', { path: 'relative.md' })).ok, false)
  assert.deepEqual(opened, [])

  assert.deepEqual(await client.run('file.open', { path: join(root, 'link.txt') }), { ok: true })
  assert.deepEqual(opened, [join(root, 'notes.txt')])
  assert.equal((await client.command('file.open', { path: join(root, 'folder') })).ok, false)
  assert.deepEqual(opened, [join(root, 'notes.txt')])
})
