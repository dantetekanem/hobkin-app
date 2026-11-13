import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Appearance } from '../src/appearance.ts'
import { AppearanceFile } from '../src/appearance-file.ts'
import { appearanceRequest } from '../src/appearance-host.ts'
import { checkArguments } from '../../shared/commands/registry.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'

const palette = { background: '#080c1b', surface: '#151b30', text: '#f1f3ff', muted: '#b2bbd5', accent: '#b89af5' }
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'appearance-photo-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = new AppearanceFile(root)
  const appearance = new Appearance({ file, onChange() {} })
  appearance.set(palette, 'Milky Way')
  return { root, file, appearance, path: join(root, 'client', 'custom-photo') }
}

test('photo selection saves before publication, restores per root, and can be disabled', (t) => {
  const { root, file, path } = fixture(t)
  let publishedPhoto = false
  const appearance = new Appearance({ file, onChange() {
    if (appearance.state?.background?.kind === 'photo') {
      assert.equal(readFileSync(path, 'utf8'), 'milky-way\n')
      publishedPhoto = true
    }
  } })
  appearance.load()
  appearance.photo('milky-way')
  assert.equal(publishedPhoto, true)
  assert.equal(readFileSync(path, 'utf8'), 'milky-way\n')
  assert.deepEqual(appearanceRequest(appearance)?.background, { kind: 'photo', id: 'milky-way' })
  const restored = new Appearance({ file: new AppearanceFile(root), onChange() {} })
  restored.load()
  assert.deepEqual(restored.state?.background, { kind: 'photo', id: 'milky-way' })
  const other = fixture(t)
  assert.equal(other.appearance.state?.background, undefined)
  appearance.photo(null)
  restored.load()
  assert.equal(restored.state?.background, undefined)
  assert.deepEqual(restored.state?.palette, palette)
})

test('built-in themes hide photos across restart without deleting the bundled selection', (t) => {
  const { root, appearance, path } = fixture(t)
  appearance.photo('milky-way')
  for (const theme of ['light', 'dark', 'system'] as const) {
    appearance.use(theme)
    assert.equal(appearance.state?.background, undefined)
    const restarted = new Appearance({ file: new AppearanceFile(root), onChange() {} })
    assert.equal(restarted.load(), false)
    assert.throws(() => appearance.photo('milky-way'), /custom theme/i)
    assert.equal(readFileSync(path, 'utf8'), 'milky-way\n')
    appearance.set(palette)
  }
})

test('main client tool lists and executes the bounded photo command', async (t) => {
  const { appearance } = fixture(t)
  const handlers = { 'appearance.photo': ({ id }: { id: 'milky-way' | null }) => appearance.photo(id) }
  const tool = createClientTool({ run: (name, args) => runCommand(handlers as never, name, args) })
  const listed = JSON.parse((await tool.execute('list', { action: 'list' })).content[0]!.text) as { name: string }[]
  assert.ok(listed.some(command => command.name === 'appearance.photo'))
  await tool.execute('photo', { action: 'run', name: 'appearance.photo', args: { id: 'milky-way' } })
  assert.equal(appearance.state?.background?.kind, 'photo')
  await tool.execute('off', { action: 'run', name: 'appearance.photo', args: { id: null } })
  assert.equal(appearance.state?.background, undefined)
  await assert.rejects(tool.execute('bad', { action: 'run', name: 'appearance.photo', args: { id: '../outside' } }))
})

test('photo command admits only a known ID or off, not paths, URLs, bytes or extra keys', (t) => {
  const { appearance } = fixture(t)
  assert.equal(checkArguments('appearance.photo', { id: 'milky-way' }).ok, true)
  assert.equal(checkArguments('appearance.photo', { id: null }).ok, true)
  for (const id of ['../secret', '/private/image.jpg', 'https://invalid.test/a.jpg', 'data:image/svg+xml;base64,AAAA', 'x'.repeat(2_000_001), {}, 1]) {
    assert.equal(checkArguments('appearance.photo', { id }).ok, false)
    assert.throws(() => appearance.photo(id as never))
  }
  assert.equal(checkArguments('appearance.photo', { id: 'milky-way', path: '/private/file' }).ok, false)
  assert.throws(() => appearance.replaceStyle({ content: ':root { --hb-photo: milky-way; }' }))
})

test('unsafe marker files and directories fail without publishing or modifying a symlink target', (t) => {
  const { root, appearance, path } = fixture(t)
  const target = join(root, 'outside')
  writeFileSync(target, 'milky-way\n')
  symlinkSync(target, path)
  const before = appearance.state
  assert.throws(() => appearance.photo('milky-way'))
  assert.throws(() => appearance.load())
  assert.equal(appearance.state, before)
  assert.equal(readFileSync(target, 'utf8'), 'milky-way\n')
  rmSync(path)
  for (const bytes of ['x'.repeat(65), '<svg/>', '../../outside', 'https://invalid.test/image.jpg']) {
    writeFileSync(path, bytes)
    assert.throws(() => appearance.load())
    assert.equal(appearance.state, before)
  }
  rmSync(path)
  mkdirSync(path)
  assert.throws(() => appearance.photo('milky-way'))
  rmSync(join(root, 'client'), { recursive: true })
  symlinkSync(root, join(root, 'client'))
  assert.throws(() => appearance.photo('milky-way'))
  assert.throws(() => appearance.load())
})
