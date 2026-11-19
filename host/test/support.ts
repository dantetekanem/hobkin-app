import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TestContext } from 'node:test'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import { applyMessageOps } from '#shared/protocol/message-ops.ts'
import type { ClientMessage, HelloMessage, HostMessage, OwnerState, ResultMessage, TurnMessage } from '#shared/protocol/messages.ts'
import type { ModelChoice, ModelsState, ProviderAccess } from '#shared/protocol/models.ts'
import type { SignInState } from '#shared/protocol/signin.ts'
import type { ChatMessage, WireSnapshot } from '#shared/protocol/snapshot.ts'
import { DEV_UI_ORIGIN } from '../src/access.ts'
import { startHost, type HostOptions, type RunningHost } from '../src/host.ts'
import type { ModelAccess } from '../src/model-access.ts'
import type { PiAuthInteraction } from '../src/pi.ts'

const WAIT_MS = 10000

const cleanups = new WeakMap<TestContext, (() => unknown)[]>()

/**
 * Runs when the test ends, newest first. The test runner's own hooks run oldest first, which would delete a
 * home before the host that owns it had closed.
 */
export function afterTest(t: TestContext, cleanup: () => unknown): void {
  let stack = cleanups.get(t)
  if (!stack) {
    stack = []
    cleanups.set(t, stack)
    const steps = stack
    t.after(async () => {
      for (const step of steps.reverse()) await step()
    })
  }
  stack.push(cleanup)
}

/** A private folder that goes when the test ends. Tests never touch a real home. */
export function temporaryDirectory(t: TestContext): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-client-')))
  afterTest(t, () => rmSync(directory, { recursive: true, force: true }))
  return directory
}

/** A host in this process, on a temporary home, with the scripted model. */
export async function hostFor(t: TestContext, options: Partial<HostOptions> = {}): Promise<RunningHost> {
  const host = await startHost({ root: join(temporaryDirectory(t), 'home'), origins: [DEV_UI_ORIGIN], ...options })
  afterTest(t, () => host.close())
  return host
}

/** What a UI would hold after the messages received so far. */
export interface View {
  hello: HelloMessage | null
  owner: OwnerState | null
  signIn: SignInState | null
  models: ModelsState | null
  snapshot: WireSnapshot
  messages: ChatMessage[]
  turns: TurnMessage[]
}

/** A provider of the fake catalog, with the models it brings once connected. */
export interface FakeProvider extends Omit<ProviderAccess, 'connected'> {
  models: Omit<ModelChoice, 'provider'>[]
}

export interface FakeAccessOptions {
  catalog?: FakeProvider[]
  /** Providers with a credential in Pi's store when the test starts. */
  stored?: string[]
  /** Providers Pi reaches through the environment or cloud credentials. Sign-out does not touch these. */
  ambient?: string[]
  /** How a sign-in goes. By default it is approved at once. */
  flow?: (provider: string, interaction: PiAuthInteraction) => Promise<void>
}

/** Values a real credential would hold. None of them may ever reach a message to the UI or the log. */
export const FAKE_SECRETS = { access: 'sk-access-SECRET-1', refresh: 'rt-refresh-SECRET-2', apiKey: 'sk-api-SECRET-3' }

export const FAKE_CATALOG: FakeProvider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    signIn: { label: 'Anthropic (Claude Pro/Max)', subscription: true },
    apiKey: { label: 'Anthropic API key', env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OAUTH_TOKEN'] },
    models: [{ id: 'claude-test', name: 'Claude Test', thinking: ['minimal', 'low', 'medium', 'high'], contextWindow: 200000 }],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    signIn: { label: 'Sign in with ChatGPT', subscription: true },
    apiKey: { label: 'OpenAI API key', env: ['OPENAI_API_KEY'] },
    models: [
      { id: 'gpt-test', name: 'GPT Test', thinking: ['off', 'low', 'medium', 'high', 'xhigh'], contextWindow: 400000 },
      { id: 'gpt-test-mini', name: 'GPT Test Mini', thinking: ['off'], contextWindow: null },
    ],
  },
  { id: 'google', name: 'Google', apiKey: { label: 'Gemini API key', env: ['GEMINI_API_KEY'] }, models: [{ id: 'gemini-test', name: 'Gemini Test', thinking: ['off', 'high'], contextWindow: 1000000 }] },
  { id: 'amazon-bedrock', name: 'Amazon Bedrock', cloud: { label: 'An AWS profile, access keys or a Bedrock bearer token' }, models: [{ id: 'bedrock-test', name: 'Bedrock Test', thinking: ['off'], contextWindow: 128000 }] },
]

/**
 * Pi's model access as the host uses it, over a store the test can look into. It stands in for Pi's `ModelRuntime`
 * and its `auth.json`, so no test reads or writes the user's credentials.
 */
