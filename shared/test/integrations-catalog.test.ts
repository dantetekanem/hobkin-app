import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG, CHECKED, catalogEntry } from '../integrations/catalog.ts'
import { entryKind, entryText, envNames, fillEntry, openFills } from '../integrations/entry.ts'
import { isServerName, sameServer } from '../integrations/servers.ts'
import type { CatalogEntry } from '../integrations/types.ts'

/** The services the spec names first (023-integrations, Decisions). */
const FIRST_SET = ['linear', 'notion', 'atlassian', 'sentry', 'home-assistant', 'stripe']

/** Every text value an entry would write into Pi's configuration, with the path it sits at. */
function texts(value: unknown, path = ''): [path: string, text: string][] {
  if (typeof value === 'string') return [[path, value]]
  if (Array.isArray(value)) return value.flatMap((item, index) => texts(item, `${path}[${index}]`))
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => texts(item, path ? `${path}.${key}` : key))
  return []
}

function each(check: (entry: CatalogEntry, at: string) => void) {
  for (const entry of CATALOG) check(entry, `${entry.id}:`)
}

test('every entry names what it reads, what it changes and its source', () => {
  each((entry, at) => {
    assert.ok(entry.name.trim(), `${at} a name`)
    assert.ok(entry.line.trim(), `${at} one line on what it is for`)
    assert.ok(entry.reads.length > 0 && entry.reads.every((line) => line.trim()), `${at} what hobkin can read through it`)
    assert.ok(entry.changes.length > 0 && entry.changes.every((line) => line.trim()), `${at} what it can change`)
    assert.match(entry.source, /^https:\/\/\S+$/, `${at} a source that is an https address`)
    assert.match(entry.checked, /^\d{4}-\d{2}-\d{2}$/, `${at} the day it was checked`)
    assert.equal(entry.checked, CHECKED, `${at} checked on the day the catalog says`)
    assert.ok(isServerName(entry.id), `${at} a name Pi accepts for a server`)
    const made = entry.entry as { url?: unknown; command?: unknown }
    assert.equal(Number(typeof made.url === 'string') + Number(typeof made.command === 'string'), 1, `${at} exactly one of url or command`)
  })
})

test('the first set of services is in the catalog, and each can be found by its id', () => {
  for (const id of FIRST_SET) assert.equal(catalogEntry(id)?.id, id, `${id} is listed`)
  assert.equal(catalogEntry('no-such-service'), null)
})

test('no two entries count as the same server for Pi', () => {
  CATALOG.forEach((entry, index) => {
    for (const other of CATALOG.slice(index + 1)) assert.ok(!sameServer(entry.id, other.id), `${entry.id} and ${other.id} would collide`)
  })
})

test('every entry says who makes its server, and one that is not the vendor\'s says so', () => {
  each((entry, at) => {
    assert.ok(entry.maker.trim(), `${at} who makes the server`)
    assert.ok(entry.server.trim(), `${at} what the server is called`)
    assert.equal(typeof entry.fromVendor, 'boolean', `${at} from the vendor or not`)
    for (const page of entry.also) assert.match(page, /^https:\/\/\S+$/, `${at} other pages are https addresses`)
    // A server from someone else must not pass as the vendor's: its maker is named, and it is not the service itself.
    if (!entry.fromVendor) assert.notEqual(entry.maker, entry.name, `${at} a server that is not the vendor's names another maker`)
  })
})

test('the transport matches the entry, and a server Pi cannot use says why', () => {
  each((entry, at) => {
    const kind = entryKind(entry.entry)
    if (kind === 'command') assert.equal(entry.transport, 'stdio', `${at} a local command speaks stdio`)
    else assert.ok(entry.transport === 'http' || entry.transport === 'sse', `${at} a remote server speaks HTTP or SSE`)
    // Pi has no SSE transport, so a server that only speaks SSE cannot be marked usable.
    if (entry.transport === 'sse') assert.equal(entry.usable, false, `${at} SSE only is not usable by Pi`)
    assert.equal(Boolean(entry.blocked?.trim()), !entry.usable, `${at} blocked says why exactly when it is not usable`)
    assert.ok(entry.connect.says.trim(), `${at} how it connects, in a line`)
    if (kind === 'command') assert.equal(entry.connect.kind, 'command', `${at} a local command connects as a command`)
    else assert.notEqual(entry.connect.kind, 'command', `${at} a remote server signs in or sends a header`)
  })
})

