import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG, catalogEntry } from '../integrations/catalog.ts'
import { catalogMatch, freeName, isServerName, sameServer, splitServers, targetOf, toolEffect } from '../integrations/servers.ts'
import type { ConfiguredServer, PiServerEntry } from '../integrations/types.ts'

function server(name: string, entry: PiServerEntry, rest: Partial<ConfiguredServer> = {}): ConfiguredServer {
  return { name, entry, state: 'connected', tools: [], error: null, ...rest }
}

const remote = (url: string): PiServerEntry => ({ url })

test('server names follow Pi\'s rule: letters, digits, underscore and hyphen', () => {
  for (const name of ['github', 'home-assistant', 'my_server', 'Docs2', 'a']) assert.ok(isServerName(name), name)
  for (const name of ['', 'two words', 'dots.in.it', 'slash/it', 'émile', 'semi;colon']) assert.ok(!isServerName(name), `"${name}" is refused`)
})

test('names that differ only in - and _ are the same server, as Pi counts them', () => {
  assert.ok(sameServer('home-assistant', 'home_assistant'))
  assert.ok(sameServer('github', 'github'))
  assert.ok(!sameServer('homeassistant', 'home-assistant'), 'a missing character is another name')
  assert.ok(!sameServer('GitHub', 'github'), 'case counts')
})

test('a new server gets a name no configured server already has', () => {
  assert.equal(freeName('linear', []), 'linear')
  assert.equal(freeName('linear', ['github', 'sentry']), 'linear')
  assert.equal(freeName('gmail', ['gmail']), 'gmail-2', 'a taken name gets a number')
  assert.equal(freeName('gmail', ['gmail', 'gmail-2']), 'gmail-3')
  assert.equal(freeName('home-assistant', ['home_assistant']), 'home-assistant-2', 'Pi would count the two spellings as one server')
  assert.equal(freeName('gmail', ['gmail', 'gmail_2']), 'gmail-3', 'the numbered name is checked the same way')
})

test('a configured server is matched to the catalog by where it connects, not by what it is called', () => {
  assert.equal(catalogMatch(server('gh', remote('https://api.githubcopilot.com/mcp/')))?.id, 'github', 'another name, the same address')
  assert.equal(catalogMatch(server('github', remote('https://api.githubcopilot.com/mcp')))?.id, 'github', 'with or without the last slash')
  assert.equal(catalogMatch(server('issues', remote('https://api.githubcopilot.com/mcp/x/issues/readonly')))?.id, 'github', 'a narrower address of the same server')
  assert.equal(catalogMatch(server('sentry', remote('https://mcp.sentry.dev/mcp/acme/storefront')))?.id, 'sentry', 'scoped to one project')
  assert.equal(catalogMatch(server('db', remote('https://mcp.supabase.com/mcp?read_only=true')))?.id, 'supabase', 'the query does not matter')
  assert.equal(catalogMatch(server('stripe', remote('https://mcp.stripe.com/')))?.id, 'stripe', 'an address with no path')
  assert.equal(catalogMatch(server('support', remote('https://mcp.eu.intercom.com/mcp')))?.id, 'intercom', 'another address the maker documents')
  assert.equal(catalogMatch(server('linear', remote('https://MCP.Linear.app/mcp')))?.id, 'linear', 'the host is compared without case')
})

test('a server that only shares a name with a catalog entry is the person\'s own', () => {
  assert.equal(catalogMatch(server('gmail', { command: 'node', args: ['~/tools/mail/server.js'] })), null, 'a local command called gmail is not Google\'s server')
  assert.equal(catalogMatch(server('github', remote('https://example.com/mcp'))), null, 'another address called github')
  assert.equal(catalogMatch(server('notion', remote('https://mcp.notion.com.example.org/mcp'))), null, 'a host that only starts the same')
  assert.equal(catalogMatch(server('linear', remote('https://mcp.linear.app/mcpx'))), null, 'a path that only starts the same')
  assert.equal(catalogMatch(server('odd', remote('not an address'))), null, 'an address that cannot be read')
})

