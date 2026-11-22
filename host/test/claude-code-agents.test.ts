import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { test } from 'node:test'
import { CLAUDE_CODE_DEFAULTS, changeClaudeCode, type ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import { agentHarness } from '../src/claude-code/agents.ts'
import { temporaryDirectory } from './support.ts'

test("a live home's harness is hobkin's own for Pi runs and Claude Code's for the rest", async (t) => {
  const folder = temporaryDirectory(t)
  let settings: ClaudeCodeSettings = CLAUDE_CODE_DEFAULTS
  const run = await agentHarness(
    { settings: () => settings, findClaude: () => join(folder, 'claude'), ask: async () => null },
    async () => ({ scheduleId: 'work.project.item', title: 'Fix the login redirect' }),
  )
  // A run stopped before it starts is answered by whichever harness gets it, and neither starts a process.
  const stopped = () => ({
    id: randomUUID(),
    harness: 'pi',
    purpose: 'work-do',
    cwd: folder,
    model: 'anthropic/claude-sonnet-5-5',
    effort: 'medium',
    prompt: 'Do the item.',
    sessionFile: join(folder, 'jobs', `${randomUUID()}.jsonl`),
    signal: AbortSignal.abort(),
  })

  const onPi = (await run(stopped(), {})) as { harness: string; status: string; error: string }
  assert.deepEqual([onPi.harness, onPi.status, onPi.error], ['pi', 'interrupted', 'Cancelled before dispatch.'])

  settings = changeClaudeCode(CLAUDE_CODE_DEFAULTS, { enabled: true })
  const onClaude = (await run(stopped(), {})) as { harness: string; status: string; error: string }
  assert.deepEqual([onClaude.harness, onClaude.status, onClaude.error], ['claude', 'interrupted', 'Cancelled before dispatch.'])
})

test("a live home's harness sends a Work run to Claude Code by the tier its project's level gives it", async (t) => {
  const folder = temporaryDirectory(t)
  const root = join(folder, 'home')
  const store = await import('hobkin/src/cli/work/store.mjs')
  const { slug } = store.proposeProject(root, { name: 'Shop', path: folder, level: 'important' })
  store.chooseProject(root, slug, 'important')
  // Only the high tier runs on Claude Code, and the tile's switch is off.
  const settings = { ...CLAUDE_CODE_DEFAULTS, tiers: { high: { model: 'opus' as const, effort: 'high' as const } } }
  let lane = 'do'
  const run = await agentHarness(
    { settings: () => settings, findClaude: () => join(folder, 'claude'), ask: async () => null },
    async () => ({ scheduleId: `work.${slug}.${lane}`, title: 'Shop: Fix the login', work: { slug, lane } }),
  )
  const stopped = (purpose: string) => ({
    id: randomUUID(),
    harness: 'pi',
    purpose,
    cwd: folder,
    model: 'anthropic/claude-sonnet-5-5',
    effort: 'medium',
    prompt: 'Do the item.',
    sessionFile: join(folder, 'jobs', `${randomUUID()}.jsonl`),
    signal: AbortSignal.abort(),
  })

  // An important project's do runs on high, so on Claude Code; its look runs on mid, so on Pi. hobkin gives each run its data root.
  const onClaude = (await run(stopped('work-do'), { metricsRoot: root })) as { harness: string }
  lane = 'look'
  const onPi = (await run(stopped('work-look'), { metricsRoot: root })) as { harness: string }
  assert.deepEqual([onClaude.harness, onPi.harness], ['claude', 'pi'])
})