test('a key is always a reference to the environment, never a value', () => {
  each((entry, at) => {
    const made = entry.entry as { headers?: Record<string, string>; env?: Record<string, string>; oauth?: { clientSecret?: string } }
    const secrets = [...Object.values(made.headers ?? {}), ...Object.values(made.env ?? {}), ...(made.oauth?.clientSecret ? [made.oauth.clientSecret] : [])]
    for (const value of secrets) assert.match(value, /\$\{[A-Z][A-Z0-9_]*\}/, `${at} "${value}" must read its secret from the environment`)

    const named = entry.connect.env.map((variable) => variable.name)
    assert.deepEqual([...envNames(entry.entry)].sort(), [...named].sort(), `${at} the variables it explains are the ones the entry reads`)
    for (const variable of entry.connect.env) {
      assert.match(variable.name, /^[A-Z][A-Z0-9_]*$/, `${at} a variable name`)
      assert.ok(variable.holds.trim() && variable.where.trim(), `${at} ${variable.name} says what it holds and where to get it`)
    }
    if (entry.connect.kind === 'header') assert.ok(named.length > 0, `${at} a header needs a variable to read`)

    // Nothing shaped like a real credential anywhere in what would be written.
    for (const [path, text] of texts(entry.entry)) {
      const bare = text.replace(/\$\{[A-Z][A-Z0-9_]*\}/g, '')
      assert.doesNotMatch(bare, /(ghp_|github_pat_|xox[abp]-|sk_(live|test)_|rk_(live|test)_|AIza|ya29\.)/, `${at} ${path} looks like a token`)
      assert.doesNotMatch(bare, /[A-Za-z0-9+/_-]{32,}/, `${at} ${path} holds a long opaque value`)
    }
  })
})

test('every value a person fills in is explained, and filling them all leaves none open', () => {
  each((entry, at) => {
    const open = openFills(entry.entry)
    assert.deepEqual([...open].sort(), entry.connect.fills.map((fill) => fill.key).sort(), `${at} the fills it explains are the ones the entry leaves open`)
    for (const fill of entry.connect.fills) assert.ok(fill.label.trim() && fill.example.trim(), `${at} ${fill.key} has a label and an example`)

    const filled = fillEntry(entry.entry, Object.fromEntries(entry.connect.fills.map((fill) => [fill.key, fill.example])))
    assert.deepEqual(openFills(filled), [], `${at} nothing is left open once every fill has a value`)
    assert.deepEqual(openFills(entry.entry), open, `${at} filling does not change the catalog's own entry`)
  })
})

test('an entry that signs in through the person\'s own app tells them the callback address it will use', () => {
  each((entry, at) => {
    const oauth = (entry.entry as { oauth?: { clientId?: string; callbackPort?: number; callbackUrl?: string } }).oauth
    if (!oauth?.clientId) return
    const callback = oauth.callbackUrl ?? (oauth.callbackPort ? `http://127.0.0.1:${oauth.callbackPort}/callback` : null)
    assert.ok(callback, `${at} an app of the person's own needs a fixed callback address`)
    assert.ok(entry.connect.before.some((step) => step.includes(callback)), `${at} the steps name ${callback}`)
  })
})

test('the tools a maker documents are each marked as reading or changing', () => {
  each((entry, at) => {
    const names = entry.tools.map((tool) => tool.name)
    assert.equal(new Set(names).size, names.length, `${at} no tool is listed twice`)
    for (const tool of entry.tools) {
      assert.ok(tool.name.trim() && tool.does.trim(), `${at} ${tool.name} says what it does`)
      assert.ok(tool.effect === 'reads' || tool.effect === 'changes', `${at} ${tool.name} is marked as reading or changing`)
    }
  })
})

test('an entry prints the way it would sit under mcpServers', () => {
  const linear = catalogEntry('linear')!
  const text = entryText(linear.id, linear.entry)
  assert.deepEqual(JSON.parse(`{${text}}`), { linear: linear.entry }, 'the text is the entry, as JSON, under its name')
  assert.ok(text.startsWith('"linear": {'), 'it starts at the name, ready to read beside the file')
})

test('the catalog is written without long dashes', () => {
  for (const [path, text] of texts(CATALOG)) assert.doesNotMatch(text, /[\u2013\u2014]/, `${path} has a dash that the house style does not use`)
})
