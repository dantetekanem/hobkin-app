import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, delimiter, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import type { PiSetup } from '#shared/protocol/setup.ts'
import { PI_PACKAGES } from '#shared/setup/pi-packages.ts'
import { agentPrompt } from '#shared/setup/agent-prompt.ts'
import { createClientTool } from '../src/client-tool.ts'
import { findProgram, installPackage, installPi, piAgentFolder, piSetup, piSetupHandlers, pinnedPi, programPlaces, refuseInstall, type PiRun } from '../src/pi/install.ts'
import { nodeBuild } from '../src/pi/node.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

type Answer = { stdout: string; stderr?: string } | { error: Error; stdout?: string; stderr?: string }
interface Call { program: string; args: string[]; timeout: number; path: string }

/** Answers by the program's name and its arguments, and writes down every call. Nothing real is ever started. */
const fakeRun = (answers: Record<string, Answer>, calls: Call[] = []): PiRun => (file, args, options, done) => {
  calls.push({ program: file, args: [...args], timeout: options.timeout, path: options.env.PATH ?? '' })
  const answer = answers[[basename(file), ...args].join(' ')] ?? { error: new Error('unexpected') }
  if ('error' in answer) done(answer.error, answer.stdout ?? '', answer.stderr ?? '')
  else done(null, answer.stdout, answer.stderr ?? '')
}

const PI = '/fake.invalid/bin/pi'
const NPM = '/fake.invalid/bin/npm'
const PIN = '1.5.0'
const COMMAND = `npm install -g --ignore-scripts @earendil-works/pi-coding-agent@${PIN}`
const none = (installed: string[] = []) => PI_PACKAGES.filter(({ optional }) => !optional).map(({ name, adds }) => ({ name, adds, installed: installed.includes(name) }))
/** The fake npm has no Node beside it, so it runs on the host's own, as `environment` says. Its version is known without asking. */
const HOST_NODE = { found: true, version: process.versions.node, installs: process.versions.node }

function executable(folder: string, name: string): string {
  mkdirSync(folder, { recursive: true })
  const file = join(folder, name)
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
  return file
}

test('pi and npm are found on the PATH, then where pnpm, npm and Homebrew put them, then beside the host\'s Node', (t) => {
  const folder = temporaryDirectory(t)
  const bin = join(folder, 'bin')
  const pi = executable(bin, 'pi')
  // A file that is not executable, and a folder named pi, are not it.
  writeFileSync(join(folder, 'pi'), '')
  mkdirSync(join(folder, 'dir', 'pi'), { recursive: true })
  assert.equal(findProgram('pi', { path: [join(folder, 'dir'), folder, bin].join(delimiter), home: folder, places: [] }), pi)

  // An app the system started has a short PATH, so the places a person's own installs land are looked in.
  const pnpm = executable(join(folder, 'Library', 'pnpm'), 'pi')
  const npmGlobal = executable(join(folder, '.npm-global', 'bin'), 'npm')
  assert.equal(findProgram('pi', { path: '', home: folder }), pnpm)
  assert.equal(findProgram('npm', { path: '', home: folder }), npmGlobal)
  assert.equal(findProgram('npm', { path: '', home: folder, places: [] }), null)
  assert.deepEqual(programPlaces('/Users/someone'), [
    '/Users/someone/Library/pnpm',
    '/Users/someone/.npm-global/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    dirname(process.execPath),
  ])
})

test("hobkin's own Node is looked in after the usual places and before the host's Node, so its npm and the Pi it installs are found", (t) => {
  const folder = temporaryDirectory(t)
  const own = join(folder, 'hobkin', 'client', 'node', 'bin')
  const npm = executable(own, 'npm')
  const pi = executable(own, 'pi')

  assert.deepEqual(programPlaces('/Users/someone', own).slice(-2), [own, dirname(process.execPath)])
  // Homebrew's folders are left out here, since this Mac may have an npm of its own in them.
  const places = programPlaces(folder, own).filter((place) => place.startsWith(folder))
  assert.equal(findProgram('npm', { path: '', places }), npm)
  assert.equal(findProgram('pi', { path: '', places }), pi)
})

test('the prompt for a coding agent names every place hobkin looks for programs', () => {
  const prompt = agentPrompt({ installed: false, version: null, pinned: PIN, matches: false, canInstall: false, installCommand: COMMAND, packages: none() }, null)
  for (const place of programPlaces('~').filter((place) => place !== dirname(process.execPath))) assert.ok(prompt.includes(place), place)
})

