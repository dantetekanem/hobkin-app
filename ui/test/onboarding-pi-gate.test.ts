import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PiSetup } from '../../shared/protocol/setup.ts'
import { beatAfter, piBlocks, type Answers, type Facts } from '../src/features/onboarding/story.ts'

const pi = (over: Partial<PiSetup> = {}): PiSetup => ({
  installed: true,
  version: '1.5.0',
  pinned: '1.5.0',
  matches: true,
  canInstall: true,
  installCommand: 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent@1.5.0',
  packages: [{ name: 'pi-agentic-search', adds: 'Ranked code search.', installed: true }],
  node: { found: true, version: '26.3.1', installs: '26.3.1' },
  canInstallNode: true,
  ...over,
})
const none: Answers = { replies: {} }
const facts = (state: PiSetup | null): Facts => ({ pi: state, connected: ['OpenAI Codex'], claude: false, smart: false, asked: null, host: true })

test('Pi missing, or older than hobkin runs on, holds the story; its packages and an unknown Pi do not', () => {
  assert.equal(piBlocks(pi({ installed: false, version: null, matches: false })), true)
  assert.equal(piBlocks(pi({ version: '0.9.0', matches: false })), true)
  assert.equal(piBlocks(pi({ packages: [{ name: 'pi-agentic-search', adds: '', installed: false }] })), false)
  assert.equal(piBlocks(pi()), false)
  assert.equal(piBlocks(null), false, 'with no host there is no Pi to wait for')
})

test('a setup that comes back unfinished reaches the Pi step again before the account', () => {
  // An unfinished setup starts again at the subscription bubble (`store.ts`), and Pi comes next while it is missing.
  const missing = facts(pi({ installed: false, version: null, matches: false }))
  assert.equal(beatAfter('subscription', none, missing), 'pi')
  assert.equal(beatAfter('subscription', none, facts(pi())), 'found')
})
