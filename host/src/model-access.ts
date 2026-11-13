import type { ModelChoice, ModelsState, ProviderAccess } from '#shared/protocol/models.ts'
import { CLOUD_ROUTES } from './key-help.ts'
import { loadPiAi, loadPiCodingAgent, loadPiDefaultModels, loadPiKeyVariables, type PiAuthInteraction, type PiModel, type PiModelRuntime, type PiProvider } from './pi.ts'

/**
 * Every way to reach a model, as Pi has it. Pi owns the accounts and the credentials: this lists them, starts Pi's own
 * flows and hands Pi what the user chose. Nothing here reads a credential.
 */
export interface ModelAccess {
  /** Every provider Pi knows, how it connects and whether it is connected, and the models Pi can use now. */
  list(): Promise<ModelsState>
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

export function modelChoiceOf(model: PiModel, thinking: string[]): ModelChoice {
  return {
    id: model.id,
    provider: model.provider,
    name: model.name,
    thinking,
    contextWindow: Number.isFinite(model.contextWindow) ? (model.contextWindow as number) : null,
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

export interface LiveModelAccess extends ModelAccess {
  /** Pi's model runtime itself, for hobkin's main session to share, so a sign-in here reaches it at once. */
  runtime: PiModelRuntime
}

/**
 * Pi's own model runtime, on Pi's own files: `~/.pi/agent/auth.json`, `models.json` and the environment, as `pi` and
 * the terminal app use them. Only `--live` opens this. `options` point it elsewhere, for tests.
 */
export async function piModelAccess(options: Record<string, unknown> = {}): Promise<LiveModelAccess> {
  const [pi, ai, keyVariables, defaults] = await Promise.all([loadPiCodingAgent(), loadPiAi(), loadPiKeyVariables(), loadPiDefaultModels()])
  const runtime = await pi.ModelRuntime.create({ allowModelNetwork: false, ...options })
  // The id Pi gives this machine for OpenAI's sign-in, kept in Pi's settings as `hobkin login` does it.
  const settings = pi.SettingsManager.create(process.cwd(), pi.getAgentDir())
  const nameOf = (provider: string) => runtime.getProviders().find(({ id }) => id === provider)?.name ?? provider

  return {
    runtime,
    list: async () => {
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
    },
    // What Pi resolves with is the credential. It is not kept, logged or passed on.
    login: (provider, interaction) => committed(runtime.login(provider, 'oauth', interaction, { getDeviceId: () => settings.getOrCreateDeviceId() })),
    logout: (provider) => committed(runtime.logout(provider)),
    hasStoredCredential: async (provider) => (await runtime.listCredentials()).some(({ providerId }) => providerId === provider),
    storeKeyCommand: (provider, command) => committed(runtime.login(provider, 'api_key', keyCommandInteraction(provider, nameOf(provider), command))),
  }
}
