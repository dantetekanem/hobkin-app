import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { catalogEntry } from '#shared/integrations/catalog.ts'
import { INTEGRATIONS_UNKNOWN, type IntegrationsState } from '#shared/integrations/wire.ts'
import { DEV_UI_ORIGIN } from '../src/access.ts'
import { startHost } from '../src/host.ts'
import { piAgentDirFor, type McpSource } from '../src/integrations.ts'
import { piMcpSource } from '../src/integrations-pi.ts'
import { StateSync } from '../src/state-sync.ts'
import { afterTest, Client, hostFor, temporaryDirectory } from './support.ts'

/** The small MCP server these tests connect to, over stdio, through Pi's own code. */
const FAKE_SERVER = fileURLToPath(new URL('./fixtures/mcp-server.mjs', import.meta.url))
const local = (extra: Record<string, unknown> = {}) => ({ command: process.execPath, args: [FAKE_SERVER], ...extra })

/** A Pi agent folder of the test's own, holding an mcp.json. The user's ~/.pi is never read. */
function piFolder(t: TestContext, content: Record<string, unknown>, indent = 2): string {
  const folder = join(temporaryDirectory(t), 'pi-agent')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'mcp.json'), `${JSON.stringify(content, null, indent)}\n`)
  return folder
}

const readConfig = (folder: string) => JSON.parse(readFileSync(join(folder, 'mcp.json'), 'utf8')) as { mcpServers: Record<string, Record<string, unknown>> }

/** Real Pi for reading and writing the file. Checks never connect, so a service on the internet is never reached. */
async function offlinePi(folder: string): Promise<McpSource> {
  const pi = await piMcpSource({ agentDir: folder, cwd: folder })
  return { ...pi, check: async () => ({ state: 'failed', tools: [], error: 'Not checked in this test.' }) }
}