test('the pin is the Pi version hobkin runs on, from its package.json', () => {
  const manifest = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('hobkin/package.json')), 'utf8')) as { peerDependencies: Record<string, string> }
  assert.equal(pinnedPi(), manifest.peerDependencies['@earendil-works/pi-coding-agent'])
})

test('with Pi missing nothing is run, no package is installed, and the install command is still given', async () => {
  const calls: Call[] = []
  const setup = await piSetup({ findPi: () => null, findNpm: () => NPM, run: fakeRun({}, calls), pinned: PIN })
  assert.deepEqual(setup, { installed: false, version: null, pinned: PIN, matches: false, canInstall: true, installCommand: COMMAND, packages: none(), node: HOST_NODE })
  assert.deepEqual(calls, [])
})

test('any Pi from 1.0 passes, whatever the pin, and an older one does not', async () => {
  const versions: [string, boolean][] = [['1.4.2', true], ['1.0.0', true], ['2.0.1', true], ['0.68.0', false]]
  for (const [version, passes] of versions) {
    const run = fakeRun({ 'pi --version': { stdout: `${version}\n` }, 'pi list': { stdout: 'No packages installed.\n' } })
    const setup = await piSetup({ findPi: () => PI, findNpm: () => NPM, run, pinned: PIN })
    assert.deepEqual(setup, { installed: true, version, pinned: PIN, matches: passes, canInstall: true, installCommand: COMMAND, packages: none(), node: HOST_NODE }, version)
  }
})

test('a Pi that prints its version on standard error is read from there when standard output is empty', async () => {
  const run = fakeRun({ 'pi --version': { stdout: '', stderr: '1.5.0\n' }, 'pi list': { stdout: 'No packages installed.\n' } })
  const setup = await piSetup({ findPi: () => PI, findNpm: () => NPM, run, pinned: PIN })
  assert.equal(setup.version, '1.5.0')
  assert.equal(setup.matches, true)
})

test('an optional package is left out of what setup asks for, even when Pi has it, and a required one stays', async () => {
  const optional = PI_PACKAGES.filter((item) => item.optional).map(({ name }) => name)
  assert.ok(optional.includes('pi-search-hub'), 'pi-search-hub is optional')
  const list = ['User packages:', `  npm:pi-coder`, ...optional.map((name) => `  npm:${name}`)].join('\n')
  const run = fakeRun({ 'pi --version': { stdout: '1.5.0\n' }, 'pi list': { stdout: list } })
  const { packages } = await piSetup({ findPi: () => PI, findNpm: () => NPM, run, pinned: PIN })
  const names = packages.map(({ name }) => name)
  for (const name of optional) assert.ok(!names.includes(name), name)
  assert.deepEqual(packages.find(({ name }) => name === 'pi-coder')?.installed, true)
  assert.ok(names.includes('pi-ask-user'))
})

test('the pinned Pi says which packages it has, by their whole names', async () => {
  const calls: Call[] = []
  const list = ['User packages:', '  npm:pi-coder', '    /fake.invalid/lib/pi-coder', '  npm:pi-ask-user-extra', '', 'Project packages:', '  ../../Poetry/pi-agentic-search', ''].join('\n')
  const run = fakeRun({ 'pi --version': { stdout: '1.5.0\n' }, 'pi list': { stdout: list } }, calls)
  const setup = await piSetup({ findPi: () => PI, findNpm: () => NPM, run, pinned: PIN })
  assert.deepEqual(setup, { installed: true, version: PIN, pinned: PIN, matches: true, canInstall: true, installCommand: COMMAND, packages: none(['pi-coder', 'pi-agentic-search']), node: HOST_NODE })
  // Each read is short, and only reads.
  assert.deepEqual(calls.map(({ program, args, timeout }) => [program, ...args, timeout]), [[PI, '--version', 5000], [PI, 'list', 5000]])

  // A list that fails says nothing is installed, and a version that fails is no version.
  const failing = fakeRun({ 'pi --version': { error: new Error('boom') }, 'pi list': { error: new Error('boom') } })
  assert.deepEqual(await piSetup({ findPi: () => PI, findNpm: () => NPM, run: failing, pinned: PIN }), {
    installed: true, version: null, pinned: PIN, matches: false, canInstall: true, installCommand: COMMAND, packages: none(), node: HOST_NODE,
  })
})

