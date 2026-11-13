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
