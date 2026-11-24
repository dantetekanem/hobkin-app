import assert from 'node:assert/strict'
import { test } from 'node:test'
import { HIDDEN, redactEntry, referencedNames, scrubText } from '../integrations/redact.ts'
import type { PiServerEntry } from '../integrations/types.ts'

test('a value written into an entry is hidden, and a reference to the environment is kept', () => {
  const remote = {
    url: 'https://api.example.com/mcp',
    headers: { Authorization: 'Bearer abc123literal', 'X-Api-Key': '${EXAMPLE_KEY}', 'X-Other': 'Bearer $OTHER_TOKEN', 'X-Run': '!security find-generic-password -w -s example' },
    oauth: { clientId: 'client-123', clientSecret: 'shh-literal-secret', callbackPort: 8765 },
  } as PiServerEntry
  assert.deepEqual(redactEntry(remote), {
    url: 'https://api.example.com/mcp',
    headers: { Authorization: HIDDEN, 'X-Api-Key': '${EXAMPLE_KEY}', 'X-Other': 'Bearer $OTHER_TOKEN', 'X-Run': HIDDEN },
    oauth: { clientId: 'client-123', clientSecret: HIDDEN, callbackPort: 8765 },
  })

  const local: PiServerEntry = {
    command: 'npx',
    args: ['-y', 'tools-mcp', '--api-key', 'abc-literal', '--token=def-literal', '--verbose', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    env: { TOKEN: 'raw-literal', HOME_URL: '${HOME_URL}', LOG_LEVEL: 'debug' },
  }
  assert.deepEqual(redactEntry(local), {
    command: 'npx',
    args: ['-y', 'tools-mcp', '--api-key', HIDDEN, `--token=${HIDDEN}`, '--verbose', HIDDEN],
    env: { TOKEN: HIDDEN, HOME_URL: '${HOME_URL}', LOG_LEVEL: HIDDEN },
  })
})

test('secrets in an address are hidden, and the address still says where it goes', () => {
  const at = (url: string) => (redactEntry({ url }) as { url: string }).url
  assert.equal(at('https://user:pa55word@mcp.example.com/mcp?api_key=k3y&project=storefront'), `https://user:${HIDDEN}@mcp.example.com/mcp?api_key=${HIDDEN}&project=storefront`)
  assert.equal(at('https://mcp.zapier.com/api/mcp/s/ODk3ZGE2NWQtYjM4Ni00ZTJlLThlNTctN2M0ZmI1ZmZmNjE5/mcp'), `https://mcp.zapier.com/api/mcp/s/${HIDDEN}/mcp`)
  assert.equal(at('http://homeassistant.local:8123/api/mcp'), 'http://homeassistant.local:8123/api/mcp')
})

test('fields hobkin does not know are kept, with secrets in them hidden', () => {
  const entry = {
    url: 'https://example.com/mcp',
    exposure: 'deferred',
    toolExposure: { 'delete_*': 'hidden' },
    apiKey: 'literal-key',
    extra: { password: 'p4ss', note: 'kept' },
    timeout: 30,
    enabled: false,
  } as unknown as PiServerEntry
  assert.deepEqual(redactEntry(entry), {
    url: 'https://example.com/mcp',
    exposure: 'deferred',
    toolExposure: { 'delete_*': 'hidden' },
    apiKey: HIDDEN,
    extra: { password: HIDDEN, note: 'kept' },
    timeout: 30,
    enabled: false,
  })
})

test('the entry passed in is not changed', () => {
  const entry: PiServerEntry = { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer literal' } }
  redactEntry(entry)
  assert.deepEqual(entry, { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer literal' } })
})

test('text from a server loses anything shaped like a credential, and stays readable otherwise', () => {
  const shapes = [
    'Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    'github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz',
    'xoxb-1234567890-abcdefghij',
    'sk_live_abcdefghijklmnop1234',
    'sk-proj-abcdefghijklmnop1234',
    'AKIAABCDEFGHIJKLMNOP',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
    'glpat-abcdefghijklmnop1234',
  ]
  for (const shape of shapes) {
    const said = scrubText(`401 Unauthorized while sending ${shape} to the server`)
    assert.ok(said.includes(HIDDEN), `${shape} is hidden`)
    assert.ok(!said.includes(shape.slice(-12)), `nothing of ${shape} is left`)
  }
  assert.equal(scrubText('token=abc123 and password: hunter2'), `token=${HIDDEN} and password: ${HIDDEN}`)
  assert.equal(scrubText('connect to https://me:pw@db.example.com failed'), `connect to https://me:${HIDDEN}@db.example.com failed`)
  const path = 'spawn /Users/someone/Poetry/hobkin-client/node_modules/.bin/notes-server ENOENT'
  assert.equal(scrubText(path), path, 'a path stays readable')
  assert.equal(scrubText('Request timed out after 60 seconds.'), 'Request timed out after 60 seconds.')
})

test('a value known to be secret is hidden wherever it shows up', () => {
  assert.equal(scrubText('the server said zq-value-77 is wrong', ['zq-value-77']), `the server said ${HIDDEN} is wrong`)
  assert.equal(scrubText('nothing to hide', ['']), 'nothing to hide', 'an empty value hides nothing')
})

test('the names an entry reads from the environment are found in both of Pi\'s spellings', () => {
  const entry: PiServerEntry = { command: 'tools', env: { A: '${FIRST}', B: 'pre-$SECOND-post', C: '$$NOT_A_NAME', D: 'plain' } }
  assert.deepEqual(referencedNames(entry).sort(), ['FIRST', 'SECOND'])
})