test('without npm the window cannot install Pi, and the command for a person to run is still given', async () => {
  const setup = await piSetup({ findPi: () => null, findNpm: () => null, findNode: () => null, run: fakeRun({}), pinned: PIN })
  assert.equal(setup.canInstall, false)
  assert.equal(setup.installCommand, COMMAND)
  assert.deepEqual(setup.node, { found: false, version: null, installs: process.versions.node })

  const calls: Call[] = []
  await assert.rejects(installPi({ findNpm: () => null, run: fakeRun({}, calls), pinned: PIN }), new RegExp(`npm is not on this Mac.*${COMMAND}`))
  assert.deepEqual(calls, [])
})

test('the Node named is the one npm runs on, and without npm a Node found elsewhere than the carried one, by its version', async (t) => {
  const folder = temporaryDirectory(t)
  const npm = executable(join(folder, 'nvm', 'bin'), 'npm')
  const beside = executable(join(folder, 'nvm', 'bin'), 'node')
  const calls: Call[] = []
  const run = fakeRun({ 'node --version': { stdout: 'v22.19.0\n' } }, calls)

  const withNpm = await piSetup({ findPi: () => null, findNpm: () => npm, findNode: () => null, run, pinned: PIN })
  assert.deepEqual(withNpm.node, { found: true, version: '22.19.0', installs: process.versions.node })
  assert.deepEqual(calls.map(({ program, args }) => [program, ...args]), [[beside, '--version']])

  const alone = await piSetup({ findPi: () => null, findNpm: () => null, findNode: () => beside, run, pinned: PIN })
  assert.deepEqual(alone.node, { found: true, version: '22.19.0', installs: process.versions.node })
  assert.equal(alone.canInstall, false, 'a Node without npm cannot install Pi')

  // The Node the app carries for its host sits in the host's own folder, without npm, and is no Node for Pi.
  const carried = await piSetup({ findPi: () => null, findNpm: () => null, findNode: () => join(dirname(process.execPath), 'node'), run, pinned: PIN })
  assert.deepEqual(carried.node, { found: false, version: null, installs: process.versions.node })
})

test('installing Pi runs exactly the pinned npm line, through the npm found, with its Node on the PATH', async () => {
  const calls: Call[] = []
  await installPi({ findNpm: () => NPM, run: fakeRun({ [COMMAND]: { stdout: 'added 1 package\n' } }, calls), pinned: PIN })
  assert.deepEqual(calls.map(({ program, args, timeout }) => [program, args, timeout]), [[NPM, ['install', '-g', '--ignore-scripts', `@earendil-works/pi-coding-agent@${PIN}`], 300000]])
  // npm is a Node script, and a short PATH would leave its `env node` without a Node.
  assert.deepEqual(calls[0]!.path.split(delimiter).slice(0, 2), [dirname(NPM), dirname(process.execPath)])
})

test('a package installs by its name, through the Pi found, and a name not in the catalog is refused', async () => {
  const calls: Call[] = []
  const run = fakeRun({ 'pi install npm:pi-coder': { stdout: 'Installed npm:pi-coder\n' } }, calls)
  await installPackage('pi-coder', { findPi: () => PI, run })
  assert.deepEqual(calls.map(({ program, args, timeout }) => [program, args, timeout]), [[PI, ['install', 'npm:pi-coder'], 300000]])

  await assert.rejects(installPackage('npm:evil-package', { findPi: () => PI, run }), /not one of the Pi packages hobkin sets up/)
  await assert.rejects(installPackage('pi-coder', { findPi: () => null, run }), /Pi is not installed yet/)
  assert.equal(calls.length, 1)
})

test("a failed install says so in plain words, then the program's last lines, with no secret in them", async () => {
  const printed = [
    ...Array.from({ length: 30 }, (_, index) => `npm http fetch GET line ${index + 1}`),
    'npm error code E401',
    'npm error //registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789',
    'npm error Unable to authenticate, need: Bearer realm="npm"',
    '',
  ].join('\n')
  const run = fakeRun({ [COMMAND]: { error: new Error('Command failed'), stderr: printed } })
  const failure = await installPi({ findNpm: () => NPM, run, pinned: PIN }).then(() => null, (error: unknown) => error as Error)
  assert.ok(failure)
  assert.match(failure.message, /^npm could not install Pi\./)
  assert.match(failure.message, /npm error code E401/)
  assert.match(failure.message, /Unable to authenticate/)
  assert.doesNotMatch(failure.message, /line 1\b/, 'only the last lines')
  assert.doesNotMatch(failure.message, /npm_abcdefghijklmnopqrstuvwxyz0123456789/)

  const slow = fakeRun({ 'pi install npm:pi-coder': { error: Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }), stdout: 'Installing npm:pi-coder\n' } })
  await assert.rejects(installPackage('pi-coder', { findPi: () => PI, run: slow }), /^Error: Pi could not install pi-coder\. It took longer than 5 minutes, so it was stopped\.[\s\S]*Installing npm:pi-coder/)
})

