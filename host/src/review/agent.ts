/**
 * The models the change review asks (spec 032). A review uses two: the Reviewer, for its one careful pass, with high
 * thinking; and Quick, for its blind check. Each runs on the tier the user named for it in Settings, the high tier
 * and the fast tier until they do. Each is one question in a Pi session
 * of its own, with no tools: it reads no file, runs nothing and changes nothing. Whatever it answers is checked by the
 * change review before anyone sees it.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PiModelRuntime } from '../pi.ts'
import { DEFAULT_REVIEW_TIERS, TIER_IDS, type ReviewRole, type TierId } from '#shared/tiers/tiers.ts'
import { loadPiCodingAgent } from '../pi.ts'

/** A model and how hard it thinks, as hobkin's tiers store them (`017-model-tiers`), with where it came from: the tier itself, or the setting that tier follows while it has no model of its own. */
export interface TierChoice {
  tier: TierId | 'main' | 'background'
  model: string
  effort: string
}

/** Building a review is careful reading, so it thinks hard whatever effort the tier names. */
export const REVIEW_EFFORT = 'high'

/** hobkin's config.json, as far as a review reads it. */
interface TiersConfig {
  main?: { model?: string | null; effort?: string }
  background?: { harness?: string; model?: string | null; effort?: string }
  tiers?: Partial<Record<string, { model?: string; effort?: string } | null>>
  review?: Partial<Record<ReviewRole, string>>
}

const readConfig = (root: string): TiersConfig | null => {
  try {
    return JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as TiersConfig
  } catch {
    // No config, or one that cannot be read: no tier.
    return null
  }
}

/**
 * What a review role runs on: the tier the user named for it in hobkin's config.json (`review`), else its default,
 * read the way hobkin reads a tier (`src/cli/tiers.mjs` there). A tier with a model of its own runs on it. One
 * without follows the chat model, and `fast` follows the checks model, never another tier that happens to be set.
 * Null when nothing names a model.
 */
function roleTier(root: string, role: ReviewRole): (TierChoice & { own: boolean }) | null {
  const config = readConfig(root)
  if (!config) return null
  const named = config.review?.[role]
  const tier = (TIER_IDS as readonly string[]).includes(named ?? '') ? (named as TierId) : DEFAULT_REVIEW_TIERS[role]
  const own = config.tiers?.[tier]
  if (own?.model) return { tier, model: own.model, effort: own.effort ?? 'medium', own: true }
  const checks = config.background
  if (tier === 'fast' && checks?.model && (checks.harness ?? 'pi') === 'pi') return { tier: 'background', model: checks.model, effort: checks.effort ?? 'low', own: false }
  if (config.main?.model) return { tier: 'main', model: config.main.model, effort: config.main.effort ?? 'medium', own: false }
  return null
}

/**
 * The Reviewer: what a review is built on. The tier the user named for it, `high` until they do, always with high
 * thinking: a review that rates a change wrongly costs more than the model that reads it. Null when nothing names a model.
 */
export function reviewTier(root: string): TierChoice | null {
  const found = roleTier(root, 'reviewer')
  return found ? { tier: found.tier, model: found.model, effort: REVIEW_EFFORT } : null
}

/**
 * Quick: what the change review's blind check runs on (spec 032). The tier the user named for it, `fast` until they
 * do, at that tier's own thinking; on the chat model, when that is all there is, at low. It sees only the story and
 * its units, with no tools, so a small model is the point: it reads what the reviewer would read. Null when nothing
 * names a model.
 */
export function checkerTier(root: string): TierChoice | null {
  const found = roleTier(root, 'quick')
  if (!found) return null
  return { tier: found.tier, model: found.model, effort: found.own || found.tier === 'background' ? found.effort : 'low' }
}

/**
 * The model runner the change-review engine asks (spec 032): its one careful pass on the review tier, with high
 * thinking, and its blind check on the checker tier. Both run in a Pi session with no tools and an empty context.
 */
export function piModelRunner({ root, data, runtime }: PiAgentPlace): (call: { pass: 'review' | 'checker'; system: string; prompt: string; signal: AbortSignal }) => Promise<string | null> {
  return async ({ pass, system, prompt, signal }) => {
    const models = await runtime()
    const choice = pass === 'checker' ? checkerTier(data()) : reviewTier(data())
    if (!models || !choice) return null
    return askPi({ root, models, choice, system, prompt, signal })
  }
}

