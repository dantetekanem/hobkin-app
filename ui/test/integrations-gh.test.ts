import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CATALOG } from '#shared/integrations/catalog.ts'
import { splitServers } from '#shared/integrations/servers.ts'
import { withGh } from '../src/features/integrations/gh.ts'
import { itemsOf, type Item, type Items } from '../src/features/integrations/items.ts'
import { SAMPLE_SERVERS } from '../src/features/integrations/sample-data.ts'

const keys = (items: Item[]) => items.map((item) => item.key)
/** How gh stands on GitHub's item, wherever it sits. */
const ghOf = (items: Items) => {
  const github = [...items.connected, ...items.available].find((item) => item.key === 'github')
  return github?.kind === 'service' ? github.gh : undefined
}

test('GitHub follows gh: with the connected services while gh is signed in, in the catalog while it is not', () => {
  const nothing = itemsOf(splitServers([]))
  const signedIn = withGh(nothing, { connection: 'connected', login: 'octocat' })
  assert.deepEqual(keys(signedIn.connected), ['github'])
  assert.ok(!keys(signedIn.available).includes('github'))
  assert.deepEqual(ghOf(signedIn), { connection: 'connected', login: 'octocat' })

  for (const connection of ['missing', 'signed-out', 'unknown'] as const) {
    const off = withGh(nothing, { connection, login: null })
    assert.deepEqual(keys(off.connected), [], connection)
    assert.ok(keys(off.available).includes('github'), `${connection}: GitHub waits in the catalog`)
    assert.equal(ghOf(off)?.connection, connection, 'and says how gh stands')
  }
})

test('with GitHub\'s MCP server configured too, GitHub is connected either way, and the parts keep the catalog\'s order', () => {
  const sample = itemsOf(splitServers(SAMPLE_SERVERS))
  const missing = withGh(sample, { connection: 'missing', login: null })
  assert.equal(keys(missing.connected).filter((key) => key === 'github').length, 1)
  assert.equal(ghOf(missing)?.connection, 'missing')

  // Connected through gh, with only Linear's server configured: GitHub takes its place in the catalog's order.
  const linearOnly = itemsOf(splitServers(SAMPLE_SERVERS.filter((server) => server.name === 'linear')))
  const both = withGh(linearOnly, { connection: 'connected', login: 'octocat' })
  const order = CATALOG.map((entry) => entry.id)
  assert.deepEqual(keys(both.connected), ['github', 'linear'].sort((a, b) => order.indexOf(a) - order.indexOf(b)))
  assert.deepEqual(both.own, linearOnly.own)
})
