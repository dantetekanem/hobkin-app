import { readFileSync, realpathSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Pi is installed inside hobkin, not in the client. The host imports the copy hobkin itself loads,
 * because a second copy would be a second model runtime with its own idea of who is signed in.
 */
const hobkinManifest = realpathSync(fileURLToPath(import.meta.resolve('hobkin/package.json')))

function entryOf(name: string): string {
  const manifestPath = findPackageJSON(name, pathToFileURL(hobkinManifest))
  if (!manifestPath) throw Error(`hobkin does not have ${name} installed.`)

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: { '.'?: { import?: string } }; main?: string }
  const entry = manifest.exports?.['.']?.import ?? manifest.main
  if (!entry) throw Error(`${name} has no entry the host can import.`)
  // The real path, so this is the same module instance hobkin's own imports resolve to.
  return pathToFileURL(realpathSync(join(dirname(manifestPath), entry))).href
}

/** A provider as Pi's catalog has it. Only the fields the host reads. */
export interface PiProvider {
  id: string
  name: string
  auth?: {
    oauth?: { name: string; loginLabel?: string; isSubscription?: boolean }
    apiKey?: { name: string; login?: unknown }
  }
}

/** A chat model as Pi's catalog has it. */
export interface PiModel {
  id: string
  provider: string
  name: string
  type?: string
  reasoning?: boolean
  contextWindow?: number
  /** Dollars per million tokens. Pi gives zeros for a model it knows no price of. */
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number }
}

export interface PiModelRuntime {
  getProviders(): readonly PiProvider[]
  getModels(provider?: string): readonly PiModel[]
  /** The chat models whose providers Pi can reach now: what `/model` lists. */
  getAvailable(): Promise<readonly PiModel[]>
  /** Whether a provider is configured, and from where. Never the credential. */
  getProviderAuthStatus(provider: string): { configured: boolean; source?: string }
  /** What Pi's store holds, by provider and kind. Never the credential. */
  listCredentials(): Promise<readonly { providerId: string; type: string }[]>
  /** Reads models.json, the store and the environment again. */
  refresh(options?: { allowNetwork?: boolean }): Promise<unknown>
  /** Resolves with the stored credential, which the host drops unread. */
  login(provider: string, type: 'oauth' | 'api_key', interaction: PiAuthInteraction, options?: { getDeviceId?: () => string; agentName?: string }): Promise<unknown>
  logout(provider: string): Promise<void>
  hasConfiguredAuth(provider: string): boolean
}

export type PiAuthPrompt = {
  type: 'text' | 'secret' | 'select' | 'manual_code'
  message: string
  placeholder?: string
  options?: readonly { id: string; label: string; description?: string }[]
  signal?: AbortSignal
}

export type PiAuthEvent =
  | { type: 'auth_url'; url: string; instructions?: string }
  | { type: 'device_code'; userCode: string; verificationUri: string }
  | { type: 'info'; message: string }
  | { type: 'progress'; message: string }

export interface PiAuthInteraction {
  signal?: AbortSignal
  prompt(prompt: PiAuthPrompt): Promise<string>
  notify(event: PiAuthEvent): void
}

/** The exports of `@earendil-works/pi-coding-agent` the host uses. */
export interface PiCodingAgent {
  ModelRuntime: { create(options?: Record<string, unknown>): Promise<PiModelRuntime> }
  SettingsManager: {
    create(cwd: string, agentDir: string): { getOrCreateDeviceId(): string }
    inMemory(settings: Record<string, unknown>): unknown
  }
  createAgentSession(options: Record<string, unknown> & { customTools?: unknown[] }): Promise<{ session: PiAgentSession }>
  getAgentDir(): string
}

export interface PiAgentSession {
  agent: { streamFunction: unknown }
  [key: string]: unknown
}

export interface PiEventStream {
  push(event: Record<string, unknown>): void
  end(): void
}

