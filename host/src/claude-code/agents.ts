import { readFileSync } from 'node:fs'
import type { ClaudeCodeSettings } from '#shared/protocol/claude-code.ts'
import type { Ask } from '../questions.ts'
import { claudeDirections } from './directions.ts'
import { runClaudeHarness, type ClaudeHarnessOptions, type ClaudeHarnessRequest } from './harness.ts'
import { routeHarness, type Harness, type HarnessRoute } from './route.ts'

/** What the host lends the agents' harness: the settings, the `claude` program and the question sheet. */
export interface ClaudeCodeHooks {
  settings: () => ClaudeCodeSettings
  findClaude: () => string | null
  ask: Ask
}

/**
 * The `runHarness` a live home gives hobkin (`033-claude-code-agents`). A run the settings leave on Pi gets hobkin's own
 * harness, built as hobkin builds it when given none (`HobkinApplication.open`). With a launcher configured, hobkin
 * puts it on each request and runs the plain harness, so this does the same. The rest run on Claude Code.
 */
export async function agentHarness(hooks: ClaudeCodeHooks, runFor: HarnessRoute['runFor']): Promise<Harness> {
  const harnesses = await import('hobkin/src/cli/harnesses.mjs')
  const { readingUsage } = await import('hobkin/src/cli/work/usage.mjs')
  const piHarness = harnesses.namingExtensions(readingUsage(harnesses.runHarness))
  const background = readFileSync(new URL('../prompts/background.md', import.meta.resolve('hobkin/src/cli/harnesses.mjs')), 'utf8')
  return routeHarness({
    pi: (request, options) => (request.launcher ? harnesses.runHarness : piHarness)(request, options),
    claude: (request, options, launch) =>
      runClaudeHarness(request as unknown as ClaudeHarnessRequest, (options ?? {}) as ClaudeHarnessOptions, { ...launch, ask: hooks.ask }),
    settings: hooks.settings,
    findClaude: hooks.findClaude,
    runFor,
    directions: claudeDirections(harnesses.workDirections, background),
  })
}
