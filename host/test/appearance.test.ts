import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Appearance } from '../src/appearance.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'

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
