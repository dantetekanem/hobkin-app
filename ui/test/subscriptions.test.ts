import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, type ClaudeCodeState } from '#shared/protocol/claude-code.ts'
import type { ProviderAccess } from '#shared/protocol/models.ts'
import { claudeCodeValue, subscriptionRows, subscriptionsValue } from '../src/features/settings/subscriptions.ts'

const provider = (id: string, rest: Partial<ProviderAccess> = {}): ProviderAccess => ({ id, name: id, connected: true, ...rest })

const claude = (status: Partial<ClaudeCodeState['status']>, settings: Partial<ClaudeCodeState['settings']> = {}): ClaudeCodeState => ({
  status: { installed: true, version: '2.1.3', signedIn: true, authMethod: 'claude.ai', plan: 'pro', ...status },
  settings: { ...CLAUDE_CODE_DEFAULTS, ...settings },
})

test('lists what Pi reaches and how', () => {
  const rows = subscriptionRows(
    [
      provider('a', { connectedBy: 'sign-in', signIn: { label: 'x', subscription: true } }),
      provider('b', { connectedBy: 'sign-in', signIn: { label: 'x', subscription: false } }),
      provider('c', { connectedBy: 'key' }),
      provider('d', { connectedBy: 'environment' }),
      provider('e', { connectedBy: 'cloud' }),
      provider('f', { signIn: { label: 'x', subscription: true } }),
      provider('g', { apiKey: { label: 'k', env: ['K'] } }),
      provider('h', { cloud: { label: 'c' } }),
      provider('i', { connected: false, connectedBy: 'key' }),
    ],
    null,
  )
  assert.deepEqual(rows.map((row) => row.id), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])
  const how = rows.map((row) => row.how)
  assert.equal(new Set(how.slice(0, 5)).size, 5)
  assert.equal(how[0], how[5], 'the fallback on a subscription sign-in reads as connectedBy does')
  assert.equal(how[2], how[6])
  assert.equal(how[4], how[7])
  assert.equal(subscriptionsValue(rows), '8 connected')
})

test('the Claude Code row says what is true of it', () => {
  const row = (state: ClaudeCodeState | null) => subscriptionRows([], state).find((entry) => entry.id === 'claude-code')

  assert.equal(row(null), undefined, 'nothing is claimed before the host has answered')

  const available = row(claude({}))!
  assert.match(available.how, /2\.1\.3/)
  assert.match(available.how, /Pro/)
  assert.equal(available.note, 'Available')
  assert.equal(available.install, undefined)

  const used = row(claude({}, { enabled: true }))!
  assert.equal(used.note, 'Used by agents')

  const idle = row(claude({}, { enabled: true, kinds: { work: false, sessions: false, routines: false } }))!
  assert.equal(idle.note, 'Available', 'on with every kind off means agents run on Pi')

  // A tier on Claude Code runs agents there with the tile's switch off.
  const tiered = row(claude({}, { tiers: { high: { model: 'opus', effort: 'max' } } } as Partial<ClaudeCodeState['settings']>))!
  assert.equal(tiered.note, 'Used by agents')

  // A key in the environment wins over the sign-in, so agents would bill the API instead of the subscription.
  const keyed = row(claude({ authMethod: 'api_key', plan: null }))!
  assert.match(keyed.how, /API key/)

  const out = row(claude({ signedIn: false, plan: null }))!
  assert.match(out.note!, /claude/)
  assert.equal(out.install, undefined)

  const missing = row(claude({ installed: false, version: null, signedIn: null, plan: null }))!
  assert.equal(missing.install, true)
  assert.equal(subscriptionsValue(subscriptionRows([provider('a', { connectedBy: 'key' })], claude({ installed: false, version: null }))), '1 connected')
})

test('the Claude Code tile says which agents run on Claude Code', () => {
  assert.equal(claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, enabled: false }), claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, enabled: false, model: 'opus' }))
  const all = claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, enabled: true })
  const some = claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, enabled: true, kinds: { work: true, sessions: false, routines: true } })
  const none = claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, enabled: true, kinds: { work: false, sessions: false, routines: false } })
  assert.notEqual(all, some)
  assert.match(some, /Work/)
  assert.match(some, /outines/)
  assert.doesNotMatch(some, /elegated/)
  assert.notEqual(none, all)

  // With no kind on, the tiers on Claude Code are what runs there.
  const tiers = { high: { model: 'opus', effort: 'max' }, max: { model: 'opus', effort: 'max' } }
  assert.equal(claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, tiers } as typeof CLAUDE_CODE_DEFAULTS), 'High and Max on Claude Code')
  assert.equal(claudeCodeValue({ ...CLAUDE_CODE_DEFAULTS, enabled: true, tiers } as typeof CLAUDE_CODE_DEFAULTS), all, 'a kind switched on runs at every tier')
})
