import { CLAUDE_MODELS, type ClaudeAgentKind, type ClaudeCodeSettings, type ClaudeModel } from '#shared/protocol/claude-code.ts'
import { HOBKIN_CLAUDE_EFFORTS, type HobkinClaudeEffort } from '#shared/protocol/hobkins.ts'
import type { ClaudeTiers } from '#shared/tiers/claude-code.ts'
import { TIER_IDS, type TierId } from '#shared/tiers/tiers.ts'

/** hobkin's harness: a run request and the callbacks hobkin passes with it, answered by the run's result. */
export type Harness = (request: Record<string, unknown>, options?: unknown) => Promise<unknown>

/** What hobkin's record of a run says about it. */
export interface RunFacts {
  scheduleId?: string | null
  title?: string
  /** The tier the run was given, when its record names one, as a delegated job's does. */
  tier?: unknown
  /** What a Work run works on: its project, lane and item. */
  work?: unknown
}

/** What a run on Claude Code needs from the host besides the request. */
export interface ClaudeLaunch {
  claude: string
  settings: ClaudeCodeSettings
  title: string
  directions: string
  /** The environment Claude Code starts with, when hobkin gives the run's process something of its own. */
  env?: NodeJS.ProcessEnv
}

export interface HarnessRoute {
  /** hobkin's own Pi harness, as hobkin would have built it. */
  pi: Harness
  claude: (request: Record<string, unknown>, options: unknown, launch: ClaudeLaunch) => Promise<unknown>
  /** The settings, with the tiers on Claude Code when the host keeps any. */
  settings: () => ClaudeCodeSettings & { tiers?: ClaudeTiers }
  /**
   * The tier of a Work run from a runtime before Work runs named their tier, worked out from hobkin's data root, which
   * hobkin passes each run as `metricsRoot`.
   */
  workTier?: (run: RunFacts, root: string | undefined) => TierId | null
  findClaude: () => string | null
  /** hobkin's record of the running run with this harness id. Looking for it gives up once the run is stopped. */
  runFor: (harnessId: string, signal?: AbortSignal) => Promise<RunFacts | undefined>
  /** What a run with this purpose is told. */
  directions: (purpose: string | undefined) => string
  /** Told the harness id of each run sent to Claude Code, as it starts there, so the window can draw it so (`runs.ts`). */
  onClaude?: (harnessId: string) => void
}

// Only agents that use tools move. Reflection, compatibility checks, the humanizer and the rest of hobkin's own upkeep stay on Pi.
const WORK_PURPOSES = new Set(['work-discover', 'work-look', 'work-do'])

/** A run of hobkin's own upkeep: one with a purpose that is not Work's. */
const isUpkeep = (purpose: unknown) => typeof purpose === 'string' && !WORK_PURPOSES.has(purpose)

/** The kind of agent a run is, or null for one that stays on Pi whatever the settings. */
function kindOf(purpose: unknown, run: RunFacts | undefined): ClaudeAgentKind | null {
  if (typeof purpose === 'string' && WORK_PURPOSES.has(purpose)) return 'work'
  if (purpose !== undefined || !run) return null
  return run.scheduleId?.startsWith('session.') ? 'sessions' : 'routines'
}

const NOT_INSTALLED = 'Claude Code is not installed on this Mac, so this agent did not start. Install it, or turn off agents on Claude Code in Settings.'

/** A run that cannot start because there is no `claude`, ended failed with the reason. */
const notInstalled = (request: Record<string, unknown>, settings: ClaudeCodeSettings) => ({
  id: request.id,
  harness: 'claude',
  status: 'failed',
  text: '',
  cost: null,
  model: `claude-code/${settings.model}`,
  effort: request.effort,
  sessionId: null,
  freshSession: true,
  error: NOT_INSTALLED,
})

const oneOf = <Word extends string>(words: readonly Word[], value: unknown): Word | null => (words.includes(value as Word) ? (value as Word) : null)

/** hobkin's data root, which it gives every run it starts as `metricsRoot`. */
const rootOf = (options: unknown): string | undefined => {
  const root = (options as { metricsRoot?: unknown } | undefined)?.metricsRoot
  return typeof root === 'string' ? root : undefined
}

/**
 * The tier a run runs at: the one its request or its record names, as hobkin gives every Work run and delegated job its
 * tier. A runtime from before named none for a Work run, so for it the tier is worked out from the project's level
 * (`workTier`). Null for a run on no tier, such as one that finds projects.
 */
