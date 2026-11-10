import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import type { ModelAccess } from './model-access.ts'
import { defaultModelOf, modelChoiceOf, providerAccessOf } from './model-access.ts'
import { loadPiAi, loadPiCodingAgent, loadPiDefaultModels, loadPiKeyVariables } from './pi.ts'

/** What Pi says when its callback port is taken (`pi-ai`, `auth/oauth/openai-chatgpt.js`). */
const PORT_BUSY = 'Port 1455 is in use, probably by an unfinished login in another pi session or by the Codex CLI. Cancel that login and try again.'

/** Where the scripted sign-in says its page is. `.invalid` is reserved, so no browser can ever load it. */
export const SCRIPTED_SIGN_IN_PAGE = 'https://scripted-sign-in.invalid/'

/** A few of Pi's real providers: subscriptions, keys and cloud credentials. */
export const SCRIPTED_PROVIDERS = ['anthropic', 'openai', 'github-copilot', 'openrouter', 'google', 'amazon-bedrock'] as const

export interface ScriptedAccessOptions {
  /** Providers connected when the host starts. */
  connected?: readonly string[]
}

/**
 * Model access for development. The providers, their names and their models are Pi's own, read from Pi's built-in
 * catalog, and nothing else of Pi's is touched: no credential, no environment variable, no network. Which providers
 * are connected is scripted, and the sign-in asks for "ok" in place of a browser.
 */
export async function scriptedModelAccess({ connected = ['openai'] }: ScriptedAccessOptions = {}): Promise<ModelAccess> {
  const [pi, ai, keyVariables, defaults] = await Promise.all([loadPiCodingAgent(), loadPiAi(), loadPiKeyVariables(), loadPiDefaultModels()])
  // An empty folder of its own, and no availability pass, so Pi reads nothing of the user's: only its static catalog.
  const folder = mkdtempSync(join(tmpdir(), 'hobkin-client-catalog-'))
  const catalog = await pi.ModelRuntime.create({
    authPath: join(folder, 'auth.json'),
    modelsPath: null,
    modelsStorePath: join(folder, 'models-store.json'),
    allowModelNetwork: false,
    refreshOnCreate: false,
  })
  rmSync(folder, { recursive: true, force: true })

  const providers = catalog.getProviders().filter(({ id }) => (SCRIPTED_PROVIDERS as readonly string[]).includes(id))
  const on = new Set(connected)
  const nameOf = (id: string) => {
    const provider = providers.find((entry) => entry.id === id)
    if (!provider) throw Error(`Unknown provider: ${id}`)
    return provider.name
  }

  return {
    list: async () => ({
      providers: providers.map((provider) => providerAccessOf(provider, keyVariables(provider.id), on.has(provider.id), defaultModelOf(defaults, catalog, provider.id))),
      models: providers
        .filter(({ id }) => on.has(id))
        .flatMap(({ id }) => catalog.getModels(id).filter(({ type }) => type === undefined || type === 'chat'))
        .map((model) => modelChoiceOf(model, ai.getSupportedThinkingLevels(model))),
    }),
    login: async (id, interaction) => {
      nameOf(id)
      interaction.notify({
        type: 'auth_url',
        // A reserved name that never resolves: a real sign-in is only ever the provider's own page, which Pi opens.
        url: SCRIPTED_SIGN_IN_PAGE,
        instructions: 'This sign-in is scripted, so no page opened. Paste "ok" below to finish, "busy" to see a busy port, or anything else to see a refusal.',
      })
      const answer = await interaction.prompt({
        type: 'manual_code',
        message: 'Complete login in your browser, or paste the final redirect URL here:',
        placeholder: 'ok',
        signal: interaction.signal,
      })
      interaction.notify({ type: 'progress', message: 'Exchanging authorization code for tokens...' })
      await pause(400, undefined, { signal: interaction.signal })
      if (answer === 'busy') throw Error(PORT_BUSY)
      if (answer !== 'ok') throw Error('The scripted provider refused the sign-in.')
      on.add(id)
    },
    logout: async (id) => void on.delete(id),
    hasStoredCredential: async (id) => on.has(id),
    storeKeyCommand: async (id) => {
      nameOf(id)
      // A real Pi would run the command when it needs the key. Here the key is taken as found.
      on.add(id)
    },
  }
}
