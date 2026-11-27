/**
 * The ways to reach a model, as Pi knows them. Pi owns every account and credential. This says only which
 * providers there are, how each can connect, whether it is connected now, and which models Pi can use.
 */

export interface ProviderAccess {
  /** Pi's id for the provider, such as `anthropic`. */
  id: string
  name: string
  /** A sign-in through the browser, as Pi's `/login` offers it. `subscription` marks a paid plan such as ChatGPT or Claude Pro. */
  signIn?: { label: string; subscription: boolean }
  /** An API key. `env` names the variables Pi reads it from, the usual one first. */
  apiKey?: { label: string; env: string[] }
  /** Credentials the provider finds by itself, such as an AWS profile or Google application default credentials. */
  cloud?: { label: string }
  /** Pi can reach the provider now. Nothing else about its credential is ever sent. */
  connected: boolean
  /**
   * How Pi reaches it, when connected and Pi can tell: a sign-in it keeps, an API key it keeps, a key from the
   * environment, the cloud's own credentials, or the launcher the hobkin config names. Never the credential itself.
   */
  connectedBy?: 'sign-in' | 'key' | 'environment' | 'cloud' | 'launcher'
  /** The model id Pi starts on for this provider when nothing is saved, from Pi's own table. Only a model Pi's catalog has. */
  defaultModel?: string
}

/** A model Pi can use now, as Pi's `/model` picker lists it. */
export interface ModelChoice {
  id: string
  provider: string
  name: string
  /** The thinking levels Pi allows for it, lowest first. */
  thinking: string[]
  /** Its context window in tokens, when Pi knows it. */
  contextWindow: number | null
  /** What Pi says a million tokens cost, in and out, in US dollars. Left out when Pi knows no price. */
  cost?: { input: number; output: number }
}

export interface ModelsState {
  providers: ProviderAccess[]
  models: ModelChoice[]
}

/**
 * What "Update models" found. The state is the list as it is after the refresh. `added` names the models that were not in
 * the last list, as `provider/id`. `errors` has one line per provider Pi could not refresh: the rest still updated.
 */
export interface ModelsUpdate extends ModelsState {
  added: string[]
  errors: { provider: string; message: string }[]
}

/** How to give Pi an API key without the key passing through the app. */
export interface KeyHelp {
  provider: string
  /** What Pi calls the key, such as "Anthropic API key". */
  label: string
  /** The environment variable Pi reads the key from. */
  env: string | null
  /**
   * The macOS Keychain route. `store` runs in Terminal and asks for the key there. `line` is the key Pi's
   * `auth.json` holds afterwards: Pi runs it when it needs the key. Null where the route does not apply.
   */
  keychain: { store: string; line: string } | null
  /** What else the provider needs, when a key alone does not do it. */
  note: string | null
  connected: boolean
}

/** Whether Pi can use any model at all. Until it can, the app asks the user to connect one. */
export const hasUsableModel = (models: Pick<ModelsState, 'models'> | null | undefined): boolean => (models?.models.length ?? 0) > 0
