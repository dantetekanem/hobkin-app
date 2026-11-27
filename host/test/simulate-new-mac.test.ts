import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import type { ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { PiSetup, ProgramSignIn, SetupFix, SetupNeeds, SetupSaved } from '#shared/protocol/setup.ts'
import { PI_PACKAGES } from '#shared/setup/pi-packages.ts'
import { parseArguments } from '../src/arguments.ts'
import { simulatedNewMac } from '../src/simulate-new-mac.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

const PACKAGES = PI_PACKAGES.filter(({ optional }) => !optional).map(({ name }) => name)

/** A scripted host on a new home, answering as a Mac with nothing on it. Each install and sign-in takes `ms`. */
async function newMac(t: TestContext, { ms = 0, opened = [] as string[] } = {}) {
  const root = join(temporaryDirectory(t), 'home')
  const host = await hostFor(t, { root, openUrl: (url) => opened.push(url), ...simulatedNewMac({ root, delay: () => ms }) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  return client
}

const fixOf = (fix: SetupFix | null) => (fix?.kind === 'install' ? `install ${fix.what}` : fix?.kind)
const fixes = ({ needs }: SetupNeeds) => Object.fromEntries(needs.map((need) => [need.id, fixOf(need.fix)]))
const missing = ({ needs }: SetupNeeds) => needs.filter((need) => !need.found).map(({ id }) => id)

test('--simulate-new-mac is for the scripted model only', () => {
  assert.equal(parseArguments(['--dev', '--simulate-new-mac']).simulateNewMac, true)
  assert.equal(parseArguments(['--dev']).simulateNewMac, undefined)
  assert.throws(() => parseArguments(['--live', '--simulate-new-mac']), /--simulate-new-mac is for the scripted model/)
})

test('a simulated new Mac never runs on the real hobkin home', () => {
  assert.throws(() => simulatedNewMac({ root: '/somewhere/.hobkin', real: true }), /real hobkin home/)
})

test('a new Mac has nothing: no Node, Pi, packages, git, gh, TLA+ tools or qmd, and no model', async (t) => {
  const client = await newMac(t)

  const pi = await client.run<PiSetup>('setup.pi')
  assert.equal(pi.installed, false)
  assert.equal(pi.canInstall, false, 'no npm')
  assert.equal(pi.node?.found, false)
  assert.equal(pi.canInstallNode, true)
  const installedPackages = pi.packages.filter(({ installed }) => installed)
  assert.deepEqual(installedPackages, [])

  const needs = await client.run<SetupNeeds>('setup.needs')
  const foundNeeds = needs.needs.filter(({ found }) => found)
  assert.deepEqual(foundNeeds, [])
  assert.equal(needs.needs.find(({ id }) => id === 'git')?.problem, 'Needs the command line tools')
  // Every fix is a press: hobkin's own Node brings npm, and npm brings Pi, its packages and qmd.
  assert.deepEqual(fixes(needs), {
    node: 'install node',
    pi: 'install node',
    'sign-in': 'sign-in',
    git: 'install-program',
    gh: 'install-program',
    ...Object.fromEntries(PACKAGES.map((name) => [`package:${name}`, 'install node'])),
    tla: 'install proof-tools',
    'agentic-search': 'install node',
    qmd: 'install node',
  })

  const { status } = await client.run<{ status: ClaudeCodeStatus }>('claude-code.read')
  assert.equal(status.installed, false)
  const models = await client.run<ModelsState>('models.list')
  const connected = models.providers.filter((provider) => provider.connected)
  assert.deepEqual(connected, [])
})

test('an install takes a moment, and only the read after it finds what it brought', async (t) => {
  const client = await newMac(t, { ms: 300 })

  const started = Date.now()
  const installing = client.run<PiSetup>('setup.install-node')
  assert.equal((await client.run<PiSetup>('setup.pi')).node?.found, false, 'not yet')

  const after = await installing
  assert.ok(Date.now() - started >= 300, 'it waited')
  assert.equal(after.node?.found, true)
  assert.equal(after.canInstall, true, 'npm came with it')
  assert.equal((await client.run<PiSetup>('setup.pi')).node?.found, true, 'Look again finds it')
})

test('press by press, the review brings everything, in the order a real Mac needs it', async (t) => {
  const client = await newMac(t)

  const early = await client.command('setup.install-pi')
  assert.equal(early.ok, false)
  assert.match(early.ok ? '' : early.error.message, /npm is not on this Mac/)

  await client.run('setup.install-node')
  await client.run('setup.install-pi')
  for (const name of PACKAGES) await client.run('setup.install-package', { name })
  assert.deepEqual(await client.run('setup.install-proof-tools'), { ok: true, message: 'The TLA+ tools are ready.' })
  for (const name of ['git', 'gh', 'qmd']) await client.run('setup.install-program', { name })

  const pi = await client.run<PiSetup>('setup.pi')
  assert.equal(pi.installed, true)
  assert.equal(pi.matches, true)
  const missingPackages = pi.packages.filter(({ installed }) => !installed)
  assert.deepEqual(missingPackages, [])

  const installed = await client.run<SetupNeeds>('setup.needs')
  assert.deepEqual(missing(installed), ['sign-in', 'gh'])
  assert.equal(fixOf(installed.needs.find(({ id }) => id === 'gh')!.fix), 'sign-in-program')

  const prompt = await client.run<ProgramSignIn>('setup.sign-in-program', { name: 'gh' })
  assert.match(prompt.url, /^https:\/\/[^/]+\.invalid\//)
  assert.match(prompt.code ?? '', /^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  assert.deepEqual(await client.run('setup.sign-in-program-wait', { name: 'gh' }), { signedIn: true, message: null })

  assert.deepEqual(missing(await client.run<SetupNeeds>('setup.needs')), ['sign-in'])
})

test("the setup's sign-in connects the OpenAI subscription after a moment, and no page opens", async (t) => {
  const opened: string[] = []
  const client = await newMac(t, { ms: 200, opened })
  await client.until((view) => view.signIn?.status === 'signed-out', 'signed out')

  await client.run('signin.start', { provider: 'openai' })
  const view = await client.until((now) => now.models?.providers.some(({ id, connected }) => id === 'openai' && connected), 'OpenAI connected')

  assert.equal(view.signIn?.status, 'signed-in')
  assert.ok(view.models!.models.length > 0)
  assert.deepEqual(opened, [])
  const asked = client.received.filter((message) => message.type === 'state' && message.signIn?.status === 'signing-in' && (message.signIn.prompt || message.signIn.authUrl))
  assert.deepEqual(asked, [], 'no page and no question')
  assert.ok(!missing(await client.run<SetupNeeds>('setup.needs')).includes('sign-in'))
})

test('Claude Code, once its agents are on, installs and signs in on its own presses', async (t) => {
  const client = await newMac(t)
  await client.run('claude-code.apply', { enabled: true })

  const claude = async () => (await client.run<SetupNeeds>('setup.needs')).needs.find(({ id }) => id === 'claude')
  assert.equal(fixOf((await claude())!.fix), 'install-program')

  assert.deepEqual(await client.run('setup.install-program', { name: 'claude' }), { finished: true })
  assert.equal(fixOf((await claude())!.fix), 'sign-in-program')

  const prompt = await client.run<ProgramSignIn>('setup.sign-in-program', { name: 'claude' })
  assert.equal(prompt.pastes, true)
  assert.equal(prompt.code, null)
  await client.run('setup.sign-in-program-code', { name: 'claude', code: 'pasted-code' })
  assert.deepEqual(await client.run('setup.sign-in-program-wait', { name: 'claude' }), { signedIn: true, message: null })

  assert.equal((await claude())?.found, true)
  const { status } = await client.run<{ status: ClaudeCodeStatus }>('claude-code.read')
  assert.equal(status.signedIn, true)
})

test('the usage answer is kept with the setup, and nothing goes from this home', async (t) => {
  const client = await newMac(t)

  assert.deepEqual(await client.run('setup.telemetry', { upload: true }), { upload: false })
  assert.equal((await client.run<SetupSaved>('setup.saved')).telemetry, true)
})
