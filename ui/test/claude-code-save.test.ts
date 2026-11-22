import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, type ClaudeCodeChange, type ClaudeCodeState } from '#shared/protocol/claude-code.ts'
import { createClaudeCodeSaver } from '../src/features/settings/claude-code-save.ts'

const start: ClaudeCodeState = {
  status: { installed: true, version: '2.1.3', signedIn: true, authMethod: 'claude.ai', plan: 'pro' },
  settings: { ...CLAUDE_CODE_DEFAULTS, enabled: true, permissions: 'auto' },
}

function setup(t: { mock: { timers: { enable(o: { apis: 'setTimeout'[] }): void; tick(ms: number): void } } }, first: ClaudeCodeState = start) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let shown = first
  const sent: ClaudeCodeChange[] = []
  const answers: { resolve(state: ClaudeCodeState): void; reject(error: Error): void }[] = []
  const problems: (string | null)[] = []
  const saver = createClaudeCodeSaver({
    current: () => shown,
    show: (state) => {
      shown = state
    },
    problem: (reason) => problems.push(reason),
    apply: (change) => {
      sent.push(change)
      return new Promise((resolve, reject) => answers.push({ resolve, reject }))
    },
  })
  return { saver, sent, answers, problems, shown: () => shown.settings, tick: (ms: number) => t.mock.timers.tick(ms) }
}
const settle = () => new Promise((resolve) => setImmediate(resolve))

test('two quick changes send one merged change and the settings follow each at once', (t) => {
  const s = setup(t)
  s.saver.change({ permissions: 'edits' })
  assert.equal(s.shown().permissions, 'edits')
  s.tick(100)
  s.saver.change({ permissions: 'all', kinds: { work: false } })
  assert.equal(s.shown().permissions, 'all')
  assert.equal(s.shown().kinds.work, false)
  s.tick(100)
  assert.deepEqual(s.sent, [], 'nothing is sent while changes keep coming')
  s.saver.change({ permissions: 'auto' })
  s.tick(400)
  assert.deepEqual(s.sent, [{ permissions: 'auto', kinds: { work: false } }])
})

test('a failure restores the last saved settings and says why', async (t) => {
  const s = setup(t)
  s.saver.change({ model: 'opus' })
  s.tick(400)
  s.answers[0]!.reject(new Error('claude is busy'))
  await settle()
  assert.equal(s.shown().model, start.settings.model)
  assert.deepEqual(s.problems.at(-1), 'claude is busy')
})

test('a change after a finished save sends again, and saves never overlap', async (t) => {
  const s = setup(t)
  s.saver.change({ model: 'opus' })
  s.tick(400)
  s.saver.change({ effort: 'high' })
  s.tick(400)
  assert.equal(s.sent.length, 1, 'the second waits for the first')
  assert.equal(s.shown().effort, 'high')
  s.answers[0]!.resolve({ ...start, settings: { ...start.settings, model: 'opus' } })
  await settle()
  assert.deepEqual(s.sent, [{ model: 'opus' }, { effort: 'high' }])
  s.answers[1]!.resolve({ ...start, settings: { ...start.settings, model: 'opus', effort: 'high' } })
  await settle()
  s.saver.change({ permissions: 'ask' })
  s.tick(400)
  assert.deepEqual(s.sent.at(-1), { permissions: 'ask' })
  assert.equal(s.sent.length, 3)
})

test('a change from the tile keeps the tiers the host said run on Claude Code', (t) => {
  const tiers = { high: { model: 'opus', effort: 'max' } }
  const s = setup(t, { ...start, settings: { ...start.settings, tiers } as ClaudeCodeState['settings'] })
  s.saver.change({ permissions: 'edits' })
  assert.deepEqual([s.shown().permissions, (s.shown() as { tiers?: unknown }).tiers], ['edits', tiers])
})

test('a change from the tile never shows a host from before as keeping tiers', (t) => {
  const s = setup(t)
  s.saver.change({ permissions: 'edits' })
  assert.equal('tiers' in s.shown(), false)
})
