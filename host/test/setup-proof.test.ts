import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createClientTool } from '../src/client-tool.ts'
import { loadProofRuntime } from '../src/proofs.ts'
import { proofToolsHandlers, setupProofTools } from '../src/setup-proof.ts'
import { afterTest, Client, hostFor } from './support.ts'

const HOME = '/fake.invalid/hobkin-home'
const READY = 'Downloaded TLC 1.7.4 into /fake.invalid/hobkin-home/tools/tla/tla2tools.jar and checked its sha1 and sha256. It runs on Java 21.0.2.'
const NO_JAVA = 'No Java 11 or newer was found. The download of Java 21.0.13.1+2 failed: fetch failed. hobkin kept nothing.'

/** The setup step on a live host, with the installer and the look for the tools it is given. Nothing is downloaded. */
function stepWith(install: (home: string) => Promise<unknown>, found: () => Promise<void> = async () => {}) {
  const handlers = proofToolsHandlers({ live: true, home: () => HOME, install, found })
  return () => handlers['setup.install-proof-tools']!({})
}

test("the setup sets up the TLA+ tools in hobkin's home, answers with hobkin's line, and the tools are looked for again", async () => {
  const homes: string[] = []
  let looked = 0
  const step = stepWith(
    async (home) => (homes.push(home), { ok: true, message: READY, path: `${HOME}/tools/tla/tla2tools.jar` }),
    async () => void looked++,
  )

  assert.deepEqual(await step(), { ok: true, message: READY })
  assert.deepEqual(homes, [HOME])
  assert.equal(looked, 1)
})

test('a failed setup is an answer with its one line, never an error, so the setup goes on', async () => {
  // hobkin's own no, as it said it.
  assert.deepEqual(await stepWith(async () => ({ ok: false, message: NO_JAVA }))(), { ok: false, message: NO_JAVA })
  // An installer that throws: its words, on one line.
  const thrown = stepWith(async () => {
    throw Error('EACCES: permission denied,\n  mkdir /fake.invalid/hobkin-home/tools')
  })
  assert.deepEqual(await thrown(), { ok: false, message: 'EACCES: permission denied, mkdir /fake.invalid/hobkin-home/tools' })
  // A host handed no installer sets up nothing, and says so the same way.
  const bare = proofToolsHandlers({ live: true, home: () => HOME, found: async () => {} })
  assert.deepEqual(await bare['setup.install-proof-tools']!({}), { ok: false, message: "This host installs nothing on this Mac. Only the app's own host does." })
  // Looking for the tools again can fail too, and the answer stays what the setup said.
  const unseen = stepWith(async () => ({ ok: true, message: READY }), async () => {
    throw Error('the folder went away')
  })
  assert.deepEqual(await unseen(), { ok: true, message: READY })
})

test('a second ask while the setup runs gets the same answer, and hobkin sets up once', async () => {
  let runs = 0
  let finish: (said: unknown) => void = () => {}
  const step = stepWith(() => (runs++, new Promise((resolve) => (finish = resolve))))

  const first = step()
  const second = step()
  await new Promise((resolve) => setImmediate(resolve))
  finish({ ok: true, message: READY })
  assert.deepEqual(await Promise.all([first, second]), [{ ok: true, message: READY }, { ok: true, message: READY }])
  assert.equal(runs, 1)

  // Once it ended, the next ask sets up again: what is there already is kept, so that is cheap.
  const third = step()
  await new Promise((resolve) => setImmediate(resolve))
  finish({ ok: true, message: READY })
  await third
  assert.equal(runs, 2)
})

test("the entry's installer is hobkin's own proof setup, given the home, and a hobkin without one says so", async () => {
  const asked: unknown[] = []
  const said = await setupProofTools(HOME, async () => ({ setup: async (input) => (asked.push(input), { ok: true, message: READY }) }))
  assert.deepEqual(said, { ok: true, message: READY })
  assert.deepEqual(asked, [{ home: HOME }])
  await assert.rejects(setupProofTools(HOME, async () => ({})), /cannot set up the TLA\+ tools/)

  // The hobkin checkout the host runs on has it, found the way the proof commands find theirs. Nothing is called.
  assert.equal(typeof (await loadProofRuntime()).setup, 'function')
})

test('only a live host sets up the tools, and hobkin cannot ask for it', async (t) => {
  let runs = 0
  const scripted = proofToolsHandlers({ live: false, home: () => HOME, install: async () => (runs++, { ok: true, message: READY }), found: async () => {} })
  await assert.rejects(async () => scripted['setup.install-proof-tools']!({}), /scripted.*--live/)
  assert.equal(runs, 0)

  // A host started with the default options, on a test's own home, refuses it.
  const host = await hostFor(t)
  const client = await Client.connect(host)
  afterTest(t, () => client.close())
  const refused = await client.command('setup.install-proof-tools', {})
  assert.equal(!refused.ok && refused.error.code, 'unavailable')

  const { COMMANDS } = await import('#shared/commands/registry.ts')
  assert.equal(COMMANDS['setup.install-proof-tools'].outside, true)
  assert.equal('hobkin' in COMMANDS['setup.install-proof-tools'], false)
  const ran: string[] = []
  const tool = createClientTool({ run: async (name) => (ran.push(name), { ok: true, value: null }) })
  await assert.rejects(tool.execute('1', { action: 'run', name: 'setup.install-proof-tools' }), /outside the app/)
  assert.deepEqual(ran, [])
})
