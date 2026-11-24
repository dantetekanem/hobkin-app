import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'
import { sampleGitHub, type GitHubState } from '#shared/protocol/github.ts'

Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } } })
// The app's `@/` imports point at ui/src, as Vite resolves them.
registerHooks({ resolve: (specifier, context, next) => next(specifier.startsWith('@/') ? new URL(`../../../ui/src/${specifier.slice(2)}`, import.meta.url).href : specifier, context) })
const { githubSpotlight } = await import('../window/spotlight.ts')

const connected = (): GitHubState => ({ ...sampleGitHub(Date.now()), sample: false, connection: 'connected' })

test('the spotlight finds the pull requests waiting on the user, their own, and their issues, each under its own kind', () => {
  const github = connected()
  const found = githubSpotlight(github)
  assert.deepEqual(found.map(({ kind }) => kind), [...github.reviews.map(() => 'pull'), ...github.pulls.map(() => 'pull'), ...github.issues.map(() => 'issue')])
  assert.ok(found.length > 0)
  assert.equal(found[0]?.id, `review:${github.reviews[0]!.url}`)
  assert.match(found[0]!.detail ?? '', /waits for your review$/)
})

test('it finds nothing until gh is connected, unless the state is the sample', () => {
  assert.deepEqual(githubSpotlight({ ...connected(), connection: 'signed-out' }), [])
  assert.ok(githubSpotlight({ ...connected(), connection: 'unknown', sample: true }).length > 0)
})
