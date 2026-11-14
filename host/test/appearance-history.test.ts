import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { Appearance } from '../src/appearance.ts'
import { appearanceRequest, loadHostAppearance } from '../src/appearance-host.ts'
import { encodeAppearanceStyle } from '../src/appearance-style.ts'
import { createClientTool } from '../src/client-tool.ts'
import { runCommand } from '../src/commands.ts'

const DRACULA = { background: '#282a36', surface: '#343746', text: '#f8f8f2', muted: '#b5b9d6', accent: '#bd93f9' }
const BURGER = { background: '#fff0d3', surface: '#fffaed', text: '#482b1b', muted: '#785b43', accent: '#b93224' }
const HIKING = { background: '#f3f0e6', surface: '#fffcf4', text: '#24392d', muted: '#596452', accent: '#326846' }

/** A data root of its own, and a host appearance on it that can be restarted, as the app restarts. */
function home(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'theme-history-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const logs: string[] = []
  let changes = 0
  const start = () => loadHostAppearance(root, () => (changes += 1), (line) => logs.push(line), async () => root)
  return { root, logs, start, changes: () => changes }
}

test('a custom theme keeps its name across a restart', async (t) => {
  const { start } = home(t)
  const appearance = await start()
  appearance.set(DRACULA, 'Dracula')
  const restarted = await start()
  assert.equal(appearanceRequest(restarted)?.name, 'Dracula')
  assert.deepEqual(appearanceRequest(restarted)?.palette, DRACULA)
})

test('every custom theme is kept, newest first, and a built-in theme does not throw them away', async (t) => {
  const { start } = home(t)
  const appearance = await start()
  appearance.set(DRACULA, 'Dracula', 'dracula!')
  appearance.set(BURGER, 'Burger Joint')
  appearance.use('light')

  const restarted = await start()
  assert.equal(restarted.state, null, 'the built-in theme the user chose still holds after a restart')
  const kept = restarted.kept()
  assert.deepEqual(kept.themes.map(({ name }) => name), ['Burger Joint', 'Dracula'])
  assert.deepEqual([kept.themes[1]!.asked, kept.showing], ['dracula!', false])
  assert.equal(kept.worn, kept.themes[0]!.id, 'Custom brings back the one shown last')

  // Going back to an earlier one shows it, and it is still the one showing after the next restart.
  const dracula = kept.themes[1]!.id
  restarted.pick(dracula)
  const picked = appearanceRequest(restarted)
  assert.deepEqual([picked?.palette, picked?.name, picked?.use], [DRACULA, 'Dracula', undefined])
  assert.deepEqual([restarted.kept().worn, restarted.kept().showing], [dracula, true])
  const again = await start()
  assert.deepEqual([appearanceRequest(again)?.palette, appearanceRequest(again)?.name], [DRACULA, 'Dracula'])
  assert.deepEqual(again.kept().themes.map(({ name }) => name), ['Burger Joint', 'Dracula'], 'putting one back on adds nothing')
})

test('renaming the theme on now changes its title at once; removing keeps the one on now', async (t) => {
  const { start, changes } = home(t)
  const appearance = await start()
  appearance.set(DRACULA, 'Dracula')
  appearance.set(BURGER, 'Burger Joint')
  const [burger, dracula] = appearance.kept().themes.map(({ id }) => id) as [string, string]

  const before = changes()
  const id = appearance.state!.id
  appearance.rename(burger, 'Diner')
  assert.equal(appearance.state?.name, 'Diner')
  assert.ok(appearance.state!.id > id, 'a new receipt, so the window shows the new title')
  appearance.rename(dracula, 'Count')
  assert.equal(appearance.state?.name, 'Diner', 'renaming another leaves the title alone')
  assert.equal(changes(), before + 2, 'each rename reaches the window')

  assert.throws(() => appearance.remove(burger), /on now/)
  appearance.remove(dracula)
  assert.deepEqual((await start()).kept().themes.map(({ name }) => name), ['Diner'])
  assert.throws(() => appearance.pick(dracula), /No kept theme/)
})

