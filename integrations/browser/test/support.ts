import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TestContext } from 'node:test'
import { gzipSync } from 'node:zlib'
import { Check } from 'typebox/value'
import { Unavailable, type CommandOutcome } from '#host/commands.ts'
import type { AgentTool, HostContext, HostPart, ToolAnswer } from '#host/integration-contract.ts'
import manifest from '../integration.ts'
import browserPart from '../host.ts'
import type { BrowserState } from '../protocol.ts'
import type { Exec } from '../host/engine.ts'

/** What the host tests share: an engine that is not one, a context that is not the host's, and a small archive. */

export const PAGE = { url: 'http://localhost:3000/', title: 'Home' }
export const SNAPSHOT = [
  '- heading "Welcome" [level=1, ref=e1]',
  '- link "About" [ref=e2, url=http://localhost:3000/about]',
  '- link "More" [ref=e3, url=http://localhost:3000/more?n=1]',
  '- link "More" [ref=e4, url=http://localhost:3000/more?n=2]',
  '- link "Sign in with a code" [ref=e5, url=http://localhost:3000/code]',
  '- textbox "Email" [ref=e6]: a@b.c',
  '- textbox "Search" [ref=e7]',
  '- button "Search" [ref=e8]',
  '- combobox "Color" [expanded=false, ref=e9]: Red',
  '  - option "Red" [selected, ref=e10]',
  '- checkbox "I agree" [checked=false, ref=e11]',
  '- button "Save" [disabled, ref=e12]',
].join('\n')

/** A private folder that goes when the test ends. */
export function temporaryFolder(t: TestContext): string {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), 'hobkin-browser-test-')))
  t.after(() => rmSync(folder, { recursive: true, force: true }))
  return folder
}

type Made = Record<string, unknown> & { fail?: string; data?: unknown }
type Answer = Made | ((command: string[]) => Made)

export interface Call {
  binary: string
  args: string[]
  options: Parameters<Exec>[2]
}

/**
 * Stands in for agent-browser: it records each command and answers as the real one does, `{ success, data }` for one
 * command and a list of rows for a batch. `answers[name]` replaces what a command answers, as data, as `{ fail }` for
 * a command that fails, or as a function of the command. It also keeps which sessions have a browser, answers
 * `session list` with them, says its version, and runs `answers.install` when asked to install Chrome.
 *
 * Like the real one, a session's browser starts with its control port open (`stream disable` closes it once, and
 * fails once it is closed) and with no request blocked (`network route` adds a block). Closing the browser forgets both.
 */
export function fakeEngine(answers: Record<string, Answer> = {}, more: { version?: string; install?: () => { code: number; stderr?: string } } = {}) {
  /** The page commands, without the session and `--json` in front. */
  const commands: string[][] = []
  const calls: Call[] = []
  /** The sessions with a browser now. */
  const sessions = new Set<string>()
  /** Those whose control port is closed, and the requests each one blocks. */
  const portClosed = new Set<string>()
  const blocked = new Map<string, string[]>()
  const data: Record<string, (command: string[]) => Made> = {
    open: () => PAGE,
    snapshot: () => ({ snapshot: SNAPSHOT }),
    network: (command) => ({ routed: command[2] }),
    read: () => ({ content: '# Welcome\n\nHello.' }),
    eval: () => ({ result: 577 }),
    get: (command) => (command[1] === 'url' ? { url: PAGE.url } : { title: PAGE.title }),
    console: (command) => (command[1] ? { cleared: true } : { messages: [{ type: 'log', text: 'hi', args: [] }] }),
    errors: (command) => (command[1] ? { cleared: true } : { errors: [{ text: 'Error: boom', line: 1, column: 2, url: null }] }),
    screenshot: (command) => ({ path: command.at(-1) }),
    back: () => ({ url: PAGE.url }),
    // The browser has one tab, its own, unless a test says a page opened more. It is where `get` says it is.
    tab: (command) => {
      const own = { tabId: 't1', url: made(['get', 'url']).url, title: made(['get', 'title']).title }
      if (command[1] === 'list') return { tabs: [{ ...own, active: true }] }
      if (command[1] === 'close') return { closed: true, tabId: command[2] }
      return own
    },
  }

  /** What a command answers: what the test said it does, or what the engine would. */
  function made(command: string[]): Made {
    const [name = ''] = command
    const given = answers[name]
    return typeof given === 'function' ? given(command) : (given ?? data[name]?.(command) ?? {})
  }

  /** What one page command answers, as the engine's JSON has it. */
  function answer(session: string, command: string[]) {
    const [name = ''] = command
    commands.push(command)

    if (name === 'close') {
      sessions.delete(session)
      portClosed.delete(session)
      blocked.delete(session)
    } else {
      sessions.add(session)
    }

    const given = answers[name]
    if (name === 'stream' && given === undefined) {
      if (portClosed.has(session)) return { success: false, data: null, error: 'Streaming is not enabled for this session' }
      portClosed.add(session)
      return { success: true, data: { disabled: true }, error: null }
    }
    if (name === 'network' && command[1] === 'route') blocked.set(session, [...(blocked.get(session) ?? []), command[2] ?? ''])

    const said = made(command)
    if (said.fail) return { success: false, data: said.data ?? null, error: said.fail }
    return { success: true, data: said, error: null }
  }

  /** A batch answers one row for each command. With `--bail` it stops at the first that fails. */
  function answerBatch(session: string, batched: string[][], bail: boolean) {
    const rows = []
    for (const command of batched) {
      const { success, data: result, error } = answer(session, command)
      rows.push({ command, success, result, error })
      if (!success && bail) break
    }
    return rows
  }

  const said = (stdout: string, code = 0, stderr = '') => ({ stdout, stderr, code })

  const exec: Exec = async (binary, args, options) => {
    calls.push({ binary, args, options })
    options.signal?.throwIfAborted()

    // What the engine is asked about itself, with no session.
    const [first] = args
    if (first === '--version') return said(`agent-browser ${more.version ?? '0.45.0'}\n`)
    if (first === 'session') return said(JSON.stringify({ success: true, data: { sessions: [...sessions] } }))
    if (first === 'install') {
      const { code, stderr = '' } = more.install?.() ?? { code: 0 }
      return said('', code, stderr)
    }

    // Everything else is a page command: `--session <name> [--json] <command…>`.
    assert.equal(first, '--session', `an engine command names its session: ${args.join(' ')}`)
    const [, session = '', json, ...command] = args

    // A stopping host closes a browser without waiting for an answer, so it asks for no JSON.
    if (json !== '--json') {
      answer(session, args.slice(2))
      return said('')
    }

    if (command[0] === 'batch') {
      const bail = command[1] === '--bail'
      assert.deepEqual(command, bail ? ['batch', '--bail'] : ['batch'])
      const batched = JSON.parse(options.input ?? '[]') as string[][]
      return said(JSON.stringify(answerBatch(session, batched, bail)))
    }

    const one = answer(session, command)
    return said(JSON.stringify(one), one.success ? 0 : 1)
  }

  /** The page commands a session ran, as `--session <name>` calls. */
  const ranIn = (session: string) => calls.filter(({ args }) => args[0] === '--session' && args[1] === session)
  return { commands, calls, sessions, portClosed, blocked, exec, ranIn }
}

