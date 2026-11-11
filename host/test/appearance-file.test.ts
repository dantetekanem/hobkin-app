import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test, type TestContext } from 'node:test'
import { Appearance } from '../src/appearance.ts'
import { AppearanceFile } from '../src/appearance-file.ts'
import { encodeAppearanceStyle } from '../src/appearance-style.ts'

const palette = { background: '#000000', surface: '#07140a', text: '#9dffb0', muted: '#4fbf6a', accent: '#00ff41' }
const content = encodeAppearanceStyle({ palette, border: '#334455' })
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'appearance-file-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = new AppearanceFile(root)
  let changes = 0
  const appearance = new Appearance({ file, onChange: () => changes++ })
  return { root, file, appearance, changes: () => changes, path: join(root, 'client', 'custom.css') }
}

test('canonical edits save before publication and restore from the fixed file', (t) => {
  const { root, file, appearance, path, changes } = fixture(t)
  assert.equal(appearance.load(), false)
  appearance.replaceStyle({ content })
  assert.equal(readFileSync(path, 'utf8'), content)
  assert.equal(file.read({}), content)
  assert.deepEqual(appearance.style, { palette, border: '#334455' })
  const restored = new Appearance({ file: new AppearanceFile(root), onChange() {} })
  assert.equal(restored.load(), true)
  assert.deepEqual(restored.state?.palette, palette)
  appearance.set({ ...palette, accent: '#33ff66' }, 'Legacy')
  assert.equal(appearance.state?.name, 'Legacy')
  assert.match(file.read({})!, /#33ff66/)
  assert.equal(changes(), 2)
})

test('unsupported content and extra capability arguments refuse wholly', (t) => {
  const { file, appearance, path, changes } = fixture(t)
  appearance.replaceStyle({ content })
  const state = appearance.state
  for (const args of [{ content: ':root { display: none; }' }, { content, path: '/elsewhere' }, { content, extra: true }]) {
    assert.throws(() => appearance.replaceStyle(args))
  }
  assert.throws(() => file.read({ path: '/elsewhere' }))
  assert.equal(appearance.state, state)
  assert.equal(readFileSync(path, 'utf8'), content)
  assert.equal(changes(), 1)
})

test('failed save and invalid startup leave the last applied state unchanged', (t) => {
  const { appearance, path, changes } = fixture(t)
  appearance.replaceStyle({ content })
  const state = appearance.state
  writeFileSync(path, 'not supported')
  assert.throws(() => appearance.load())
  rmSync(path)
  mkdirSync(path)
  assert.throws(() => appearance.set(palette))
  assert.equal(appearance.state, state)
  assert.equal(changes(), 1)
})

test('a writer failure preserves both the applied state and the previous canonical bytes', (t) => {
  const { root, path } = fixture(t)
  class FailingFile extends AppearanceFile {
    fail = false
    override replace(args: unknown): string {
      if (this.fail) throw new Error('Injected save failure')
      return super.replace(args)
    }
  }
  const file = new FailingFile(root)
  let changes = 0
  const appearance = new Appearance({ file, onChange: () => { assert.ok(readFileSync(path, 'utf8')); changes++ } })
  appearance.replaceStyle({ content })
  const state = appearance.state
  file.fail = true
  assert.throws(() => appearance.set({ ...palette, accent: '#33ff66' }), /Injected save failure/)
  assert.equal(appearance.state, state)
  assert.equal(readFileSync(path, 'utf8'), content)
  assert.equal(changes, 1)
})

test('rejects symlink files, directories, oversized bytes and symlink client directories', (t) => {
  const { root, file, path } = fixture(t)
  mkdirSync(join(root, 'client'))
  const target = join(root, 'outside.css')
  writeFileSync(target, content)
  symlinkSync(target, path)
  assert.throws(() => file.read({}))
  assert.throws(() => file.replace({ content }))
  assert.equal(readFileSync(target, 'utf8'), content)
  rmSync(path)
  mkdirSync(path)
  assert.throws(() => file.read({}))
  rmSync(path, { recursive: true })
  writeFileSync(path, ' '.repeat(4097))
  assert.throws(() => file.read({}))
  rmSync(join(root, 'client'), { recursive: true })
  symlinkSync(root, join(root, 'client'))
  assert.throws(() => file.replace({ content }))
  assert.throws(() => file.read({}))
  assert.throws(() => new AppearanceFile('relative'))
})
