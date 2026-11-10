import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { hasUsableModel, type KeyHelp, type ModelsState, type ProviderAccess } from '#shared/protocol/models.ts'
import type { SignInProblem, SignInState } from '#shared/protocol/signin.ts'
import { Unavailable } from './commands.ts'
import { CLOUD_ROUTES, keyHelpFor } from './key-help.ts'
import type { ModelAccess } from './model-access.ts'
import type { PiAuthEvent, PiAuthInteraction, PiAuthPrompt } from './pi.ts'

/**
 * Connecting models, carried between Pi and the UI. Pi owns every flow and credential: it opens the callback port,
 * exchanges the code and writes its own store. The host passes along only what the user has to see and answer, and
 * keeps the list of providers and models current. A credential never enters the state, a message or the log.
 */

/** Opens a page in the system browser. Only a web address is ever handed to the system. */
export function openInBrowser(url: string): void {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
  const child = spawn(opener, [url], { stdio: 'ignore', detached: true })
  child.on('error', () => {})
  child.unref()
}

const isWebAddress = (url: string) => {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

// A provider's message can quote what it was given: the pasted address with its code, or a token it rejected.
const SECRET_VALUE = /\b([\w-]*(?:token|secret|password|authorization|api[_-]?key)[\w-]*)(["']?\s*[=:]\s*["']?)[^\s&"',}]+/gi
const AUTH_CODE = /\b(code=)[^\s&"']+/gi
const BEARER = /\b(Bearer\s+)\S+/gi

/** Text that is safe to show and to log: anything that looks like a credential is taken out. */
export const withoutSecrets = (text: string): string =>
  // The bearer token first, or `Authorization: Bearer <token>` would lose the word and keep the token.
  text.replace(BEARER, '$1[hidden]').replace(AUTH_CODE, '$1[hidden]').replace(SECRET_VALUE, '$1$2[hidden]')

// Pi's own words for the OpenAI sign-in's port, and Node's for any other.
const PORT_IN_USE = /Port (\d+) is in use|EADDRINUSE\D*(?:[\d.]+:)?(\d+)/

/** The port of OpenAI's sign-in, which the Codex CLI listens on too. */
const CODEX_PORT = 1455

export function problemOf(error: unknown, provider: string): SignInProblem {
  const said = error instanceof Error ? error.message : String(error)
  const found = PORT_IN_USE.exec(said)
  const port = Number(found?.[1] ?? found?.[2])
  if (port) {
    const holder = port === CODEX_PORT ? 'another sign-in or the Codex CLI usually holds it' : 'another sign-in that did not finish usually holds it'
    return { code: 'port-busy', provider, port, message: `Port ${port} is busy. Pi listens on it for the browser's answer, and ${holder}. Close that, then try again.` }
  }
  return { code: 'failed', provider, message: withoutSecrets(said) }
}

/** Where a provider that has no sign-in can be reached from instead. */
function otherRoute(provider: ProviderAccess): string {
  if (provider.apiKey) return `It takes an API key: ${provider.apiKey.env[0] ?? provider.apiKey.label}.`
  if (provider.cloud) return `It uses cloud credentials: ${provider.cloud.label}.`
  return `Set it up in Pi with /login ${provider.id}.`
}

/** How Pi still reaches a provider after its stored credential is gone. */
function remainingRoute(provider: ProviderAccess): string {
  if (provider.apiKey?.env.length) return `through ${provider.apiKey.env.join(' or ')} in the environment`
  if (provider.cloud) return `through ${CLOUD_ROUTES[provider.id]?.label.toLowerCase() ?? 'cloud credentials'}`
  return 'through its own setup'
}

export interface SignInOptions {
  /** Pi's model access, opened on first use. */
  access: () => Promise<ModelAccess>
  openUrl: (url: string) => void
  log: (line: string) => void
  onChange: () => void
  /** The Keychain route works on this machine. */
  keychain: boolean
}

interface Asked {
  id: string
  resolve: (value: string) => void
  reject: (error: Error) => void
}

const CANCELLED = 'Login cancelled'

export class SignIn {
  state: SignInState = { status: 'unknown' }
  /** The providers Pi knows and the models it can use now. Null until Pi has said. */
  models: ModelsState | null = null
  private readonly options: SignInOptions
  private access: Promise<ModelAccess> | null = null
  private attempt: { id: number; controller: AbortController } | null = null
  private attempts = 0
  private asked: Asked | null = null
  private looking: Promise<void> | null = null
  private lookAgain = false
  /** What went wrong with the last sign-in, kept on screen until the next one. */
  private problem: SignInProblem | undefined

  constructor(options: SignInOptions) {
    this.options = options
  }

  private pi(): Promise<ModelAccess> {
    this.access ??= this.options.access()
    return this.access
  }

  private set(state: SignInState) {
    this.state = state
    this.options.onChange()
  }

  /** Changes the sign-in that is under way. Nothing happens once it is over. */
  private update(attempt: number, change: Partial<Extract<SignInState, { status: 'signing-in' }>>) {
    if (this.attempt?.id !== attempt || this.state.status !== 'signing-in') return
    this.set({ ...this.state, ...change })
  }

  /** Reads Pi's providers and models again. Looks that come in while one runs are folded into one more. */
  refresh(): Promise<void> {
    if (this.looking) {
      this.lookAgain = true
      return this.looking
    }
    this.looking = (async () => {
      do {
        this.lookAgain = false
        this.models = await (await this.pi()).list()
      } while (this.lookAgain)
      if (!this.attempt) {
        const ready = hasUsableModel(this.models)
        this.set({ status: ready ? 'signed-in' : 'signed-out', ...(this.problem ? { problem: this.problem } : {}) })
      } else this.options.onChange()
    })().finally(() => {
      this.looking = null
    })
    return this.looking
  }

  private async provider(id: string): Promise<ProviderAccess> {
    if (!this.models) await this.refresh()
    const provider = this.models?.providers.find((entry) => entry.id === id)
    if (!provider) throw new Unavailable(`Pi has no provider named ${id}.`)
    return provider
  }

  /** Starts Pi's sign-in for a provider. How it goes shows in the state. */
  async start(id: string): Promise<void> {
    const provider = await this.provider(id)
    if (!provider.signIn) throw new Unavailable(`${provider.name} has no sign-in. ${otherRoute(provider)}`)
    if (this.attempt) throw new Unavailable('A sign-in is already under way.')

    const attempt = { id: ++this.attempts, controller: new AbortController() }
    this.attempt = attempt
    this.problem = undefined
    this.set({ status: 'signing-in', provider: id, lines: [] })
    this.options.log(`Sign-in to ${id} started.`)

    const interaction: PiAuthInteraction = {
      signal: attempt.controller.signal,
      prompt: (prompt) => this.ask(attempt.id, provider, prompt),
      notify: (event) => this.note(attempt.id, event),
    }
    void this.pi()
      .then((pi) => pi.login(id, interaction))
      .then(
        () => this.finish(attempt.id, id, null),
        (error) => this.finish(attempt.id, id, error),
      )
  }

  private async finish(attempt: number, provider: string, error: unknown): Promise<void> {
    if (this.attempt?.id !== attempt) return
    const cancelled = this.attempt.controller.signal.aborted
    this.attempt = null
    this.asked = null

    this.problem = error === null || cancelled ? undefined : problemOf(error, provider)
    if (error === null) this.options.log(`Signed in to ${provider}.`)
    else this.options.log(cancelled ? `Sign-in to ${provider} cancelled.` : `Sign-in to ${provider} failed: ${this.problem!.message}`)
    // Pi is asked again either way: it is the only one who knows what is connected now.
    await this.refresh().catch(() => this.set({ status: 'signed-out', ...(this.problem ? { problem: this.problem } : {}) }))
  }

  /** Something Pi asks the user, such as the address to paste when the browser could not reach the callback. */
  private ask(attempt: number, provider: ProviderAccess, prompt: PiAuthPrompt): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.attempt?.id !== attempt) return reject(Error(CANCELLED))
      // No key passes through the app. A sign-in that wants one is Pi's to run.
      if (prompt.type === 'secret') return reject(Error(`${provider.name}'s sign-in asked for a secret, which the app never takes. Set it up in Pi with /login ${provider.id}.`))

      const id = randomUUID()
      const close = (settle: () => void) => {
        if (this.asked?.id !== id) return
        this.asked = null
        this.update(attempt, { prompt: undefined })
        settle()
      }
      this.asked = { id, resolve: (value) => close(() => resolve(value)), reject: (error) => close(() => reject(error)) }
      // Pi closes the question itself once the browser answered, and the field then leaves the screen.
      prompt.signal?.addEventListener('abort', () => this.asked?.id === id && this.asked.reject(Error(CANCELLED)), { once: true })
      this.update(attempt, {
        prompt: {
          id,
          kind: prompt.type,
          message: withoutSecrets(prompt.message),
          ...(prompt.placeholder ? { placeholder: prompt.placeholder } : {}),
          ...(prompt.options ? { options: prompt.options.map(({ id: option, label, description }) => ({ id: option, label, ...(description ? { description } : {}) })) } : {}),
        },
      })
    })
  }

  private note(attempt: number, event: PiAuthEvent): void {
    if (this.attempt?.id !== attempt || this.state.status !== 'signing-in') return

    if (event.type === 'auth_url') {
      // The page to approve on opens by itself. The UI keeps the address for opening it again.
      if (isWebAddress(event.url)) this.options.openUrl(event.url)
      this.update(attempt, { authUrl: event.url, ...(event.instructions ? { instructions: withoutSecrets(event.instructions) } : {}) })
    } else if (event.type === 'device_code') {
      this.update(attempt, { authUrl: event.verificationUri, lines: [...this.state.lines, `Enter the code ${event.userCode} on the page that opened.`] })
    } else {
      this.update(attempt, { lines: [...this.state.lines, withoutSecrets(event.message)].slice(-20) })
    }
  }

  /** The user's answer to what Pi asked. It goes to Pi as given and is kept nowhere. */
  answer(prompt: string, value: string): void {
    if (this.asked?.id !== prompt) throw new Unavailable('That question is no longer open.')
    this.asked.resolve(value)
  }

  /** Backs out of the sign-in under way. Pi stores nothing. */
  cancel(): void {
    if (!this.attempt) return
    this.attempt.controller.abort()
    this.asked?.reject(Error(CANCELLED))
  }

  /** Removes a provider's credential from Pi's store, and says when Pi still reaches the provider without it. */
  async signOut(id: string): Promise<{ ok: true; stillConnected: boolean; message: string }> {
    const provider = await this.provider(id)
    await (await this.pi()).logout(id)
    this.options.log(`Signed out of ${id}.`)
    this.problem = undefined
    await this.refresh()
    const stillConnected = this.models?.providers.find((entry) => entry.id === id)?.connected === true
    const message = stillConnected
      ? `Signed out of ${provider.name}, but Pi still reaches ${provider.name} ${remainingRoute(provider)}. Remove that to disconnect it.`
      : `Signed out of ${provider.name}.`
    return { ok: true, stillConnected, message }
  }

  /** How to give Pi this provider's key without typing it into the app. */
  async keyHelp(id: string): Promise<KeyHelp> {
    return keyHelpFor(await this.provider(id), { keychain: this.options.keychain })
  }

  /** On the user's yes: Pi's `auth.json` gets the line that reads the provider's key from the Keychain. */
  async useKeychain(id: string): Promise<{ ok: true; connected: boolean }> {
    const provider = await this.provider(id)
    const help = keyHelpFor(provider, { keychain: this.options.keychain })
    if (!provider.apiKey) throw new Unavailable(`${provider.name} does not take an API key. ${otherRoute(provider)}`)
    if (!help.keychain) throw new Unavailable(help.note ?? `The Keychain route does not work for ${provider.name} on this machine.`)

    const pi = await this.pi()
    // Pi keeps one credential for each provider, and this line would take a sign-in's place.
    if (await pi.hasStoredCredential(id)) throw new Unavailable(`Pi already holds a credential for ${provider.name}. Sign out of it first, then add the Keychain line.`)
    await pi.storeKeyCommand(id, help.keychain.line)
    this.options.log(`Added the Keychain line for ${id} to Pi.`)
    await this.refresh()
    return { ok: true, connected: this.models?.providers.find((entry) => entry.id === id)?.connected === true }
  }
}