test('a photo belongs to the theme it was chosen for', async (t) => {
  const { root, start } = home(t)
  const appearance = await start()
  appearance.set(DRACULA, 'Milky Way')
  appearance.photo('milky-way')
  const milkyWay = appearance.kept().worn!
  appearance.set(HIKING, 'Hiking')
  assert.equal(appearance.state?.background, undefined, 'a new theme does not inherit the last one\'s photo')
  assert.equal(readFileSync(join(root, 'client', 'custom-photo'), 'utf8'), 'none\n')
  appearance.pick(milkyWay)
  assert.deepEqual(appearance.state?.background, { kind: 'photo', id: 'milky-way' })
  assert.deepEqual((await start()).state?.background, { kind: 'photo', id: 'milky-way' })
})

test('a theme saved before the list existed joins it, and a damaged list never stops the theme', async (t) => {
  const { root, logs, start } = home(t)
  mkdirSync(join(root, 'client'))
  writeFileSync(join(root, 'client', 'custom.css'), encodeAppearanceStyle({ palette: BURGER }))
  const upgraded = await start()
  assert.deepEqual(appearanceRequest(upgraded)?.palette, BURGER)
  assert.deepEqual(upgraded.kept().themes.map(({ palette }) => palette), [BURGER])
  assert.equal(upgraded.kept().showing, true)

  writeFileSync(join(root, 'client', 'themes.json'), '{ not json')
  const damaged = await start()
  assert.deepEqual(appearanceRequest(damaged)?.palette, BURGER, 'the theme still shows')
  assert.match(logs.join('\n'), /kept themes/i)
  damaged.set(HIKING, 'Hiking')
  assert.deepEqual((await start()).kept().themes.map(({ name }) => name), ['Hiking', null], 'the next theme writes a sound list again')
})

test('hobkin lists the kept themes with their dates and puts one back on from the chat', async (t) => {
  const { start } = home(t)
  const appearance = await start()
  const handlers = {
    'appearance.set': ({ palette, name, asked }: { palette: typeof DRACULA; name?: string; asked?: string }) => appearance.set(palette, name, asked),
    'appearance.themes': () => appearance.kept(),
    'appearance.pick': ({ id }: { id: string }) => appearance.pick(id),
    'appearance.rename': ({ id, name }: { id: string; name: string }) => appearance.rename(id, name),
    'appearance.remove': ({ id }: { id: string }) => appearance.remove(id),
  }
  const tool = createClientTool({ run: (name, args) => runCommand(handlers as never, name, args) })
  const listed = (JSON.parse((await tool.execute('1', { action: 'list' })).content[0]!.text) as { name: string }[]).map(({ name }) => name)
  for (const name of ['appearance.themes', 'appearance.pick', 'appearance.rename', 'appearance.remove']) assert.ok(listed.includes(name), name)
  assert.match(tool.description, /appearance\.themes/)

  await tool.execute('2', { action: 'run', name: 'appearance.set', args: { palette: DRACULA, name: 'Dracula', asked: 'dracula!' } })
  await tool.execute('3', { action: 'run', name: 'appearance.set', args: { palette: BURGER, name: 'Burger Joint' } })
  const kept = (await tool.execute('4', { action: 'run', name: 'appearance.themes', args: {} })).details as ReturnType<Appearance['kept']>
  assert.ok(kept.themes.every(({ at }) => !Number.isNaN(Date.parse(at))), 'each says when it was made')
  // "Go back to the last theme": the one before the one on now.
  await tool.execute('5', { action: 'run', name: 'appearance.pick', args: { id: kept.themes[1]!.id } })
  assert.equal(appearance.state?.name, 'Dracula')
  await assert.rejects(tool.execute('6', { action: 'run', name: 'appearance.pick', args: { id: '../custom.css' } }))
  await assert.rejects(tool.execute('7', { action: 'run', name: 'appearance.rename', args: { id: kept.themes[0]!.id, name: '' } }))
})