const tierOf = (request: Record<string, unknown>, run: RunFacts, root: string | undefined, workTier: HarnessRoute['workTier']): TierId | null =>
  oneOf(TIER_IDS, request.tier) ?? oneOf(TIER_IDS, run.tier) ?? workTier?.(run, root) ?? null

/** Names and values that are all text, as an environment is. */
const isEnv = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && Object.values(value).every((entry) => typeof entry === 'string')

/**
 * What a durable hobkin chose for Claude Code, over the settings: its model, and its thinking level. `default` for the
 * level means Claude Code's own, so none is passed: the settings then follow the run's level, and the run is given none.
 * Anything that is not one of Claude Code's own words is left out, and the settings stand.
 */
function durableChoice(chosen: unknown): { settings: Partial<Pick<ClaudeCodeSettings, 'model' | 'effort'>>; ownLevel: boolean } {
  const { model, effort } = (chosen ?? {}) as { model?: unknown; effort?: unknown }
  const named: ClaudeModel | null = oneOf(CLAUDE_MODELS, model)
  const level: HobkinClaudeEffort | null = oneOf(HOBKIN_CLAUDE_EFFORTS, effort)
  return {
    settings: {
      ...(named ? { model: named } : {}),
      ...(level ? { effort: level === 'default' ? ('tier' as const) : level } : {}),
    },
    ownLevel: level === 'default',
  }
}

/**
 * The `runHarness` the host gives hobkin: a run whose kind or tier the settings send to Claude Code runs there, and
 * every other run goes to Pi untouched. With Claude Code off and no tier on it, nothing is even looked up.
 */
export function routeHarness(route: HarnessRoute): Harness {
  return async (request, options) => {
    // A durable hobkin on Claude Code (034-durable-hobkins) runs there whatever the settings say about agents, with
    // nothing asked, and its own directions. The model and effort are the ones it chose, or the settings'. Only a
    // durable turn takes this way: any other request that names Claude routes as before, so nothing else runs with
    // nothing asked.
    if (request.harness === 'claude' && request.purpose === 'durable') {
      const claude = route.findClaude()
      const chosen = durableChoice(request.claude)
      const durable = { ...route.settings(), ...chosen.settings, permissions: 'all' as const }
      if (!claude) return notInstalled(request, durable)
      const run = await route.runFor(String(request.id), request.signal instanceof AbortSignal ? request.signal : undefined)
      route.onClaude?.(String(request.id))
      return route.claude(chosen.ownLevel ? { ...request, effort: undefined } : request, options, {
        claude,
        settings: durable,
        title: run?.title?.trim() || 'A hobkin',
        directions: typeof request.directions === 'string' ? request.directions : '',
        // The turn's token and home, so `hobkin tell` from Claude's shell is sent as this hobkin, as on Pi.
        ...(isEnv(request.env) ? { env: { ...process.env, ...request.env } } : {}),
      })
    }

    const settings = route.settings()
    const tiers = settings.tiers ?? {}
    const someTierOnClaude = Object.keys(tiers).length > 0
    if (!settings.enabled && !someTierOnClaude) return route.pi(request, options)

    const purpose = request.purpose as string | undefined
    if (isUpkeep(purpose)) return route.pi(request, options)
    const run = await route.runFor(String(request.id), request.signal instanceof AbortSignal ? request.signal : undefined)
    const kind = kindOf(purpose, run)
    if (!kind) return route.pi(request, options)

    // A run at a tier on Claude Code runs there with the tier's model and level, whatever the tile's switches say. A kind
    // the tile switches on runs there at every tier, with the tile's model unless its tier names its own.
    const tier = someTierOnClaude && run ? tierOf(request, run, rootOf(options), route.workTier) : null
    const tierOnClaude = tier ? tiers[tier] : undefined
    const kindSwitchedOn = settings.enabled && settings.kinds[kind]
    if (!tierOnClaude && !kindSwitchedOn) return route.pi(request, options)
    const chosen = tierOnClaude ? { ...settings, model: tierOnClaude.model, effort: tierOnClaude.effort } : settings

    const claude = route.findClaude()
    // The user chose Claude Code for these agents, so a missing one is a failure to fix, not a reason to spend Pi instead.
    if (!claude) return notInstalled(request, chosen)
    route.onClaude?.(String(request.id))
    return route.claude(request, options, {
      claude,
      settings: chosen,
      title: run?.title?.trim() || 'An agent',
      directions: route.directions(purpose),
    })
  }
}