/** Sets environment variables for one test, and puts back what was there. */
function withEnvironment(t: TestContext, values: Record<string, string | undefined>) {
  const before = Object.fromEntries(Object.keys(values).map((name) => [name, process.env[name]]))
  const apply = (next: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(next)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
  apply(values)
  afterTest(t, () => apply(before))
}

/** The integrations slice a UI holds after the messages received so far. */
function integrationsOf(client: Client): IntegrationsState | null {
  let integrations: IntegrationsState | null = null
  for (const message of client.received) if (message.type === 'state' && message.integrations) integrations = message.integrations
  return integrations
}

const named = (state: IntegrationsState, name: string) => {
  const server = state.servers.find((candidate) => candidate.name === name)
  assert.ok(server, `${name} is listed`)
  return server
}

test('the integrations slice travels whole, only when some of it changed', () => {
  const owner = { state: 'opening' } as const
  const signIn = { status: 'signed-in' } as const
  const sync = new StateSync({ owner, signIn, models: null, integrations: INTEGRATIONS_UNKNOWN })
  assert.deepEqual(sync.full().integrations, INTEGRATIONS_UNKNOWN, 'a UI that connects gets it at once, before anything was read')

  const read: IntegrationsState = { ...INTEGRATIONS_UNKNOWN, path: '~/.pi/agent/mcp.json', checkedAt: '2026-11-10T09:00:00.000Z' }
  assert.deepEqual(sync.update({ owner, signIn, models: null, integrations: read, snapshot: null })?.integrations, read)
  assert.equal(sync.update({ owner, signIn, models: null, integrations: structuredClone(read), snapshot: null }), null, 'nothing changed, nothing sent')
})

test("lists configured servers with Pi's state", { timeout: 30000 }, async (t) => {
  withEnvironment(t, { HOBKIN_TEST_UNSET_VARIABLE: undefined })
  const folder = piFolder(t, {
    mcpServers: {
      notes: local(),
      quiet: local({ enabled: false }),
      keyed: { url: 'http://127.0.0.1:9/mcp', headers: { Authorization: 'Bearer ${HOBKIN_TEST_UNSET_VARIABLE}' } },
      broken: { url: 'not an address' },
    },
  })
  const host = await hostFor(t, { integrations: () => piMcpSource({ agentDir: folder, cwd: folder }) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  await client.until(() => integrationsOf(client) !== null, 'the integrations slice')
  assert.deepEqual(integrationsOf(client), INTEGRATIONS_UNKNOWN, 'nothing is read or started before someone asks')

  const state = await client.run<IntegrationsState>('integrations.refresh')
  assert.deepEqual(
    state.servers.map(({ name }) => name),
    ['notes', 'quiet', 'keyed'],
    'in the order of the file, without the entry Pi could not read',
  )
  assert.equal(named(state, 'notes').state, 'connected')
  assert.deepEqual(named(state, 'notes').tools, [
    { name: 'search_notes', does: 'Searches the notes.', effect: 'reads' },
    { name: 'write_note', does: 'Writes a note.', effect: 'changes' },
    { name: 'tidy', does: 'Tidies up.', effect: 'changes' },
  ])
  assert.equal(named(state, 'quiet').state, 'off', 'a server turned off is listed and never started')
  assert.deepEqual(named(state, 'quiet').tools, [])
  assert.equal(named(state, 'keyed').state, 'failed')
  assert.match(named(state, 'keyed').error ?? '', /HOBKIN_TEST_UNSET_VARIABLE/, "Pi's own message names the variable that is not set")
  assert.equal(state.problems.length, 1, 'the entry Pi could not read is reported')
  assert.match(state.problems[0]!, /broken/)
  assert.equal(state.path, join(folder, 'mcp.json'))
  assert.equal(state.checking, false)
  assert.ok(state.checkedAt)

  await client.until(() => integrationsOf(client)?.checkedAt === state.checkedAt, 'the same state over the socket')
  assert.deepEqual(integrationsOf(client), state)
})

test('a catalog service is added as the catalog writes it, and nothing typed can stand where a key goes', { timeout: 30000 }, async (t) => {
  const folder = piFolder(t, { mcpServers: { notes: local() } })
  const host = await hostFor(t, { integrations: () => offlinePi(folder) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const added = await client.run<IntegrationsState>('integrations.add', { service: 'linear' })
  assert.deepEqual(
    added.servers.map(({ name }) => name),
    ['notes', 'linear'],
  )
  const written = readConfig(folder).mcpServers
  assert.deepEqual(written.linear, catalogEntry('linear')!.entry, 'the catalog entry, as it is')
  assert.deepEqual(written.notes, local(), 'the other entry is as it was')

  // What a person fills in goes only where the entry has a place for it, and never as a reference to read.
  const before = readFileSync(join(folder, 'mcp.json'), 'utf8')
  for (const [args, code] of [
    [{ service: 'linear', headers: { Authorization: 'Bearer typed-into-the-app' } }, 'invalid-arguments'],
    [{ service: 'home-assistant', values: { address: '${HOME_ASSISTANT_TOKEN}' } }, 'unavailable'],
    [{ service: 'home-assistant', values: { address: 'http://127.0.0.1:9/', token: 'typed-into-the-app' } }, 'unavailable'],
    [{ service: 'home-assistant' }, 'unavailable'],
    [{ service: 'no-such-service' }, 'unavailable'],
  ] as const) {
    const refused = await client.command('integrations.add', args)
    assert.equal(!refused.ok && refused.error.code, code, JSON.stringify(args))
  }
  assert.equal(readFileSync(join(folder, 'mcp.json'), 'utf8'), before, 'nothing refused was written')

  // A second server for the same service gets a name of its own, as Pi counts names.
  const again = await client.run<IntegrationsState>('integrations.add', { service: 'home-assistant', values: { address: 'http://127.0.0.1:9/' } })
  assert.equal(named(again, 'home-assistant').entry.url, 'http://127.0.0.1:9/api/mcp')
})

test('off and on change only enabled', { timeout: 30000 }, async (t) => {
  withEnvironment(t, { HOBKIN_TEST_OTHER: undefined })
  const original = {
    autoEnableCodemode: false,
    mcpServers: {
      notes: local({ exposure: 'deferred', toolExposure: { 'write_*': 'hidden' }, 'x-note': 'kept as written' }),
      other: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${HOBKIN_TEST_OTHER}' }, description: 'Another one' },
    },
  }
  const folder = piFolder(t, original, 4)
  const host = await hostFor(t, { integrations: () => piMcpSource({ agentDir: folder, cwd: folder }) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const off = await client.run<IntegrationsState>('integrations.turn-off', { name: 'notes' })
  assert.equal(named(off, 'notes').state, 'off')
  assert.deepEqual(readConfig(folder), { ...original, mcpServers: { ...original.mcpServers, notes: { ...original.mcpServers.notes, enabled: false } } })
  assert.match(readFileSync(join(folder, 'mcp.json'), 'utf8'), /^ {4}"mcpServers"/m, "the file keeps its indentation, as Pi writes it")

  const on = await client.run<IntegrationsState>('integrations.turn-on', { name: 'notes' })
  assert.deepEqual(readConfig(folder), original, 'on, the file reads as it did')
  assert.equal(named(on, 'notes').state, 'connected', 'and Pi connects to it again')

  const unknown = await client.command('integrations.turn-off', { name: 'nobody' })
  assert.equal(!unknown.ok && unknown.error.code, 'unavailable')
  assert.deepEqual(readConfig(folder), original)
})

test('removing deletes only that entry', { timeout: 30000 }, async (t) => {
  const original = { autoEnableCodemode: true, mcpServers: { notes: local(), other: { url: 'https://example.com/mcp', enabled: false, 'x-note': 'kept as written' } } }
  const folder = piFolder(t, original)
  const host = await hostFor(t, { integrations: () => offlinePi(folder) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const removed = await client.run<IntegrationsState>('integrations.remove', { name: 'notes' })
  assert.deepEqual(
    removed.servers.map(({ name }) => name),
    ['other'],
  )
  assert.deepEqual(readConfig(folder), { autoEnableCodemode: true, mcpServers: { other: original.mcpServers.other } })

  const again = await client.command('integrations.remove', { name: 'notes' })
  assert.equal(!again.ok && again.error.code, 'unavailable', 'a server that is not there is said so')
})

test("a failed server carries Pi's message", { timeout: 30000 }, async (t) => {
  const folder = piFolder(t, { mcpServers: { notes: local({ args: [FAKE_SERVER, '--fail', 'notes-server: cannot open the notes folder'] }) } })
  const host = await hostFor(t, { integrations: () => piMcpSource({ agentDir: folder, cwd: folder }) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const failed = await client.run<IntegrationsState>('integrations.refresh')
  assert.equal(named(failed, 'notes').state, 'failed')
  assert.match(named(failed, 'notes').error ?? '', /notes-server: cannot open the notes folder/, 'what the server said, as Pi reports it')

  // The user fixes it outside the app. Looking again is the way to try again.
  writeFileSync(join(folder, 'mcp.json'), JSON.stringify({ mcpServers: { notes: local() } }))
  const fixed = await client.run<IntegrationsState>('integrations.refresh')
  assert.equal(named(fixed, 'notes').state, 'connected')
  assert.equal(named(fixed, 'notes').error, null)
})

test('no credential reaches the socket or the log', { timeout: 30000 }, async (t) => {
  const secrets = ['pa55word-SECRET', 'SECRET-in-query', 'SECRET-literal-header', 'SECRET-arg-value', 'SECRET-env-literal', 'zq-SECRET-value-0077', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789']
  withEnvironment(t, { HOBKIN_TEST_TOKEN: 'zq-SECRET-value-0077' })
  const folder = piFolder(t, {
    mcpServers: {
      literal: { url: 'http://user:pa55word-SECRET@127.0.0.1:9/mcp?api_key=SECRET-in-query', headers: { Authorization: 'Bearer SECRET-literal-header' } },
      chatty: local({
        args: [FAKE_SERVER, '--token', 'SECRET-arg-value'],
        env: { FAKE_MCP_FAIL: 'refused token ${HOBKIN_TEST_TOKEN} and ghp_abcdefghijklmnopqrstuvwxyz0123456789', LITERAL: 'SECRET-env-literal' },
      }),
    },
  })
  const logged: string[] = []
  const host = await hostFor(t, { integrations: () => piMcpSource({ agentDir: folder, cwd: folder }), log: (line) => logged.push(line) })
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const state = await client.run<IntegrationsState>('integrations.refresh')
  assert.equal(named(state, 'chatty').state, 'failed')
  assert.match(named(state, 'chatty').error ?? '', /refused token \[hidden\]/, 'the message stays readable around what was hidden')
  assert.match(named(state, 'literal').entry.url ?? '', /127\.0\.0\.1:9\/mcp/, 'the address still says where it goes')

  const everything = JSON.stringify(client.received) + logged.join('\n')
  for (const secret of secrets) assert.ok(!everything.includes(secret), `${secret} never left the host`)
})

test('development uses its own Pi configuration', { timeout: 30000 }, async (t) => {
  const real = () => '/Users/someone/.pi/agent'
  assert.equal(piAgentDirFor({ live: false, root: '/homes/dev', env: {}, piAgentDir: real }), join('/homes/dev', 'client', 'scripted-agent'))
  assert.equal(piAgentDirFor({ live: false, root: '/homes/dev', env: { PI_CODING_AGENT_DIR: '/tests/pi' }, piAgentDir: () => '/tests/pi' }), '/tests/pi', 'a folder named on purpose')
  assert.equal(piAgentDirFor({ live: true, root: '/homes/real', env: {}, piAgentDir: real }), real(), "a live host reads Pi's own configuration")

  // A scripted host started with nothing else reads the folder in its own home, and never Pi's real one.
  withEnvironment(t, { PI_CODING_AGENT_DIR: undefined })
  const home = join(temporaryDirectory(t), 'home')
  const own = join(home, 'client', 'scripted-agent')
  mkdirSync(own, { recursive: true })
  writeFileSync(join(own, 'mcp.json'), JSON.stringify({ mcpServers: { quiet: local({ enabled: false }) } }))
  const host = await startHost({ root: home, origins: [DEV_UI_ORIGIN] })
  afterTest(t, () => host.close())
  const client = await Client.connect(host)
  afterTest(t, () => client.close())

  const state = await client.run<IntegrationsState>('integrations.refresh')
  assert.equal(state.path, join(own, 'mcp.json'))
  assert.deepEqual(
    state.servers.map(({ name, state: at }) => [name, at]),
    [['quiet', 'off']],
  )
})