const fakeSetup: PiSetup = { installed: false, version: null, pinned: PIN, matches: false, canInstall: true, installCommand: COMMAND, packages: none() }

test('the setup commands install only on a live host, with the installers it was given, and answer with Pi as it is after', async () => {
  const installed: string[] = []
  let reads = 0
  const options = {
    read: async () => (reads++, fakeSetup),
    installPi: async () => void installed.push('pi'),
    installPackage: async (name: string) => void installed.push(name),
  }

  const live = piSetupHandlers({ live: true, ...options, installNode: async () => void installed.push('node') })
  const offered = { ...fakeSetup, canInstallNode: nodeBuild() !== null }
  assert.deepEqual(await live['setup.pi']!({}), offered)
  assert.deepEqual(await live['setup.install-pi']!({}), offered)
  assert.deepEqual(await live['setup.install-package']!({ name: 'pi-ask-user' }), offered)
  assert.deepEqual(await live['setup.install-node']!({}), offered)
  assert.deepEqual(installed, ['pi', 'pi-ask-user', 'node'])
  assert.equal(reads, 4)

  // The scripted development host never installs anything on the Mac, whatever it was handed, and offers no Node.
  const scripted = piSetupHandlers({ live: false, ...options, installNode: async () => void installed.push('node') })
  assert.equal((await scripted['setup.pi']!({})).canInstallNode, false)
  await assert.rejects(async () => scripted['setup.install-pi']!({}), /scripted.*--live/)
  await assert.rejects(async () => scripted['setup.install-package']!({ name: 'pi-coder' }), /scripted.*--live/)
  await assert.rejects(async () => scripted['setup.install-node']!({}), /scripted.*--live/)
  assert.deepEqual(installed, ['pi', 'pi-ask-user', 'node'])

  // A live host handed no Node installer offers none, and refuses one.
  const withoutNode = piSetupHandlers({ live: true, ...options })
  assert.equal((await withoutNode['setup.pi']!({})).canInstallNode, false)
  await assert.rejects(async () => withoutNode['setup.install-node']!({}), /installs nothing on this Mac/)

  // What a host gets when no installer is handed in.
  await assert.rejects(refuseInstall(), /installs nothing on this Mac/)
})

test('with Pi or npm missing, the setup asks the login shell for its PATH again and looks again, and with both found it asks nothing', async () => {
  const everything = { ...fakeSetup, installed: true, version: PIN, matches: true }
  const states = (...answers: PiSetup[]) => {
    let reads = 0
    return { read: async () => answers[Math.min(reads++, answers.length - 1)]!, reads: () => reads }
  }
  const handlers = (read: () => Promise<PiSetup>, refreshPath: () => Promise<boolean>) =>
    piSetupHandlers({ live: true, read, installPi: refuseInstall, installPackage: refuseInstall, refreshPath })

  // Installed by hand while the app was open, in a folder the host's PATH lacked: found once the PATH has it.
  let asked = 0
  const missing = states({ ...fakeSetup, canInstall: false }, everything)
  const found = await handlers(missing.read, async () => (asked++, true))['setup.pi']!({})
  assert.equal(found.installed && found.canInstall, true)
  assert.equal(asked, 1)
  assert.equal(missing.reads(), 2)

  // The shell had nothing new, so Pi is not looked for again.
  asked = 0
  const stillMissing = states(fakeSetup)
  await handlers(stillMissing.read, async () => (asked++, false))['setup.pi']!({})
  assert.equal(asked, 1)
  assert.equal(stillMissing.reads(), 1)

  // Nothing missing, nothing asked.
  asked = 0
  await handlers(states(everything).read, async () => (asked++, true))['setup.pi']!({})
  assert.equal(asked, 0)

  // A refresh that fails is a refresh that found nothing.
  const failing = await handlers(states(fakeSetup).read, async () => Promise.reject(Error('no shell')))['setup.pi']!({})
  assert.equal(failing.installed, false)
})

