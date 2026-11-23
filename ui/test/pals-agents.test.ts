import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { HobkinSummary } from '#shared/protocol/hobkins.ts'
import type { WireSnapshot } from '#shared/protocol/snapshot.ts'
import { durableAgents } from '../src/features/hobkins/list.ts'
import { agentsFrom } from '../src/lib/host/frame.ts'

const run = { title: 'Fix the login redirect', state: 'running', kind: 'background', effort: 'high', work: { slug: 'storefront' }, scheduleId: 'work' } as const

test('an agent on Claude Code gets the crab pal, and one on Pi or from an older host gets none', () => {
  const snapshot: WireSnapshot = {
    runs: [
      { ...run, id: 'w1', onClaudeCode: true },
      { ...run, id: 'w2' },
    ],
  }

  const [claude, pi] = agentsFrom(snapshot)

  assert.equal(claude!.onClaudeCode, true)
  assert.equal('onClaudeCode' in pi!, false, 'a run on Pi stays exactly as it was')
  assert.equal(agentsFrom(snapshot, { includeEnded: true })[0]!.onClaudeCode, true, 'a finished run keeps it on its page')
})

test('a durable hobkin on Claude Code gets the crab pal, and one on a tier or a Pi model gets none', () => {
  const hobkin = (id: string, engine: HobkinSummary['engine']): HobkinSummary => ({
    id,
    title: 'Tidy the docs',
    cwd: '/Users/someone/code/site',
    engine,
    state: 'waiting',
    turns: 1,
    run: null,
    last: null,
    waiting: null,
    createdAt: '2026-11-23T10:00:00.000Z',
  })
  const hobkins = [
    hobkin('0a1b2c3d', { kind: 'claude', model: 'opus' }),
    hobkin('0a1b2c3e', { kind: 'tier', tier: 'mid' }),
    hobkin('0a1b2c3f', { kind: 'pi', model: 'openai/gpt-5', effort: 'high' }),
  ]

  const [claude, tier, pi] = durableAgents({ hobkins })

  assert.equal(claude!.onClaudeCode, true)
  assert.equal('onClaudeCode' in tier!, false)
  assert.equal('onClaudeCode' in pi!, false)
})
