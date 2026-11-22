import assert from 'node:assert/strict'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, type ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'
import { createClientTool } from '../src/client-tool.ts'
import { Client, hostFor, temporaryDirectory } from './support.ts'

const STATUS: ClaudeCodeStatus = { installed: true, version: '2.1.323', signedIn: true, authMethod: 'claude.ai', plan: 'pro' }
// Never the real claude: the host asks this instead.
const claudeStatus = async () => STATUS

test('settings hold across a restart and only the window changes them', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  const first = await hostFor(t, { root, claudeStatus })
  const window = await Client.connect(first)

  // The host says it keeps tiers on Claude Code, none yet, so the window may offer them.
  assert.deepEqual(await window.run('claude-code.read'), { status: STATUS, settings: { ...CLAUDE_CODE_DEFAULTS, tiers: {} } })
  const applied = await window.run('claude-code.apply', { enabled: true, kinds: { routines: false }, model: 'opus', effort: 'high', permissions: 'edits' })
  await window.run('claude-code.apply', { tiers: { max: { model: 'opus', effort: 'max' }, fast: { model: 'haiku', effort: 'low' } } })
  const tiered = await window.run('claude-code.apply', { tiers: { fast: null } })
  const expected = { enabled: true, kinds: { work: true, sessions: true, routines: false }, model: 'opus', effort: 'high', permissions: 'edits', tiers: { max: { model: 'opus', effort: 'max' } } }
  assert.deepEqual(applied, { status: STATUS, settings: { ...expected, tiers: {} } })
  assert.deepEqual(tiered, { status: STATUS, settings: expected })
  assert.equal(statSync(join(root, 'client', 'claude-code.json')).mode & 0o777, 0o600)

  // hobkin's client tool reads the settings and is refused when it tries to change them.
  const tool = createClientTool({
    run: async (name, args) => {
      const result = await window.command(name, args)
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error }
    },
  })
  const read = await tool.execute('1', { action: 'run', name: 'claude-code.read' })
  assert.deepEqual(read.details, { status: STATUS, settings: expected })
  await assert.rejects(tool.execute('2', { action: 'run', name: 'claude-code.apply', args: { enabled: false } }), /needs the user's yes in the window/)
  await assert.rejects(tool.execute('3', { action: 'run', name: 'claude-code.apply', args: { tiers: { high: { model: 'opus', effort: 'max' } } } }), /needs the user's yes in the window/)
  assert.deepEqual(((await window.run('claude-code.read')) as { settings: unknown }).settings, expected)

  // A bad change is refused before it is saved: a model Claude Code does not have, a level below its lowest, the lead.
  for (const change of [{ model: 'gpt' }, { tiers: { high: { model: 'gpt', effort: 'high' } } }, { tiers: { high: { model: 'opus', effort: 'off' } } }, { tiers: { lead: { model: 'opus', effort: 'high' } } }]) {
    assert.equal((await window.command('claude-code.apply', change)).ok, false, JSON.stringify(change))
  }
  window.close()
  await first.close()

  const second = await hostFor(t, { root, claudeStatus })
  const again = await Client.connect(second)
  assert.deepEqual((await again.run('claude-code.read') as { settings: unknown }).settings, expected)
  again.close()
})

test('a file from before has no tier on Claude Code', async (t) => {
  const root = join(temporaryDirectory(t), 'home')
  // As a host before tiers on Claude Code saved it.
  const before = { enabled: true, kinds: { work: true, sessions: false, routines: true }, model: 'sonnet', effort: 'tier', permissions: 'ask' }
  mkdirSync(join(root, 'client'), { recursive: true })
  writeFileSync(join(root, 'client', 'claude-code.json'), `${JSON.stringify(before, null, 2)}\n`)
  const host = await hostFor(t, { root, claudeStatus })
  const window = await Client.connect(host)
  assert.deepEqual(await window.run('claude-code.read'), { status: STATUS, settings: { ...before, tiers: {} } })
  window.close()
})