export interface Fakes {
  /** What the part is handed as `context.options`. */
  options?: Record<string, unknown>
  /** hobkin's data folder. Without it hobkin is not open. */
  root?: string
  live?: boolean
  connected?: () => boolean
}

export function fakeContext(fakes: Fakes = {}) {
  const heard = { changed: 0, logs: [] as string[], onChange: undefined as (() => void) | undefined }
  const closed = (): never => {
    throw new Unavailable('hobkin is not open.')
  }
  const context: HostContext = {
    id: 'browser',
    live: fakes.live ?? false,
    options: fakes.options ?? {},
    log: (line) => void heard.logs.push(line),
    changed: () => {
      heard.changed += 1
      heard.onChange?.()
    },
    connected: fakes.connected ?? (() => true),
    hobkin: closed,
    dataRoot: () => fakes.root ?? closed(),
    snapshotWork: () => undefined,
    startWorkflow: async () => closed(),
  }
  return { context, heard }
}

export type Part = HostPart & { heard: ReturnType<typeof fakeContext>['heard'] }

export async function partFor(fakes: Fakes = {}): Promise<Part> {
  const { context, heard } = fakeContext(fakes)
  return Object.assign(await browserPart(context), { heard })
}

/**
 * What each engine call ran, by its command's name. A batch is named by the first command it holds, after the guard
 * that every command on the page runs behind.
 */
export function commandNames(calls: readonly Call[]): (string | undefined)[] {
  return calls.map(({ args, options }) => {
    const [, , , command] = args
    if (command !== 'batch') return command

    const batched = JSON.parse(options.input ?? '[]') as string[][]
    const [first, ...rest] = batched
    const startsWithGuard = first?.[0] === 'eval' && first[1] === '-b' && rest.length > 0
    return startsWithGuard ? rest[0]![0] : first?.[0]
  })
}

/** A part whose engine is installed already: a fake engine, and a binary and a Chrome that are only names. */
export async function readyPart(t: TestContext, answers: Record<string, Answer> = {}, options: Record<string, unknown> = {}, more: Pick<Fakes, 'connected'> = {}) {
  const engine = fakeEngine(answers)
  const root = temporaryFolder(t)
  const part = await partFor({ root, ...more, options: { exec: engine.exec, binary: '/fake/agent-browser', chrome: '/fake/chrome-158.0.1/Chrome', ...options } })
  return { part, engine, root }
}

export const stateOf = (part: HostPart): BrowserState => part.state!() as BrowserState