test('a host started with the default options installs nothing, and hobkin cannot ask it to', async (t) => {
  const host = await hostFor(t, { piSetup: async () => fakeSetup })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  assert.deepEqual(await client.run('setup.pi'), { ...fakeSetup, canInstallNode: false })
  for (const [name, args] of [['setup.install-pi', {}], ['setup.install-package', { name: 'pi-coder' }], ['setup.install-node', {}]] as const) {
    const refused = await client.command(name, args)
    assert.equal(!refused.ok && refused.error.code, 'unavailable', name)
  }
  // Only a name from the catalog reaches the host at all.
  const unknown = await client.command('setup.install-package', { name: 'npm:evil-package' })
  assert.equal(!unknown.ok && unknown.error.code, 'invalid-arguments')

  const { COMMANDS } = await import('#shared/commands/registry.ts')
  for (const name of ['setup.pi', 'setup.install-pi', 'setup.install-package', 'setup.install-node'] as const) assert.equal('hobkin' in COMMANDS[name], false, name)
  assert.equal(COMMANDS['setup.install-pi'].outside, true)
  assert.equal(COMMANDS['setup.install-package'].outside, true)
  assert.equal(COMMANDS['setup.install-node'].outside, true)

  // hobkin's own client tool lists none of them and refuses to run one, so a Node is only ever installed on the user's press.
  const ran: string[] = []
  const tool = createClientTool({ run: async (name) => (ran.push(name), { ok: true, value: null }) })
  const listed = JSON.stringify((await tool.execute('1', { action: 'list' })).details)
  assert.ok(!listed.includes('setup.install-node'))
  await assert.rejects(tool.execute('2', { action: 'run', name: 'setup.install-node' }), /outside the app/)
  assert.deepEqual(ran, [])
})

const SEARCH = PI_PACKAGES.find(({ name }) => name === 'pi-search-hub')

test("a package that needs a setting gets it written in Pi's folder once it is installed, and a setting that is there is left as it is", async (t) => {
  assert.ok(SEARCH, 'the search package is one the setup installs')
  const folder = temporaryDirectory(t)
  const setting = join(folder, 'extensions', 'search.json')
  const run = fakeRun({ [`pi install ${SEARCH.source}`]: { stdout: 'Installed\n' } })

  await installPackage('pi-search-hub', { findPi: () => PI, run, agentDir: () => folder })

  const written = JSON.parse(readFileSync(setting, 'utf8'))
  assert.equal(written.defaultBackend, 'openai-codex', 'it searches through OpenAI')
  assert.equal(written.backends['openai-codex'].enabled, true)

  const theirOwn = '{"defaultBackend":"duckduckgo"}'
  writeFileSync(setting, theirOwn)
  await installPackage('pi-search-hub', { findPi: () => PI, run, agentDir: () => folder })

  assert.equal(readFileSync(setting, 'utf8'), theirOwn)
})

test("a package whose install fails gets no setting, and nothing is written when Pi's folder was not named", async (t) => {
  assert.ok(SEARCH)
  const folder = temporaryDirectory(t)
  const setting = join(folder, 'extensions', 'search.json')
  const failing = fakeRun({ [`pi install ${SEARCH.source}`]: { error: new Error('exit 1'), stderr: 'could not clone\n' } })
  const working = fakeRun({ [`pi install ${SEARCH.source}`]: { stdout: 'Installed\n' } })

  await assert.rejects(installPackage('pi-search-hub', { findPi: () => PI, run: failing, agentDir: () => folder }), /Pi could not install pi-search-hub/)
  await installPackage('pi-search-hub', { findPi: () => PI, run: working })

  assert.equal(existsSync(setting), false)
})

test('no setting the setup writes holds a key', () => {
  const settings = PI_PACKAGES.flatMap(({ name, config }) => (config ? [{ name, text: JSON.stringify(config.value) }] : []))

  assert.ok(settings.length > 0)
  for (const { name, text } of settings) assert.doesNotMatch(text, /key|token|secret|password/i, name)
})

test("Pi's folder is the one Pi itself uses: the one its variable names, or .pi/agent in the home", () => {
  assert.equal(piAgentFolder({}, '/Users/someone'), '/Users/someone/.pi/agent')
  assert.equal(piAgentFolder({ PI_CODING_AGENT_DIR: '/elsewhere/agent' }, '/Users/someone'), '/elsewhere/agent')
  assert.equal(piAgentFolder({ PI_CODING_AGENT_DIR: '~/custom' }, '/Users/someone'), '/Users/someone/custom')
})
