/**
 * The models the change review asks (spec 032). A review uses two: the Reviewer, for its one careful pass, on the
 * high tier with high thinking; and Quick, for its blind check, on the fast tier. Each is one question in a Pi session
 * of its own, with no tools: it reads no file, runs nothing and changes nothing. Whatever it answers is checked by the
 * change review before anyone sees it.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PiModelRuntime } from '../pi.ts'
import { loadPiCodingAgent } from '../pi.ts'

/** A model and how hard it thinks, as hobkin's tiers store them (`017-model-tiers`), with the tier it came from. */
export interface TierChoice {
  tier: 'fast' | 'mid' | 'high' | 'max' | 'main'
  model: string
  effort: string
}

/** Building a review is careful reading, so it thinks hard whatever effort the tier names. */
export const REVIEW_EFFORT = 'high'

/** The tiers nearest to `high` first: the cheaper neighbour, then the dearer one, then the cheapest. */
const NEAREST_HIGH = ['high', 'mid', 'max', 'fast'] as const

/**
 * The Reviewer: the tier a review is built on. `high`, from the home's config.json, always with high thinking: a
 * review that rates a change wrongly costs more than the model that reads it. Without a `high` model it takes the
 * closest tier that has one, and then the main conversation's model. Null when none names a model.
 */
export function reviewTier(root: string): TierChoice | null {
  try {
    const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as { tiers?: Record<string, { model?: string }>; main?: { model?: string } }
    for (const tier of NEAREST_HIGH) {
      const model = config.tiers?.[tier]?.model
      if (model) return { tier, model, effort: REVIEW_EFFORT }
    }
    if (config.main?.model) return { tier: 'main', model: config.main.model, effort: REVIEW_EFFORT }
  } catch {
    // No config, or one that cannot be read: no tier.
  }
  return null
}

/** The cheapest first: a blind check reads one story once and needs no more. */
const CHEAPEST = ['fast', 'mid', 'high', 'max'] as const

/**
 * Quick: the tier the change review's blind check runs on (spec 032). `fast`, else the cheapest one that is set, at
 * its own thinking or low, then the main chat's model at low. It sees only the story and its units, with no tools, so a small model is
 * the point: it reads what the reviewer would read. Null when none names a model.
 */
export function checkerTier(root: string): TierChoice | null {
  try {
    const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as { tiers?: Record<string, { model?: string; effort?: string }>; main?: { model?: string } }
    for (const tier of CHEAPEST) {
      const set = config.tiers?.[tier]
      if (set?.model) return { tier, model: set.model, effort: set.effort ?? 'low' }
    }
    if (config.main?.model) return { tier: 'main', model: config.main.model, effort: 'low' }
  } catch {
    // No config, or one that cannot be read: no tier.
  }
  return null
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
