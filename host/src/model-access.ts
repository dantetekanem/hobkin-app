import { scrubText } from '#shared/integrations/redact.ts'
import type { ModelChoice, ModelsState, ModelsUpdate, ProviderAccess } from '#shared/protocol/models.ts'
import { CLOUD_ROUTES } from './key-help.ts'
import { loadPiAi, loadPiCodingAgent, loadPiDefaultModels, loadPiKeyVariables, type PiAuthInteraction, type PiModel, type PiModelRuntime, type PiProvider } from './pi.ts'

/**
 * Every way to reach a model, as Pi has it. Pi owns the accounts and the credentials: this lists them, starts Pi's own
 * flows and hands Pi what the user chose. Nothing here reads a credential.
 */
export interface ModelAccess {
  /** Every provider Pi knows, how it connects and whether it is connected, and the models Pi can use now. */
  list(): Promise<ModelsState>
  /**
   * Pi's own model catalog refresh, as `pi update` does it: over the network, whatever Pi cached, with a time limit. Then the
   * list again, with what is new and what a provider could not give. Throws when the refresh ran out of time.
   */
  update(): Promise<ModelsUpdate>
  /** Pi's sign-in for the provider. Resolves once Pi has stored the credential. */
  login(provider: string, interaction: PiAuthInteraction): Promise<void>
  /** Removes the provider's credential from Pi's store. */
  logout(provider: string): Promise<void>
  /** Whether Pi's store holds a credential for the provider. Metadata only. */
  hasStoredCredential(provider: string): Promise<boolean>
  /** Stores, through Pi's own key login, a key that is a command Pi runs to get the key. */
  storeKeyCommand(provider: string, command: string): Promise<void>
}

/** The ways a provider connects, from Pi's catalog. `env` names the key variables Pi reads for it. */
export function providerAccessOf(provider: PiProvider, env: string[], connected: boolean, defaultModel?: string): ProviderAccess {
  const { oauth, apiKey } = provider.auth ?? {}
  const cloud = CLOUD_ROUTES[provider.id]
  return {
    id: provider.id,
    name: provider.name,
    ...(oauth ? { signIn: { label: oauth.loginLabel ?? oauth.name, subscription: oauth.isSubscription === true } } : {}),
    // A key Pi reads from no variable comes with a setup of its own, which is Pi's to run.
    ...(apiKey && env.length ? { apiKey: { label: apiKey.name, env } } : {}),
    ...(cloud ? { cloud: { label: cloud.label } } : {}),
    connected,
    ...(defaultModel ? { defaultModel } : {}),
  }
}

/** Pi's default model for a provider, from its own table, when the provider's catalog has that model. */
export function defaultModelOf(defaults: Readonly<Record<string, string>>, catalog: Pick<PiModelRuntime, 'getModels'>, provider: string): string | undefined {
  const id = defaults[provider]
  return id && catalog.getModels(provider).some((model) => model.id === id) ? id : undefined
}

/** Pi's price for a model, in and out. Pi says zero for both when it knows none, and that is left out. */
function priceOf({ cost }: PiModel): ModelChoice['cost'] {
  const input = cost?.input ?? 0
  const output = cost?.output ?? 0
  const known = Number.isFinite(input) && Number.isFinite(output) && input + output > 0
  return known ? { input, output } : undefined
}

export function modelChoiceOf(model: PiModel, thinking: string[]): ModelChoice {
  const cost = priceOf(model)
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    thinking,
    contextWindow: Number.isFinite(model.contextWindow) ? (model.contextWindow as number) : null,
    ...(cost ? { cost } : {}),
  }
}

/**
 * How Pi reaches a connected provider, from where its status says the credential comes from. Pi's `source` is one of
 * stored, runtime, environment, fallback, models_json_key and models_json_command. A stored credential reads as a
 * sign-in or a key by its kind. A key given for this run only, or by an extension, is left out: Pi does not say more.
 */
export function connectedByOf(
  runtime: Pick<PiModelRuntime, 'getProviderAuthStatus'>,
  credentials: readonly { providerId: string; type: string }[],
  provider: string,
): ProviderAccess['connectedBy'] {
  const { configured, source } = runtime.getProviderAuthStatus(provider)
  if (!configured) return undefined
  if (source === 'environment') return CLOUD_ROUTES[provider] ? 'cloud' : 'environment'
  if (source === 'models_json_key' || source === 'models_json_command') return 'key'
  if (source !== 'stored') return undefined
  const kind = credentials.find(({ providerId }) => providerId === provider)?.type
  return kind === 'oauth' ? 'sign-in' : kind === 'api_key' ? 'key' : undefined
}

/** A provider Pi's catalog has no way in for: no sign-in, no key and no cloud route. It is not listed. */
const reachable = (provider: ProviderAccess) => Boolean(provider.signIn || provider.apiKey || provider.cloud)

/**
 * Pi stored the credential and then could not bring its own view up to date. The next look settles it. The error
 * carries the credential, so it is dropped here and never logged or passed on.
 */
async function committed(write: Promise<unknown>): Promise<void> {
  try {
    await write
  } catch (error) {
    if ((error as Error | undefined)?.name !== 'CredentialSynchronizationError') throw error
  }
}

