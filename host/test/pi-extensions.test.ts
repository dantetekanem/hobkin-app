import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import type { ExtensionEntry, ExtensionsState, PiPackage } from '#shared/pi-resources/wire.ts'
import { PiExtensions } from '../src/pi-extensions.ts'
import { piExtensionSource } from '../src/pi-resources.ts'
import { fakeNpm, gitPackage, npmPackage, piFolder, piPackage, readSettings, writeSettings } from './pi-folder.ts'

/** Pi extensions over Pi's own code, on the test's Pi folder. */
const extensionsOf = (agentDir: string) => new PiExtensions({ source: () => piExtensionSource({ agentDir, cwd: agentDir }) })

const packageNamed = (state: ExtensionsState, name: string): PiPackage => {
  const found = state.packages.find((pkg) => pkg.name === name)
  assert.ok(found, `${name} is listed`)
  return found
}

const switches = (entries: readonly ExtensionEntry[]) => entries.map(({ name, on }) => [name, on])

/** A folder of extensions as the test's settings name it, and an extension in Pi's own extensions folder. */
function ownExtensions(root: string, agentDir: string): { listed: string; inFolder: string } {
  const listed = join(root, 'more', 'listed.ts')
  const inFolder = join(agentDir, 'extensions', 'own.ts')
  for (const file of [listed, inFolder]) {
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, 'export default function extension() {}\n')
  }
  return { listed, inFolder }
}

test("lists Pi's packages, their extensions and the ones built into Pi", async (t) => {
  const { root, agentDir } = piFolder(t)
  const npm = fakeNpm(root, {})
  const local = piPackage(join(root, 'pi-local'), 'pi-local', { version: '0.3.0', extensions: ['extensions/one.ts', 'extensions/two.ts'], skills: { helper: 'Helps.' } })
  npmPackage(agentDir, 'pi-fake', { version: '1.0.0', extensions: ['index.ts'] })
  npmPackage(agentDir, 'pi-themes-only', { version: '4.0.0' })
  const { listed } = ownExtensions(root, agentDir)
  writeSettings(agentDir, {
    npmCommand: npm.command,
    packages: [local, 'npm:pi-fake', { source: 'npm:pi-themes-only' }, 'npm:pi-missing'],
    extensions: [listed, '-extensions/own.ts'],
  })

  const state = await extensionsOf(agentDir).refresh()

  assert.equal(state.error, null)
  assert.equal(state.settings, join(agentDir, 'settings.json'))
  assert.deepEqual(
    state.packages.map(({ name, kind, version, installed, pinned, update, skills }) => [name, kind, version, installed, pinned, update, skills]),
    [
      ['pi-local', 'local', '0.3.0', true, false, null, 1],
      ['pi-fake', 'npm', '1.0.0', true, false, null, 0],
      ['pi-themes-only', 'npm', '4.0.0', true, false, null, 0],
      ['pi-missing', 'npm', null, false, false, null, 0],
    ],
  )
  assert.deepEqual(switches(packageNamed(state, 'pi-local').extensions), [
    ['one.ts', true],
    ['two.ts', true],
  ])
  assert.deepEqual(switches(packageNamed(state, 'pi-fake').extensions), [['pi-fake/index.ts', true]])
  assert.deepEqual(packageNamed(state, 'pi-themes-only').extensions, [])
  assert.equal(packageNamed(state, 'pi-local').folder, local)
  assert.equal(packageNamed(state, 'pi-missing').folder, null)
  assert.deepEqual(
    state.own.map(({ name, on, from }) => [name, on, from]),
    [
      ['more/listed.ts', true, 'settings'],
      ['own.ts', false, 'folder'],
    ],
  )
  assert.deepEqual(
    state.builtIn.map(({ path, name, on, file }) => [path, name, on, file]),
    [
      ['builtin:llama.cpp', 'llama.cpp', true, null],
      ['builtin:codemode', 'codemode', true, null],
      ['builtin:tool-search', 'tool-search', true, null],
      ['builtin:mcp', 'mcp', true, null],
    ],
  )
  assert.equal(existsSync(join(agentDir, 'npm', 'node_modules', 'pi-missing')), false, 'a missing package is not installed')
  assert.deepEqual(
    npm.calls().filter(([command]) => command !== 'root'),
    [],
    'listing asks npm nothing but where its global folder is',
  )
})