/** What the engine may be given of an environment: where things are, who runs them, the language, and its own settings. */
const HANDED_ON = /^(HOME|PATH|TMPDIR|USER|LOGNAME|SHELL|LANG|LC_\w+|__CF_USER_TEXT_ENCODING|AGENT_BROWSER_\w+)$/

/** Every run of the engine is hobkin's own: its empty config, its own folder to run in, and a short environment. */
export function assertRunsAreHobkinsOwn(calls: readonly Call[], root: string): void {
  const tools = join(root, 'tools', 'browser')
  assert.ok(calls.length > 0)

  for (const { args, options } of calls) {
    const what = args.join(' ')
    assert.equal(options.cwd, tools, `${what} runs in hobkin's folder`)
    assert.equal(options.env?.AGENT_BROWSER_CONFIG, join(tools, 'engine-config.json'), `${what} is given hobkin's config`)
    for (const name of Object.keys(options.env ?? {})) assert.match(name, HANDED_ON, `${what} is handed ${name}`)
  }
}

/** A command as the host runs it: its arguments checked against the manifest first, and what the handler throws turned into a refusal. */
export async function run(part: HostPart, name: keyof typeof manifest.commands, args: unknown = {}): Promise<CommandOutcome> {
  if (!Check(manifest.commands[name].args, args)) return { ok: false, error: { code: 'invalid-arguments', message: `${name} was given the wrong arguments.` } }
  const handler = part.handlers?.[name]
  if (!handler) return { ok: false, error: { code: 'unavailable', message: `${name} does not run in the host.` } }
  try {
    return { ok: true, value: await (handler as (args: unknown) => unknown)(args) }
  } catch (error) {
    return { ok: false, error: { code: error instanceof Unavailable ? 'unavailable' : 'failed', message: error instanceof Error ? error.message : String(error) } }
  }
}

/** The value a command answered, or a failed test with its refusal. */
export async function answered<Value>(part: HostPart, name: keyof typeof manifest.commands, args: unknown = {}): Promise<Value> {
  const outcome = await run(part, name, args)
  if (!outcome.ok) throw Error(`${name} was refused: ${outcome.error.message}`)
  return outcome.value as Value
}

export const runTool = (part: HostPart): AgentTool => part.tools!.find((tool) => tool.name === 'run')!

let calls = 0

/** One call of the tool as the host makes it: arguments checked against its schema, and the answer as text and whether it failed. */
export async function callTool(part: HostPart, args: Record<string, unknown>, agent = '#main', signal?: AbortSignal): Promise<{ text: string; failed: boolean }> {
  const tool = runTool(part)
  assert.equal(Check(tool.parameters, args), true, `the arguments fit the tool's schema: ${JSON.stringify(args)}`)
  const answer: ToolAnswer = await tool.execute(args, { agent, id: `call-${(calls += 1)}`, ...(signal ? { signal } : {}) })
  return typeof answer === 'string' ? { text: answer, failed: false } : { text: answer.text, failed: answer.failed === true }
}

/** A gzipped tar archive holding the given files, as the registry's archives are. */
export function archive(files: Record<string, string | Buffer>): Buffer {
  const blocks: Buffer[] = []
  for (const [name, content] of Object.entries(files)) {
    const body = Buffer.from(content)
    const padding = Buffer.alloc((TAR_BLOCK - (body.length % TAR_BLOCK)) % TAR_BLOCK)
    blocks.push(tarHeader(name, body.length), body, padding)
  }
  // Two empty blocks end a tar archive.
  blocks.push(Buffer.alloc(2 * TAR_BLOCK))
  return gzipSync(Buffer.concat(blocks))
}

const TAR_BLOCK = 512

/** The header block of one ordinary file in a tar archive: its name, its size in octal, and the sum of the block. */
function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK)
  const octal = (value: number, digits: number) => value.toString(8).padStart(digits, '0')

  header.write(name, 0, 100, 'utf8')
  header.write(`${octal(0o755, 7)}\0`, 100, 8, 'ascii') // mode
  header.write(`${octal(0, 7)}\0`, 108, 8, 'ascii') // owner
  header.write(`${octal(0, 7)}\0`, 116, 8, 'ascii') // group
  header.write(`${octal(size, 11)}\0`, 124, 12, 'ascii')
  header.write(`${octal(0, 11)}\0`, 136, 12, 'ascii') // changed at
  header.write('0', 156, 1, 'ascii') // an ordinary file
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')

  // The sum is taken with its own field holding spaces.
  header.write(' '.repeat(8), 148, 8, 'ascii')
  const sum = header.reduce((total, byte) => total + byte, 0)
  header.write(`${octal(sum, 6)}\0 `, 148, 8, 'ascii')
  return header
}

/** Writes a file, with the folders above it. */
export function put(file: string, content = ''): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

/** Waits until `ready` says yes, looking again each turn of the event loop. */
export async function until(ready: () => boolean, what: string): Promise<void> {
  for (let turn = 0; turn < 2000; turn += 1) {
    if (ready()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw Error(`Waited for ${what}, and it never came.`)
}