export function fakeModelAccess({ catalog = FAKE_CATALOG, stored = [], ambient = [], flow = async () => {} }: FakeAccessOptions = {}) {
  const store = new Map<string, unknown>(stored.map((id) => [id, { type: 'oauth', ...FAKE_SECRETS }]))
  const reachable = new Set(ambient)
  const logins: string[] = []
  const keyCommands: { provider: string; command: string }[] = []
  const find = (id: string) => {
    const provider = catalog.find((entry) => entry.id === id)
    if (!provider) throw Error(`Unknown provider: ${id}`)
    return provider
  }
  const connected = (id: string) => store.has(id) || reachable.has(id)
  const access: ModelAccess = {
    list: async () => ({
      providers: catalog.map(({ models: _models, ...provider }) => ({ ...provider, connected: connected(provider.id) })),
      models: catalog.filter(({ id }) => connected(id)).flatMap(({ id, models }) => models.map((model) => ({ ...model, provider: id }))),
    }),
    update: async () => ({ ...(await access.list()), added: [], errors: [] }),
    login: async (id, interaction) => {
      find(id)
      logins.push(id)
      await flow(id, interaction)
      // What Pi stores. The host never sees it.
      store.set(id, { type: 'oauth', ...FAKE_SECRETS })
    },
    logout: async (id) => void store.delete(id),
    hasStoredCredential: async (id) => store.has(id),
    storeKeyCommand: async (id, command) => {
      find(id)
      keyCommands.push({ provider: id, command })
      store.set(id, { type: 'api_key', key: command })
    },
  }
  return { access, store, reachable, logins, keyCommands }
}

export interface ConnectOptions {
  token?: string
  origin?: string | null
}

export class Client {
  readonly received: HostMessage[] = []
  readonly view: View = { hello: null, owner: null, signIn: null, models: null, snapshot: {}, messages: [], turns: [] }
  private readonly socket: WebSocket
  private readonly watchers = new Set<() => void>()
  private commands = 0

  private constructor(socket: WebSocket) {
    this.socket = socket
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as HostMessage
      this.received.push(message)
      this.fold(message)
      for (const watcher of [...this.watchers]) watcher()
    })
  }

  /** Rejects with the HTTP status when the host refuses the connection. */
  static connect(host: { port: number; token: string }, { token = host.token, origin = DEV_UI_ORIGIN }: ConnectOptions = {}): Promise<Client> {
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    const socket = new WebSocket(`ws://127.0.0.1:${host.port}/${query}`, origin === null ? {} : { origin })
    const client = new Client(socket)
    return new Promise((resolve, reject) => {
      socket.once('open', () => resolve(client))
      socket.once('unexpected-response', (_request, response) => reject(Error(`Refused with ${response.statusCode}`)))
      socket.once('error', reject)
    })
  }

  private fold(message: HostMessage) {
    const { view } = this
    if (message.type === 'hello') Object.assign(view, { hello: message, owner: message.owner, signIn: message.signIn, models: message.models })
    if (message.type === 'turn') view.turns.push(message)
    if (message.type !== 'state') return

    if (message.reset) Object.assign(view, { snapshot: {}, messages: [] })
    if (message.models) view.models = message.models
    view.snapshot = { ...view.snapshot, ...message.set }
    for (const key of message.unset ?? []) delete view.snapshot[key]
    if (message.messages) view.messages = applyMessageOps(view.messages, message.messages)
    if (message.owner) view.owner = message.owner
    if (message.signIn) view.signIn = message.signIn
  }

  /** Resolves with the view once it passes the check. */
  until(passes: (view: View) => unknown, what = 'the expected state'): Promise<View> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.watchers.delete(look)
        reject(Error(`Timed out waiting for ${what}. Owner ${JSON.stringify(this.view.owner)}, ${this.view.messages.length} messages.`))
      }, WAIT_MS)
      const look = () => {
        if (!passes(this.view)) return
        clearTimeout(timer)
        this.watchers.delete(look)
        resolve(this.view)
      }
      this.watchers.add(look)
      look()
    })
  }

  live(): Promise<View> {
    return this.until((view) => view.owner?.state === 'live' && view.snapshot.connection === 'connected', 'a live host')
  }

  /** Sends a command and resolves with its result, whether it worked or not. */
  async command(name: string, args?: unknown): Promise<ResultMessage> {
    const id = `c${++this.commands}`
    this.socket.send(JSON.stringify({ type: 'command', id, name, args }))
    await this.until(() => this.received.some((message) => message.type === 'result' && message.id === id), `the result of ${name}`)
    return this.received.find((message): message is ResultMessage => message.type === 'result' && message.id === id)!
  }

  /** A command that must work. Resolves with its value. */
  async run<Value = unknown>(name: string, args?: unknown): Promise<Value> {
    const result = await this.command(name, args)
    if (!result.ok) throw Error(`${name} failed: ${result.error.message}`)
    return result.value as Value
  }

  /** Sends a message the host answers nothing to, such as what the user is doing. */
  send(message: ClientMessage) {
    this.socket.send(JSON.stringify(message))
  }

  sendRaw(text: string) {
    this.socket.send(text)
  }

  /** The address this client connected to, token included. */
  get url(): string {
    return this.socket.url
  }

  closed(): Promise<number> {
    return new Promise((resolve) => this.socket.once('close', (code) => resolve(code)))
  }

  close() {
    this.socket.close()
  }
}

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url))