test("off and on write Pi's own entry, in the package's filter for a package", async (t) => {
  const { root, agentDir } = piFolder(t)
  const local = piPackage(join(root, 'pi-local'), 'pi-local', { version: '0.3.0', extensions: ['extensions/one.ts', 'extensions/two.ts'] })
  const { inFolder } = ownExtensions(root, agentDir)
  writeSettings(agentDir, { theme: 'dark', packages: [local] })
  const extensions = extensionsOf(agentDir)
  let state = await extensions.refresh()

  const one = packageNamed(state, 'pi-local').extensions[0]!.path
  state = await extensions.turnOff(one)
  assert.deepEqual(switches(packageNamed(state, 'pi-local').extensions), [
    ['one.ts', false],
    ['two.ts', true],
  ])
  assert.deepEqual(readSettings(agentDir).packages, [{ source: local, extensions: ['-extensions/one.ts'] }])

  state = await extensions.turnOff('builtin:mcp')
  state = await extensions.turnOff(inFolder)
  assert.deepEqual(readSettings(agentDir).extensions, ['-builtin:mcp', '-extensions/own.ts'])
  assert.equal(state.builtIn.find(({ path }) => path === 'builtin:mcp')?.on, false)
  assert.equal(state.own.find(({ path }) => path === inFolder)?.on, false)

  state = await extensions.turnOn('builtin:mcp')
  state = await extensions.turnOn(one)
  assert.deepEqual(readSettings(agentDir).extensions, ['-extensions/own.ts', '+builtin:mcp'])
  assert.deepEqual(readSettings(agentDir).packages, [{ source: local, extensions: ['+extensions/one.ts'] }])
  assert.equal(readSettings(agentDir).theme, 'dark')

  // Pi itself, read from scratch, sees the same.
  const again = await extensionsOf(agentDir).refresh()
  assert.deepEqual(switches(packageNamed(again, 'pi-local').extensions), [
    ['one.ts', true],
    ['two.ts', true],
  ])
  assert.equal(again.builtIn.find(({ path }) => path === 'builtin:mcp')?.on, true)
})

test("updates come from Pi's own check, and nothing is installed", { timeout: 30000 }, async (t) => {
  const { root, agentDir } = piFolder(t)
  const npm = fakeNpm(root, { 'pi-fake': '1.4.0', 'pi-current': '2.1.0' })
  npmPackage(agentDir, 'pi-fake', { version: '1.0.0', extensions: ['index.ts'] })
  npmPackage(agentDir, 'pi-current', { version: '2.1.0', extensions: ['index.ts'] })
  npmPackage(agentDir, 'pi-pinned', { version: '2.0.0', extensions: ['index.ts'] })
  const local = piPackage(join(root, 'pi-local'), 'pi-local', { version: '0.3.0', extensions: ['index.ts'] })
  const behind = gitPackage(root, agentDir, 'example.com/test/pi-behind', { version: '1.0.0', extensions: ['index.ts'] })
  const even = gitPackage(root, agentDir, 'example.com/test/pi-even', { version: '1.0.0', extensions: ['index.ts'] })
  behind.advance()
  const remoteBefore = behind.remoteHeadInClone()
  writeSettings(agentDir, {
    npmCommand: npm.command,
    packages: ['npm:pi-fake', 'npm:pi-current', 'npm:pi-pinned@2.0.0', local, behind.source, even.source, 'npm:pi-missing'],
  })
  const extensions = extensionsOf(agentDir)
  const listed = await extensions.refresh()
  assert.equal(listed.updates.checkedAt, null)
  assert.ok(listed.packages.every(({ update }) => update === null), 'nothing is said about updates before Pi checks')

  const state = await extensions.checkUpdates()

  assert.equal(state.updates.checking, false)
  assert.ok(state.updates.checkedAt !== null)
  assert.deepEqual(
    state.packages.map(({ name, pinned, installed, update }) => [name, pinned, installed, update]),
    [
      ['pi-fake', false, true, 'available'],
      ['pi-current', false, true, 'none'],
      ['pi-pinned', true, true, null],
      ['pi-local', false, true, null],
      ['example.com/test/pi-behind', false, true, 'available'],
      ['example.com/test/pi-even', false, true, 'none'],
      ['pi-missing', false, false, null],
    ],
  )
  // Only reading: npm was asked for versions and its global folder, never to install, and git fetched nothing.
  for (const [command] of npm.calls()) assert.ok(command === 'view' || command === 'root', `npm ${command} is a read`)
  assert.deepEqual(
    npm.calls().filter(([command]) => command === 'view').map(([, spec]) => spec).toSorted(),
    ['pi-current', 'pi-fake'],
  )
  assert.equal(behind.remoteHeadInClone(), remoteBefore, 'the clone fetched nothing')
  assert.equal(existsSync(join(agentDir, 'npm', 'node_modules', 'pi-missing')), false)
})

test('a check for updates under way answers the next ask too', async () => {
  let checks = 0
  const extensions = new PiExtensions({
    source: async () => ({
      settingsPath: '/pi/settings.json',
      list: async () => ({ packages: [], extensions: [], problems: [] }),
      setEnabled: async () => {},
      updates: async () => {
        checks += 1
        await new Promise((resolve) => setTimeout(resolve, 20))
        return []
      },
    }),
  })
  await extensions.refresh()
  const [first, second] = await Promise.all([extensions.checkUpdates(), extensions.checkUpdates()])
  assert.equal(checks, 1)
  assert.deepEqual(first, second)
})