/** The exports of `@earendil-works/pi-ai` the host uses. */
export interface PiAi {
  createAssistantMessageEventStream(): PiEventStream
  /** The thinking levels Pi allows for a model, as its `/thinking` picker lists them. */
  getSupportedThinkingLevels(model: PiModel): string[]
}

export const loadPiCodingAgent = (): Promise<PiCodingAgent> => import(entryOf('@earendil-works/pi-coding-agent'))
export const loadPiAi = (): Promise<PiAi> => import(entryOf('@earendil-works/pi-ai'))

/** A module of Pi's package that it does not export by name, by its file next to Pi's entry, such as its MCP code. */
export const piCodingAgentFile = (path: string): string => new URL(path, entryOf('@earendil-works/pi-coding-agent')).href

/** What Pi's settings say about the model to start with. Only the reads the host makes. */
export interface PiModelSettings {
  getDefaultProvider(): string | undefined
  getDefaultModel(): string | undefined
  getDefaultThinkingLevel(): string | undefined
  getAllModelThinkingLevels(): Record<string, string>
}

interface PiModelResolver {
  findInitialModel(options: Record<string, unknown>): Promise<{ model?: unknown }>
  /** The chat model Pi starts on for each provider when nothing is saved. */
  defaultModelPerProvider: Readonly<Record<string, string>>
}

/**
 * Pi keeps how it chooses a model in its own `model-resolver.js`, which its package does not export by name, so it
 * is imported by its file next to Pi's entry. Null when a later Pi moves it.
 */
async function piModelResolver(): Promise<PiModelResolver | null> {
  try {
    return (await import(new URL('./core/model-resolver.js', entryOf('@earendil-works/pi-coding-agent')).href)) as PiModelResolver
  } catch {
    return null
  }
}

/**
 * The model Pi starts a conversation on when nothing names one: its saved default when it can use it, then its own
 * pick among the providers it can reach. When a later Pi moves its resolver, there is no pick, and hobkin's own rule
 * for a model Pi cannot restore applies.
 */
export async function loadPiModelPick(): Promise<((runtime: unknown, settings: PiModelSettings) => Promise<unknown>) | null> {
  const resolver = await piModelResolver()
  if (!resolver) return null
  return async (modelRuntime, settings) =>
    (
      await resolver.findInitialModel({
        scopedModels: [],
        isContinuing: false,
        defaultProvider: settings.getDefaultProvider(),
        defaultModelId: settings.getDefaultModel(),
        defaultThinkingLevel: settings.getDefaultThinkingLevel(),
        modelThinkingLevels: settings.getAllModelThinkingLevels(),
        modelRuntime,
      })
    ).model
}

/** Pi's table of the model it starts on for each provider when nothing is saved. Empty when a later Pi moves it. */
export async function loadPiDefaultModels(): Promise<Readonly<Record<string, string>>> {
  return (await piModelResolver())?.defaultModelPerProvider ?? {}
}

/** An environment where every variable is set, so Pi's lookup names all the variables it would read. No value is read. */
const EVERY_VARIABLE = new Proxy({}, { get: () => 'set' })

/**
 * The environment variables Pi reads a provider's API key from, the usual one first. Pi keeps this map in its own
 * `env-api-keys.js`, which its package does not export by name, so it is imported by its file next to Pi's entry.
 * When a later Pi moves it, keys still work, and only the names go unsaid.
 */
export async function loadPiKeyVariables(): Promise<(provider: string) => string[]> {
  try {
    const { findEnvKeys } = (await import(new URL('./env-api-keys.js', entryOf('@earendil-works/pi-ai')).href)) as {
      findEnvKeys(provider: string, env: object): string[] | undefined
    }
    return (provider) => {
      const names = findEnvKeys(provider, EVERY_VARIABLE) ?? []
      // Anthropic also reads token variables first. The key variable is the one people set.
      return names.toSorted((left, right) => Number(right.endsWith('_API_KEY')) - Number(left.endsWith('_API_KEY')))
    }
  } catch {
    return () => []
  }
}