export interface HostProcess {
  output(): string
  /** Port and token, as the shell reads them from the home. */
  address(home: string): { pid: number; port: number; token: string }
  /** Sends the signal and resolves with how the process ended: its exit code, or the signal that killed it. */
  kill(signal: NodeJS.Signals): Promise<number | NodeJS.Signals | null>
}

/** The host as its own process, started the way the shell starts it. Resolves once it is listening. */
export async function runHostProcess(t: TestContext, args: string[], env: Record<string, string> = {}): Promise<HostProcess> {
  // The test's own Herdr and test markers must not reach it: it has to behave as it does when started by hand.
  const { HERDR_ENV: _herdr, NODE_TEST_CONTEXT: _test, ...inherited } = process.env
  const child = spawn(process.execPath, [MAIN, ...args], { env: { ...inherited, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const exited = new Promise<number | NodeJS.Signals | null>((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal)))
  const kill = (signal: NodeJS.Signals) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    return exited
  }
  afterTest(t, () => kill('SIGKILL'))

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`The host did not start.\n${output}`)), WAIT_MS)
    const look = () => {
      if (!/listening on/.test(output)) return
      clearTimeout(timer)
      resolve()
    }
    child.stdout.on('data', look)
    void exited.then(() => {
      clearTimeout(timer)
      reject(Error(`The host exited before it was listening.\n${output}`))
    })
  })

  return {
    output: () => output,
    address: (home) => JSON.parse(readFileSync(join(home, 'client', 'host.json'), 'utf8')),
    kill,
  }
}

/** What Pi sent the fake model server: the model it asked for, and the conversation as a provider sees it. */
export interface ModelRequest {
  model: string
  messages: { role: string; content?: unknown; tool_calls?: unknown }[]
}

export type ModelReply = { text: string } | { toolCall: { name: string; arguments: Record<string, unknown> } }

/**
 * A model server on this machine that speaks OpenAI's chat completions, the API Pi uses for DeepSeek. Pi reaches it
 * once models.json moves DeepSeek's address here, so a live host runs through real Pi and spends nothing.
 */
export async function fakeModelServer(t: TestContext, reply: (request: ModelRequest, index: number) => ModelReply) {
  const requests: ModelRequest[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) return void response.writeHead(404).end()
      const asked = JSON.parse(body) as ModelRequest
      requests.push(asked)
      const answer = reply(asked, requests.length - 1)
      const chunk = (choices: unknown[], extra: object = {}) =>
        response.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 0, model: asked.model, choices, ...extra })}\n\n`)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      if ('text' in answer) {
        chunk([{ index: 0, delta: { role: 'assistant', content: answer.text }, finish_reason: null }])
        chunk([{ index: 0, delta: {}, finish_reason: 'stop' }])
      } else {
        const call = { index: 0, id: `call_${requests.length}`, type: 'function', function: { name: answer.toolCall.name, arguments: JSON.stringify(answer.toolCall.arguments) } }
        chunk([{ index: 0, delta: { role: 'assistant', tool_calls: [call] }, finish_reason: null }])
        chunk([{ index: 0, delta: {}, finish_reason: 'tool_calls' }])
      }
      chunk([], { usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } })
      response.end('data: [DONE]\n\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  afterTest(t, () => new Promise((resolve) => server.close(resolve)))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { origin, baseUrl: `${origin}/v1`, requests }
}

/**
 * Pi's own folder for a test: a saved default model, and providers that speak chat completions (DeepSeek, unless
 * told otherwise) moved to the fake server, each with a made-up key. `PI_CODING_AGENT_DIR` points Pi here, so it
 * never reads the user's settings, extensions or credentials.
 */
export function piFolderFor(t: TestContext, baseUrl: string, { providers = ['deepseek'], defaultModel = 'deepseek-flash' } = {}): string {
  const folder = join(temporaryDirectory(t), 'agent')
  const each = (value: object) => Object.fromEntries(providers.map((id) => [id, value]))
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  writeFileSync(join(folder, 'settings.json'), JSON.stringify({ defaultProvider: 'deepseek', defaultModel, defaultThinkingLevel: 'high' }))
  writeFileSync(join(folder, 'models.json'), JSON.stringify({ providers: each({ baseUrl }) }))
  writeFileSync(join(folder, 'auth.json'), JSON.stringify(each({ type: 'api_key', key: 'not-a-real-key' })), { mode: 0o600 })
  return folder
}

/** A command on the PATH that only writes down how it was called, standing in for one the host must never run. */
export function fakeCommands(t: TestContext, names: string[]): { bin: string; log: string } {
  const bin = join(temporaryDirectory(t), 'bin')
  const log = join(bin, 'calls.log')
  mkdirSync(bin)
  for (const name of names) writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n`, { mode: 0o755 })
  return { bin, log }
}
