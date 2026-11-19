import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { DIRECTIONS_MAX_BYTES, type DirectionsFile, type DirectionsSaved } from '#shared/protocol/directions.ts'
import { Unavailable } from '../src/commands.ts'
import { readDirections, saveDirections } from '../src/directions.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const hobkinDefault = () => readFileSync(fileURLToPath(import.meta.resolve('hobkin/src/prompts/agents-default.md')), 'utf8')
const refusedWith = (words: RegExp) => (error: unknown) => error instanceof Unavailable && words.test(error.message)

function homeWith(t: Parameters<typeof temporaryDirectory>[0], text?: string): { root: string; file: string } {
  const root = temporaryDirectory(t)
  const file = join(root, 'AGENTS.md')
  if (text !== undefined) writeFileSync(file, text, { mode: 0o600 })
  return { root, file }
}

test("the directions read whole from AGENTS.md in hobkin's home, with a version made of their bytes", async (t) => {
  const { root, file } = homeWith(t, '# Directions\n\nBe brief. Café first.\n')
  assert.deepEqual(readDirections(root), { path: file, text: '# Directions\n\nBe brief. Café first.\n', version: sha('# Directions\n\nBe brief. Café first.\n'), exists: true })
})

test("a home with no AGENTS.md yet shows hobkin's default, says so, and writes nothing", async (t) => {
  const { root, file } = homeWith(t)
  assert.deepEqual(readDirections(root), { path: file, text: hobkinDefault(), version: 'missing', exists: false })
  assert.equal(existsSync(file), false, 'hobkin writes the default itself the first time it reads it')
})

test("a save replaces the file in one rename, keeps its mode, and reads back as the version it answers", async (t) => {
  const { root, file } = homeWith(t, 'Old.\n')
  chmodSync(file, 0o640)
  const before = statSync(file)
  const { version } = readDirections(root)

  const saved = saveDirections(root, { text: 'New, with ü and 日本.\n', version })
  assert.equal(saved.saved, true)
  assert.equal(readFileSync(file, 'utf8'), 'New, with ü and 日本.\n')
  assert.deepEqual(saved.saved && saved.file, readDirections(root))
  assert.equal(statSync(file).mode & 0o777, 0o640)
  assert.notEqual(statSync(file).ino, before.ino, 'a new file renamed over the old one, never written in place')
  assert.deepEqual(readdirSync(root), ['AGENTS.md'], 'no temporary file is left beside it')
})

test('a save to a home with no AGENTS.md creates it, private', async (t) => {
  const { root, file } = homeWith(t)
  const saved = saveDirections(root, { text: 'Mine.\n', version: readDirections(root).version })
  assert.equal(saved.saved, true)
  assert.equal(readFileSync(file, 'utf8'), 'Mine.\n')
  assert.equal(statSync(file).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(root), ['AGENTS.md'])
})

test('a save never overwrites a copy written since it was read, and saves once read again', async (t) => {
  const { root, file } = homeWith(t, 'Mine.\n')
  const opened = readDirections(root)
  writeFileSync(file, 'An agent wrote this.\n')

  const refused = saveDirections(root, { text: 'My edit.\n', version: opened.version })
  assert.equal(refused.saved, false)
  assert.match(!refused.saved ? refused.message : '', /changed since .* opened.*Nothing was saved/)
  assert.equal(readFileSync(file, 'utf8'), 'An agent wrote this.\n')
  assert.deepEqual(readdirSync(root), ['AGENTS.md'])

  const again = readDirections(root)
  assert.equal(again.text, 'An agent wrote this.\n')
  assert.equal(saveDirections(root, { text: 'My edit.\n', version: again.version }).saved, true)
  assert.equal(readFileSync(file, 'utf8'), 'My edit.\n')
})

test('a save refuses when the file appeared, or went, since it was read', async (t) => {
  const appeared = homeWith(t)
  const missing = readDirections(appeared.root)
  writeFileSync(appeared.file, 'hobkin wrote its default.\n')
  assert.equal(saveDirections(appeared.root, { text: 'Mine.\n', version: missing.version }).saved, false)
  assert.equal(readFileSync(appeared.file, 'utf8'), 'hobkin wrote its default.\n')

  const went = homeWith(t, 'Here.\n')
  const opened = readDirections(went.root)
  unlinkSync(went.file)
  assert.equal(saveDirections(went.root, { text: 'Mine.\n', version: opened.version }).saved, false)
  assert.equal(existsSync(went.file), false)
})

test('a save over the cap in UTF-8 bytes is refused with its size, and the cap itself saves', async (t) => {
  const { root, file } = homeWith(t, 'Small.\n')
  const { version } = readDirections(root)
  // 32,769 characters, 65,538 bytes: the cap is on bytes.
  const wide = 'é'.repeat(32769)
  assert.throws(() => saveDirections(root, { text: wide, version }), refusedWith(/65,538 bytes.*65,536.*Nothing was saved/))
  assert.equal(readFileSync(file, 'utf8'), 'Small.\n')

  const full = 'a'.repeat(DIRECTIONS_MAX_BYTES)
  assert.equal(saveDirections(root, { text: full, version }).saved, true)
  assert.equal(readFileSync(file, 'utf8'), full)
})

test('a file over the cap does not open, since hobkin refuses it whole too', async (t) => {
  const { root } = homeWith(t, 'a'.repeat(DIRECTIONS_MAX_BYTES + 1))
  assert.throws(() => readDirections(root), refusedWith(/65,537 bytes.*65,536/))
})

test('a link, a folder or anything but a regular file is neither read nor saved over', async (t) => {
  const linked = homeWith(t)
  const target = join(linked.root, 'elsewhere.md')
  writeFileSync(target, 'Not the directions.\n')
  symlinkSync(target, linked.file)
  assert.throws(() => readDirections(linked.root), refusedWith(/not a regular file/))
  assert.throws(() => saveDirections(linked.root, { text: 'Mine.\n', version: sha('Not the directions.\n') }), refusedWith(/not a regular file/))
  assert.equal(lstatSync(linked.file).isSymbolicLink(), true)
  assert.equal(readFileSync(target, 'utf8'), 'Not the directions.\n')

  const folder = homeWith(t)
  mkdirSync(folder.file)
  assert.throws(() => readDirections(folder.root), refusedWith(/not a regular file/))
  assert.throws(() => saveDirections(folder.root, { text: 'Mine.\n', version: 'missing' }), refusedWith(/not a regular file/))
  assert.equal(statSync(folder.file).isDirectory(), true)
})

test('the window reads and saves the directions through the host', async (t) => {
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const opened = await client.run<DirectionsFile>('directions.read')
  assert.ok(opened.path.startsWith(host.root) && opened.path.endsWith('/AGENTS.md'), opened.path)
  const saved = await client.run<DirectionsSaved>('directions.save', { text: 'Be brief.\n', version: opened.version })
  assert.equal(saved.saved, true)
  assert.equal(readFileSync(opened.path, 'utf8'), 'Be brief.\n')

  const stale = await client.run<DirectionsSaved>('directions.save', { text: 'Again.\n', version: opened.version })
  assert.equal(stale.saved, false)
  const malformed = await client.command('directions.save', { text: 'x', version: 'latest' })
  assert.equal(!malformed.ok && malformed.error.code, 'invalid-arguments')
  assert.equal(readFileSync(opened.path, 'utf8'), 'Be brief.\n')
})