/** Where a live agent runs: the home, hobkin's data folder (its config.json names the tiers), and Pi's models. */
interface PiAgentPlace {
  root: string
  data: () => string
  runtime: () => Promise<PiModelRuntime | undefined>
}

/** One question to a model in a session of its own, with no tools: its written answer, as text. */
async function askPi({ root, models, choice, system, prompt, signal }: { root: string; models: PiModelRuntime; choice: TierChoice; system: string; prompt: string; signal: AbortSignal }): Promise<string> {
  const pi = (await loadPiCodingAgent()) as unknown as {
    createAgentSession(options: Record<string, unknown>): Promise<{ session: PiSession; modelFallbackMessage?: string }>
    resolveCliModel(options: { cliModel: string; modelRuntime: unknown }): { model?: unknown; error?: string; warning?: string }
    SettingsManager: { inMemory(settings: Record<string, unknown>): unknown }
    SessionManager: { inMemory(cwd?: string): unknown }
    DefaultResourceLoader: new (options: Record<string, unknown>) => { reload?(): Promise<void> }
  }
  // Resolved the way hobkin resolves its own models, so a tier names a model the same way everywhere.
  const resolved = pi.resolveCliModel({ cliModel: choice.model, modelRuntime: models })
  if (resolved.error || resolved.warning || !resolved.model) throw new Error(`The ${choice.tier} tier's model, ${choice.model}, cannot be used: ${resolved.error ?? resolved.warning ?? 'Pi does not have it.'}`)
  const model = resolved.model
  const folder = join(root, 'client', 'review-agent')
  if (!existsSync(folder)) mkdirSync(folder, { recursive: true, mode: 0o700 })
  const settingsManager = pi.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true } })
  const resourceLoader = new pi.DefaultResourceLoader({
    cwd: folder,
    agentDir: folder,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: system,
  })
  await resourceLoader.reload?.()
  const { session, modelFallbackMessage } = await pi.createAgentSession({
    cwd: folder,
    agentDir: folder,
    modelRuntime: models,
    model,
    thinkingLevel: choice.effort,
    noTools: 'all',
    tools: [],
    resourceLoader,
    settingsManager,
    sessionManager: pi.SessionManager.inMemory(folder),
  })
  // Pi falls back to another model when the one asked for cannot run. A review then says so instead of running on it.
  if (modelFallbackMessage) {
    session.dispose()
    throw new Error(modelFallbackMessage)
  }
  return askSession(session, prompt, signal)
}

/** How long one model call may run. One still going by then is stopped, and fails saying so. */
export const MODEL_DEADLINE_MS = 10 * 60_000

/**
 * Asks a session one question and answers with what the model wrote, then disposes of the session. A call whose run
 * was stopped before it started is never asked. One stopped on the way, by its run or by its deadline, stops the
 * session and fails: what it wrote by then is no answer.
 */
export async function askSession(session: PiSession, prompt: string, signal: AbortSignal): Promise<string> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), MODEL_DEADLINE_MS)
  const stop = AbortSignal.any([signal, deadline.signal])
  let halt = () => {}
  const halted = new Promise<void>((resolve) => {
    halt = () => {
      void session.abort().catch(() => {})
      resolve()
    }
  })
  const stopped = () =>
    new Error(deadline.signal.aborted ? `The model gave no answer within ${MODEL_DEADLINE_MS / 60_000} minutes, so it was stopped.` : 'The review was stopped before its model answered.')
  stop.addEventListener('abort', halt, { once: true })
  try {
    // A listener added to a signal that is already aborted is never called, so that call is refused here.
    if (stop.aborted) throw stopped()
    // Waited for only until it is stopped, so a session slow to stop never holds the run.
    await Promise.race([session.prompt(prompt), halted])
    if (stop.aborted) throw stopped()
    const reply = [...session.messages].reverse().find((message) => message.role === 'assistant')
    const parts = Array.isArray(reply?.content) ? reply.content : []
    return parts.filter((part) => part.type === 'text').map((part) => String(part.text ?? '')).join('\n')
  } finally {
    clearTimeout(timer)
    stop.removeEventListener('abort', halt)
    session.dispose()
  }
}

export interface PiSession {
  prompt(text: string): Promise<void>
  abort(): Promise<void>
  dispose(): void
  messages: { role?: string; content?: { type?: string; text?: unknown }[] }[]
}
