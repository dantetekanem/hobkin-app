import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Appearance } from '../src/appearance.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadHostAppearance, appearanceRequest } from '../src/appearance-host.ts'
import { encodeAppearanceStyle } from '../src/appearance-style.ts'

test('host appearance uses the admitted data root, loads without early publication, and saves before publishing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-host-'))
  try {
    const data = join(root, 'admitted')
    mkdirSync(join(data, 'client'), { recursive: true })
    writeFileSync(join(data, 'client/custom.css'), encodeAppearanceStyle({ palette: MATRIX, border: '#abcdef' }))
    let publications = 0
    const appearance = await loadHostAppearance(root, () => {
      publications += 1
      assert.match(readFileSync(join(data, 'client/custom.css'), 'utf8'), /#33ff66/)
    }, () => {}, async (requested) => { assert.equal(requested, root); return data })
    assert.equal(appearanceRequest(appearance)?.border, '#abcdef')
    assert.equal(publications, 0)
    appearance.set({ ...MATRIX, accent: '#33ff66' })
    assert.equal(publications, 1)
    const reloaded = await loadHostAppearance(root, () => {}, () => {}, async () => data)
    assert.equal(appearanceRequest(reloaded)?.palette.accent, '#33ff66')
    assert.equal(appearanceRequest(reloaded)?.border, undefined)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('optional invalid styles report an error without publication; missing roots remain first-start fallback', async () => {
  const root = mkdtempSync(join(tmpdir(), 'theme-host-fallback-'))
  try {
    const errors: string[] = []
    const absent = await loadHostAppearance(root, () => assert.fail('must not publish'), (error) => errors.push(error), async () => join(root, 'missing'))
    assert.equal(absent.state, null)
    assert.deepEqual(errors, new Array<string>())
    mkdirSync(join(root, 'client'))
    writeFileSync(join(root, 'client/custom.css'), ':root { width: 100vw; }')
    const invalid = await loadHostAppearance(root, () => assert.fail('must not publish'), (error) => errors.push(error), async () => root)
    assert.equal(invalid.state, null)
    assert.match(errors[0]!, /custom theme.*Unsupported/i)
    await assert.rejects(loadHostAppearance(root, () => {}, () => {}, async () => { throw Error('admission refused') }), /admission refused/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

const MATRIX = { background: '#000000', surface: '#07140a', text: '#9dffb0', muted: '#4fbf6a', accent: '#00ff41' }

function toolFor() {
  let changes = 0
  const appearance = new Appearance({ onChange: () => (changes += 1) })
  const handlers = { 'appearance.set': ({ palette, name }: { palette: typeof MATRIX; name?: string }) => appearance.set(palette, name) }
  const tool = createClientTool({ run: (name, args) => runCommand(handlers as never, name, args) })
  return { appearance, tool, changes: () => changes }
}

test('hobkin sets the app theme through the client tool', async () => {
  const { appearance, tool, changes } = toolFor()
  const listed = JSON.parse((await tool.execute('1', { action: 'list' })).content[0]!.text) as { name: string }[]
  assert.ok(listed.some(({ name }) => name === 'appearance.set'))
  assert.match(tool.description, /appearance\.set/)

  await tool.execute('2', { action: 'run', name: 'appearance.set', args: { palette: MATRIX, name: 'Matrix' } })
  assert.deepEqual([appearance.state?.palette, appearance.state?.name, changes()], [MATRIX, 'Matrix', 1])
  const first = appearance.state!.id
  await tool.execute('3', { action: 'run', name: 'appearance.set', args: { palette: { ...MATRIX, accent: '#33ff66' } } })
  assert.ok(appearance.state!.id > first, 'every request is new, so the window applies it once')
})

test('a palette the window would refuse is refused with the reason, so hobkin can retry', async () => {
  const { appearance, tool } = toolFor()
  await assert.rejects(tool.execute('1', { action: 'run', name: 'appearance.set', args: { palette: { ...MATRIX, text: '#0a1a0d' } } }), /Text on the background is .* to 1/)
  await assert.rejects(tool.execute('2', { action: 'run', name: 'appearance.set', args: { palette: { ...MATRIX, accent: 'green' } } }), Error)
  assert.equal(appearance.state, null)
})