/** Pi's key login asks once, for the key. The command goes in its place. A second question means a setup the app does not run. */
export function keyCommandInteraction(provider: string, name: string, command: string): PiAuthInteraction {
  let answered = false
  return {
    signal: AbortSignal.timeout(30000),
    prompt: async (prompt) => {
      if (answered || prompt.type !== 'secret') throw Error(`${name} asks for more than a key. Set it up in Pi with /login ${provider}.`)
      answered = true
      return command
    },
    notify: () => {},
  }
}

/** How long Pi's own `pi update` waits for the catalogs. */
export const CATALOG_REFRESH_MS = 15_000

interface CatalogRefresh {
  aborted: boolean
  errors: ReadonlyMap<string, Error>
}

/**
 * What `pi update` does to the model catalogs (`refreshModelCatalogs` in Pi's package-manager-cli): Pi's own refresh, with
 * the network on and every provider forced, under a time limit. A provider that failed is reported and the rest stay updated.
 */
export async function refreshCatalogs(runtime: PiModelRuntime, timeoutMs = CATALOG_REFRESH_MS): Promise<ModelsUpdate['errors']> {
  const controller = new AbortController()
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(Error('Model catalog refresh timed out.'))
    }, timeoutMs)
  })
  try {
    const refreshing = runtime.refresh({ allowNetwork: true, force: true, signal: controller.signal } as Parameters<PiModelRuntime['refresh']>[0]) as Promise<CatalogRefresh | undefined>
    // A refresh that finishes after the limit has nothing to report to.
    refreshing.catch(() => {})
    const result = await Promise.race([refreshing, expired])
    if (result?.aborted) throw Error('Model catalog refresh timed out.')
    return Array.from(result?.errors ?? [], ([provider, error]) => ({ provider, message: scrubText(error.message) }))
  } finally {
    clearTimeout(timer)
  }
}

const idsOf = (state: ModelsState) => state.models.map(({ provider, id }) => `${provider}/${id}`)

/**
 * `list` and `update` over one runtime. The models the last list had are kept, so an update says which ones the refresh
 * brought: a model that was there before is not new.
 */
export function updatingAccess(runtime: PiModelRuntime, list: () => Promise<ModelsState>, timeoutMs?: number): Pick<ModelAccess, 'list' | 'update'> {
  let known: Set<string> | null = null
  const look = async () => {
    const state = await list()
    known = new Set(idsOf(state))
    return state
  }
  return {
    list: look,
    update: async () => {
      const before = known ?? new Set(idsOf(await look()))
      const errors = await refreshCatalogs(runtime, timeoutMs)
      const state = await look()
      return { ...state, added: idsOf(state).filter((id) => !before.has(id)), errors }
    },
  }
}

export interface LiveModelAccess extends ModelAccess {
  /** Pi's model runtime itself, for hobkin's main session to share, so a sign-in here reaches it at once. */
  runtime: PiModelRuntime
}

/**
 * Pi's own model runtime, on Pi's own files: `~/.pi/agent/auth.json`, `models.json` and the environment, as `pi` and
 * the terminal app use them. Only `--live` opens this. `options` point it elsewhere, for tests.
 */
export async function piModelAccess(options: Record<string, unknown> = {}, providerExtensions?: Record<string, string>): Promise<LiveModelAccess> {
  const [pi, ai, keyVariables, defaults] = await Promise.all([loadPiCodingAgent(), loadPiAi(), loadPiKeyVariables(), loadPiDefaultModels()])
  const runtime = await pi.ModelRuntime.create({ allowModelNetwork: false, ...options })
  if (providerExtensions && Object.keys(providerExtensions).length) {
    const { loadProviderExtensions } = await import('hobkin/src/cli/provider-extensions.mjs')
    await loadProviderExtensions(runtime, providerExtensions)
  }
  // The id Pi gives this machine for OpenAI's sign-in, kept in Pi's settings, where the old `hobkin login` kept it too.
  const settings = pi.SettingsManager.create(process.cwd(), pi.getAgentDir())
  const nameOf = (provider: string) => runtime.getProviders().find(({ id }) => id === provider)?.name ?? provider

  const list = async (): Promise<ModelsState> => {
    // The store and the environment may have changed in a terminal since the last look.
    await runtime.refresh({ allowNetwork: false }).catch(() => {})
    // How each one connects is a detail. A credential store Pi cannot list must not take the providers with it.
    const credentials = await Promise.resolve(runtime.listCredentials()).catch(() => [])
    const providers = runtime
      .getProviders()
      .map((provider) => {
        const access = providerAccessOf(provider, keyVariables(provider.id), runtime.getProviderAuthStatus(provider.id).configured, defaultModelOf(defaults, runtime, provider.id))
        const connectedBy = access.connected ? connectedByOf(runtime, credentials, provider.id) : undefined
        return connectedBy ? { ...access, connectedBy } : access
      })
      .filter(reachable)
    const models = (await runtime.getAvailable()).map((model) => modelChoiceOf(model, ai.getSupportedThinkingLevels(model)))
    return { providers, models }
  }

  return {
    runtime,
    ...updatingAccess(runtime, list),
    // What Pi resolves with is the credential. It is not kept, logged or passed on.
    login: (provider, interaction) => committed(runtime.login(provider, 'oauth', interaction, { getDeviceId: () => settings.getOrCreateDeviceId() })),
    logout: (provider) => committed(runtime.logout(provider)),
    hasStoredCredential: async (provider) => (await runtime.listCredentials()).some(({ providerId }) => providerId === provider),
    storeKeyCommand: (provider, command) => committed(runtime.login(provider, 'api_key', keyCommandInteraction(provider, nameOf(provider), command))),
  }
}
