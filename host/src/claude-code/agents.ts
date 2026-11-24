import { readFileSync } from 'node:fs'
import type { ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import type { ClaudeTiers } from '#shared/tiers/claude-code.ts'
import type { Ask } from '../questions.ts'
import { claudeDirections } from './directions.ts'
import { runClaudeHarness, type ClaudeHarnessOptions, type ClaudeHarnessRequest } from './harness.ts'
import { routeHarness, type Harness, type HarnessRoute } from './route.ts'
import { workTier } from './tier.ts'

/** What the host lends the agents' harness: the settings with the tiers on Claude Code, the `claude` program and the question sheet. */
export interface ClaudeCodeHooks {
  settings: () => ClaudeCodeSettings & { tiers?: ClaudeTiers }
  findClaude: () => string | null
  ask: Ask
  /** Told the harness id of each run sent to Claude Code (`ClaudeRuns.routed`). */
  onClaude?: (harnessId: string) => void
  /** The environment a run on Claude Code keeps its schedules with, from hobkin's runtime (056-agent-schedules). */
  scheduling?: HarnessRoute['scheduling']
}

/**
 * The `runHarness` a live home gives hobkin (`033-claude-code-agents`). A run the settings leave on Pi gets hobkin's own
 * harness, built as hobkin builds it when given none (`HobkinApplication.open`). With a launcher configured, hobkin
 * puts it on each request and runs the plain harness, so this does the same. The rest run on Claude Code.
 */
export async function agentHarness(hooks: ClaudeCodeHooks, runFor: HarnessRoute['runFor']): Promise<Harness> {
  const harnesses = await import('hobkin/src/cli/harnesses.mjs')
  const { readingUsage } = await import('hobkin/src/cli/work/usage.mjs')
  const store = await import('hobkin/src/cli/work/store.mjs')
  const piHarness = harnesses.namingExtensions(readingUsage(harnesses.runHarness))
  const background = readFileSync(new URL('../prompts/background.md', import.meta.resolve('hobkin/src/cli/harnesses.mjs')), 'utf8')
  return routeHarness({
    pi: (request, options) => (request.launcher ? harnesses.runHarness : piHarness)(request, options),
    claude: (request, options, launch) =>
      runClaudeHarness(request as unknown as ClaudeHarnessRequest, (options ?? {}) as ClaudeHarnessOptions, { ...launch, ask: hooks.ask }),
    settings: hooks.settings,
    workTier: (run, root) => (root ? workTier(store, root, run) : null),
    findClaude: hooks.findClaude,
    runFor,
    directions: claudeDirections(harnesses.workDirections, background),
    ...(hooks.onClaude ? { onClaude: hooks.onClaude } : {}),
    ...(hooks.scheduling ? { scheduling: hooks.scheduling } : {}),
  })
}