test('Home Assistant runs at the person\'s own address, so it is known by its path and its name together', () => {
  const local = remote('http://homeassistant.local:8123/api/mcp')
  assert.equal(catalogMatch(server('homeassistant', local))?.id, 'home-assistant')
  assert.equal(catalogMatch(server('home-assistant', local))?.id, 'home-assistant')
  assert.equal(catalogMatch(server('home_assistant', remote('https://house.example.org/api/mcp/assist')))?.id, 'home-assistant', 'one set of tools at its own address')
  assert.equal(catalogMatch(server('homeassistant', remote('http://homeassistant.local:8123/other'))), null, 'the name alone is not enough')
  assert.equal(catalogMatch(server('wiki', remote('https://wiki.example.org/api/mcp'))), null, 'the path alone is not enough')
})

test('configured servers split into the catalog\'s and the person\'s own, and the rest of the catalog can be added', () => {
  const docs = server('docs', { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } })
  const files = server('filesystem', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] })
  const stripe = server('stripe', remote('https://mcp.stripe.com'), { state: 'off' })
  const github = server('gh', remote('https://api.githubcopilot.com/mcp/'))
  const split = splitServers([docs, stripe, files, github])

  assert.deepEqual(split.connected.map((item) => [item.entry.id, item.server.name]), [['github', 'gh'], ['stripe', 'stripe']], 'in the catalog\'s order, each with its own server')
  assert.deepEqual(split.own.map((item) => item.name), ['docs', 'filesystem'], 'in the order of the file')
  assert.ok(!split.available.some((entry) => entry.id === 'github' || entry.id === 'stripe'), 'a service that is configured is not offered again')
  assert.equal(split.available.length, CATALOG.length - 2)
  assert.deepEqual(split.available.map((entry) => entry.id), CATALOG.filter((entry) => entry.id !== 'github' && entry.id !== 'stripe').map((entry) => entry.id), 'in the catalog\'s order')
})

test('two servers for one service both show, such as one per account', () => {
  const split = splitServers([server('sentry-work', remote('https://mcp.sentry.dev/mcp/acme')), server('sentry-home', remote('https://mcp.sentry.dev/mcp/hobby'))])
  assert.deepEqual(split.connected.map((item) => item.server.name), ['sentry-work', 'sentry-home'])
  assert.ok(!split.available.some((entry) => entry.id === 'sentry'))
})

test('with nothing configured, everything in the catalog can be added', () => {
  const split = splitServers([])
  assert.deepEqual(split.connected, [])
  assert.deepEqual(split.own, [])
  assert.equal(split.available.length, CATALOG.length)
})

test('a server is shown by its address or by its command line, with references left as references', () => {
  assert.deepEqual(targetOf({ url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } }), { kind: 'remote', text: 'https://example.com/mcp' })
  assert.deepEqual(targetOf({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '.'] }), { kind: 'command', text: 'npx -y @modelcontextprotocol/server-filesystem .' })
  assert.deepEqual(targetOf({ command: 'uvx' }), { kind: 'command', text: 'uvx' })
  assert.deepEqual(targetOf(catalogEntry('github')!.entry), { kind: 'remote', text: 'https://api.githubcopilot.com/mcp/' })
})

test('a tool counts as changing unless its server says it only reads', () => {
  assert.equal(toolEffect({ readOnlyHint: true }), 'reads')
  assert.equal(toolEffect({ readOnlyHint: false }), 'changes')
  assert.equal(toolEffect({}), 'changes', 'no hint is treated as the riskier case')
  assert.equal(toolEffect(undefined), 'changes')
  assert.equal(toolEffect({ readOnlyHint: true, destructiveHint: true }), 'changes', 'a tool that says both is not trusted to only read')
})
