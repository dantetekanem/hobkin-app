import { execFile, spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { blockPatterns, isRefusedPlace, OWN_WINDOW_REFUSAL, placeGuard, REFUSED_PLACE_MARK } from './places.ts'

/**
 * One step, or a chain of steps, run in a real Chrome through the agent-browser engine. Each step becomes one or
 * two engine commands, passed as argument arrays and never through a shell, and the answer has one shape whether one
 * step ran or twenty. A chain stops at its first failing step and keeps what the steps before it found.
 *
 * agent-browser acts on the first of several elements a name matches, without saying so. Here a name has to match
 * exactly one element: it is resolved from a snapshot of the page and the action goes by ref, so a name that matches
 * nothing, or several things, fails with the elements the agent could have meant.
 *
 * What a page says and does is not trusted. The engine's own control port is closed before a page is touched, the
 * places an agent's browser must stay off are blocked and checked for after every step, and what a page hands back
 * is cut to size.
 */

export const VERBS = [
  'open', 'read', 'click', 'fill', 'type', 'drag', 'upload', 'press', 'select', 'hover', 'scroll', 'wait',
  'back', 'forward', 'reload', 'screenshot', 'eval', 'console', 'close', 'help',
] as const
export type Verb = (typeof VERBS)[number]
export const READ_KINDS = ['elements', 'text', 'all'] as const
export type ReadKind = (typeof READ_KINDS)[number]

/** What `wait` waits for: exactly one of these. */
type WaitStep =
  | { do: 'wait'; text: string }
  | { do: 'wait'; on: string }
  | { do: 'wait'; url: string }
  | { do: 'wait'; ms: number }

/** A step once it is checked: its verb, and the fields that verb has. */
export type BrowserStep =
  | { do: 'open'; url: string }
  | { do: 'read'; what?: ReadKind; within?: string }
  | { do: 'click' | 'hover'; on: string }
  | { do: 'fill' | 'type'; on: string; text: string }
  | { do: 'drag'; on: string; to: string }
  | { do: 'upload'; on: string }
  | { do: 'press'; key: string }
  | { do: 'select'; on: string; option: string }
  | { do: 'scroll'; by?: number; to?: string }
  | WaitStep
  | { do: 'back' | 'forward' | 'reload' }
  | { do: 'screenshot'; full?: boolean }
  | { do: 'eval'; code: string }
  | { do: 'console' | 'close' }
  | { do: 'help' }

/** A step that acts on the browser, which is every step but the guide. */
type PageStep = Exclude<BrowserStep, { do: 'help' }>

/** A step whose fields have the right types, before the rules of its verb are checked. */
interface TypedStep {
  do: Verb
  url?: string
  on?: string
  text?: string
  key?: string
  option?: string
  what?: string
  within?: string
  by?: number
  to?: string
  ms?: number
  code?: string
  full?: boolean
}

export interface BrowserElement {
  ref: string
  role: string
  name: string
  value?: string
  checked?: boolean
  disabled?: boolean
  selected?: boolean
  expanded?: boolean
  href?: string
}

export type Candidate = Pick<BrowserElement, 'ref' | 'role' | 'name'>

/** What a step found. The last step's is also at the top of the result, so a one-step call reads naturally. */
export interface Found {
  elements?: BrowserElement[]
  text?: string
  /** eval's value. */
  value?: unknown
  /** The screenshot's file. */
  path?: string
  messages?: { type: string; text: string }[]
  errors?: { text: string }[]
  /** True when elements, text or messages were cut to fit. */
  truncated?: boolean
}

export interface StepResult extends Found {
  do: string
  ok: boolean
  ms: number
  /** The element the step acted on, when it has a ref. */
  ref?: string
}

/** The structured result: the JSON a script reads. */
export interface BrowserResult extends Found {
  ok: boolean
  /** Where the browser is after the call, or null when it is closed or unknown. */
  url: string | null
  title: string | null
  steps: StepResult[]
  /** `step` is the index in `steps` of the step that failed; `candidates` the elements the words could have meant. */
  error?: { step: number; do: string; message: string; candidates?: Candidate[] }
}

/** Runs the engine's binary once. A failing command still answers; only a process that could not run rejects. */
export type Exec = (
  binary: string,
  args: string[],
  options: { env?: Record<string, string | undefined>; cwd?: string; signal?: AbortSignal; input?: string; detached?: boolean },
) => Promise<{ stdout: string; stderr: string; code: number }>

export interface RunOptions {
  binary: string
  /** The caller names the session, never the model: it is what keeps one agent's browser apart from another's. */
  session: string
  exec?: Exec
  /** The only settings agent-browser is given, besides the ones this file sets. */
  env?: Record<string, string>
  /** Where screenshots are saved. */
  shotsDir: string
  signal?: AbortSignal
  /** What the `help` step answers. */
  guide?: string
  /** The places the browser must never be on, each a host and a port such as `127.0.0.1:5187`. None when not given. */
  refused?: readonly string[]
}

type Field = Exclude<keyof TypedStep, 'do'>

// What each verb needs and what else it may take. Anything outside both is a mistake worth saying.
const FIELDS: Record<Verb, { needs?: readonly Field[]; takes?: readonly Field[] }> = {
  open: { needs: ['url'] },
  read: { takes: ['what', 'within'] },
  click: { needs: ['on'] },
  fill: { needs: ['on', 'text'] },
  type: { needs: ['on', 'text'] },
  drag: { needs: ['on', 'to'] },
  upload: { needs: ['on'] },
  press: { needs: ['key'] },
  select: { needs: ['on', 'option'] },
  hover: { needs: ['on'] },
  scroll: { takes: ['by', 'to'] },
  wait: { takes: ['text', 'on', 'url', 'ms'] },
  back: {},
  forward: {},
  reload: {},
  screenshot: { takes: ['full'] },
  eval: { needs: ['code'] },
  console: {},
  close: {},
  help: {},
}
const TEXT_FIELDS: readonly string[] = ['url', 'on', 'text', 'key', 'option', 'what', 'within', 'to', 'code']
const STEP_FIELDS: readonly string[] = ['do', ...TEXT_FIELDS, 'by', 'ms', 'full']
const WAIT_KINDS = ['text', 'on', 'url', 'ms'] as const

/**
 * The model reads the `shown` amounts; a script gets the `kept` ones. Past `kept` the data is cut and the result says
 * `truncated`, so one huge page cannot fill a session.
 */
export const LIMITS = {
  steps: 50,
  shownElements: 150,
  keptElements: 2000,
  shownText: 8000,
  keptText: 200_000,
  /** How much of one element's name, value and address is kept. A page writes all three. */
  elementName: 500,
  elementValue: 500,
  elementAddress: 2000,
  /** How much one call may hand a script in all, as JSON. Past it the earliest steps lose what they found. */
  keptResult: 600_000,
  /** How much one call may hand the model in all. */
  shownResult: 40_000,
  shownMessages: 40,
  keptMessages: 500,
  messageText: 2000,
  /** How much of one console line the model reads. */
  shownMessageText: 300,
  candidates: 5,
  waitMs: 60_000,
} as const

// What a step may leave in its result, and so what the last step lifts to the top.
const PAYLOAD = ['elements', 'text', 'value', 'path', 'messages', 'errors', 'truncated'] as const

// agent-browser's own wait, 25 seconds, unless the host sets another one for the session.
const DEFAULT_TIMEOUT_MS = 25_000
const POLL_MS = 250
// Far past any page's height, so the scroll ends at the edge.
const FAR = '10000000'
/** How far `scroll` goes when the page does not say how tall its window is. */
const ONE_SCREEN_PX = 600
const FIELD_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider'])
const LIST_ROLES = new Set(['combobox', 'listbox'])

/** A step that could not do its work on the page. The chain stops there; nothing is thrown to the caller. */
class StepFailure extends Error {
  readonly candidates: Candidate[] | undefined

  constructor(message: string, candidates?: Candidate[]) {
    super(message)
    this.candidates = candidates
  }
}

/** The browser's control port could not be closed, or a refused place could not be blocked: no page step may run. */
class NotSafe extends StepFailure {
  constructor(why: string) {
    super(`The browser could not be made safe to use, so nothing was done: ${why}`)
  }
}

/** The browser is on a place it must stay off. It did not get there by `open`, which refuses such an address. */
class OnRefusedPlace extends StepFailure {
  constructor() {
    super(`${OWN_WINDOW_REFUSAL} A page sent the browser there, so it was moved to a blank page and nothing read in this call is given.`)
  }
}

const quote = (name: unknown): string => JSON.stringify(name)
const list = (names: readonly string[]): string => names.map((name) => `\`${name}\``).join(' and ')
const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

// ── Checking the input, before anything runs ────────────────────────────────────────────────────────────────

/** Puts where a step is in its chain in front of what is wrong with it. */
type Say = (problem: string) => string

/** The address `open` goes to. Only http and https, with a host and no sign-in in it, as the canvas takes them. */
export function pageUrl(address: string, refused: readonly string[] = []): string {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    throw Error(`${quote(address)} is not a web address. Write it in full, such as http://localhost:3000.`)
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw Error('The browser opens only http and https addresses, written in full, such as http://localhost:3000.')
  }
  if (!url.hostname) throw Error('That address has no host.')
  if (url.username || url.password) throw Error('The browser does not take an address with a sign-in in it.')
  if (isRefusedPlace(address, refused)) throw Error(OWN_WINDOW_REFUSAL)
  return address
}

function checkTarget(value: string, field: string, say: Say): void {
  if (!value.startsWith('css:')) return

  const selector = value.slice(4).trim()
  if (!selector) throw Error(say(`\`${field}\` has css: with no selector after it`))
  if (selector.startsWith('-')) throw Error(say(`the selector in \`${field}\` cannot start with -`))
  // The engine takes a bare number for a time to sleep, with no limit and no way to cancel it.
  if (/^\d+$/.test(selector)) throw Error(say(`\`${field}\` has css: and only digits, which is a number and not a selector`))
}

/** The fields a step was given, once they are known to be ones its verb uses. */
function checkFields(step: Record<string, unknown>, verb: Verb, say: Say): string[] {
  const { needs = [], takes = [] } = FIELDS[verb]
  const given = Object.keys(step).filter((key) => key !== 'do' && step[key] !== undefined)

  const unknown = given.filter((key) => !STEP_FIELDS.includes(key))
  if (unknown.length) throw Error(say(`unknown field ${list(unknown)}`))

  const missing = needs.filter((key) => !given.includes(key))
  if (missing.length) throw Error(say(`${verb} needs ${list(needs)}`))

  const used: readonly string[] = [...needs, ...takes]
  const unused = given.filter((key) => !used.includes(key))
  if (unused.length) throw Error(say(`${verb} does not use ${list(unused)}`))

  return given
}

function checkTypes(step: Record<string, unknown>, verb: Verb, given: readonly string[], say: Say): void {
  for (const key of given) {
    const value = step[key]

    if (TEXT_FIELDS.includes(key)) {
      if (typeof value !== 'string') throw Error(say(`\`${key}\` is text`))
      // An empty `text` is how a field is cleared; nothing else may be empty.
      const clearsField = verb === 'fill' && key === 'text'
      if (!value.trim() && !clearsField) throw Error(say(`\`${key}\` is empty`))
    } else if (key === 'full') {
      if (typeof value !== 'boolean') throw Error(say('`full` is true or false'))
    } else if (!Number.isInteger(value)) {
      throw Error(say(`\`${key}\` is a whole number`))
    }
  }
}

/** What a schema of types cannot say: what a target, an address or a wait must also be. */
function checkRules(step: TypedStep, say: Say, refused: readonly string[]): void {
  if (step.on !== undefined) checkTarget(step.on, 'on', say)
  if (step.to !== undefined) checkTarget(step.to, 'to', say)

  const kinds: readonly string[] = READ_KINDS
  if (step.what !== undefined && !kinds.includes(step.what)) throw Error(say(`\`what\` is one of ${READ_KINDS.join(', ')}`))
  if (step.within?.trim().startsWith('-')) throw Error(say('`within` is a CSS selector and cannot start with -'))

  if (step.do === 'open' && step.url !== undefined) {
    try {
      pageUrl(step.url, refused)
    } catch (error) {
      throw Error(say(error instanceof Error ? error.message : String(error)))
    }
  }

  if (step.do === 'scroll') {
    if (step.by !== undefined && step.to !== undefined) throw Error(say('scroll takes `by` or `to`, not both'))
    if (step.by === 0) throw Error(say('`by` is a number of pixels, not 0'))
  }

  if (step.do === 'wait') {
    const given = WAIT_KINDS.filter((key) => step[key] !== undefined)
    if (given.length !== 1) throw Error(say('wait needs exactly one of `text`, `on`, `url` or `ms`'))
    if (step.ms !== undefined && (step.ms < 0 || step.ms > LIMITS.waitMs)) throw Error(say(`\`ms\` is from 0 to ${LIMITS.waitMs}`))
    if (step.url?.startsWith('-')) throw Error(say('`url` is an address pattern such as **/dashboard'))
  }
}

function checkStep(given: unknown, at: string, refused: readonly string[]): BrowserStep {
  const say: Say = (problem) => `${at}${problem}`
  if (!given || typeof given !== 'object' || Array.isArray(given)) throw Error(say('a step is an object such as { do: "open", url }'))

  const step = given as Record<string, unknown>
  if (step.steps !== undefined) throw Error(say('a step cannot hold `steps` of its own'))

  const verb = VERBS.find((known) => known === step.do)
  if (!verb) throw Error(say(`\`do\` is one of ${VERBS.join(', ')}${step.do === undefined ? '' : `, not ${quote(step.do)}`}`))

  const fields = checkFields(step, verb, say)
  checkTypes(step, verb, fields, say)

  // Only the fields that were given: one left undefined is one not given, and must not read as there.
  const givenFields = Object.fromEntries(fields.map((key) => [key, step[key]]))
  // Each field is there when its verb needs it and of the right type, which is what a typed step says.
  const typed = { do: verb, ...givenFields } as TypedStep
  checkRules(typed, say, refused)
  // And now the rules of its verb hold too.
  return typed as BrowserStep
}

/**
 * The steps of an input, checked. Throws, in plain words, for anything that could not run. `refused` is the places
 * `open` does not go to.
 */
export function browserSteps(input: unknown, refused: readonly string[] = []): BrowserStep[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw Error('The browser takes one step, such as { do: "open", url }, or { steps: [...] }.')
  }

  const given = input as Record<string, unknown>
  if (given.steps === undefined) return [checkStep(given, '', refused)]

  const beside = Object.keys(given).filter((key) => key !== 'steps' && given[key] !== undefined)
  if (beside.length) throw Error(`Give one step or \`steps\`, not both: ${list(beside)} is outside \`steps\`.`)
  if (!Array.isArray(given.steps) || !given.steps.length) throw Error('`steps` is a list of at least one step.')
  if (given.steps.length > LIMITS.steps) throw Error(`\`steps\` holds at most ${LIMITS.steps} steps.`)

  const steps = given.steps.map((step, index) => checkStep(step, `steps[${index}]: `, refused))
  // The guide is something to read before working, not a step of the work.
  if (steps.length > 1 && steps.some((step) => step.do === 'help')) throw Error('`help` is asked for on its own, not among other steps.')
  return steps
}

// ── Talking to agent-browser ────────────────────────────────────────────────────────────────────────────────

/**
 * Runs a binary once. A command that fails exits 1 and still prints its JSON, so only a process that could not run
 * rejects. `detached` starts it and does not wait: it outlives a host that is stopping.
 */
export const execFileOnce: Exec = (binary, args, { env, cwd, signal, input, detached } = {}) => {
  if (detached) {
    const child = spawn(binary, args, { env, cwd, detached: true, stdio: 'ignore' })
    child.on('error', () => {})
    child.unref()
    return Promise.resolve({ stdout: '', stderr: '', code: 0 })
  }

  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { env, cwd, signal, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      // A process that ran and failed has a number for its code; one that could not run has a name, such as ENOENT.
      const code = error ? (error as NodeJS.ErrnoException).code : 0
      if (error && typeof code !== 'number') {
        reject(error)
        return
      }
      resolve({ stdout, stderr, code: typeof code === 'number' ? code : 0 })
    })
    // A process that ends before it reads its input is reported by the callback above, not here.
    child.stdin?.on('error', () => {})
    child.stdin?.end(input ?? '')
  })
}

/** What of the host's environment the engine and its Chrome need to run: where things are, who runs them, and the language. */
const HANDED_ON = ['HOME', 'PATH', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'LANG', '__CF_USER_TEXT_ENCODING']
const isHandedOn = (name: string): boolean => HANDED_ON.includes(name) || name.startsWith('LC_')

/**
 * What the engine's process is given: a short list of the host's environment, then the caller's settings. The rest
 * stays behind. The host's environment holds keys and tokens a browser has no use for, and any agent-browser setting
 * it carries, such as a profile or a browser to attach to, would put the agent in someone's own Chrome instead of its
 * clean one. Proxy settings stay behind too. The check for an outdated Chrome asks Google on every command; a tool
 * call should not.
 */
export function engineEnv(env: Record<string, string> = {}): Record<string, string | undefined> {
  const handedOn = Object.entries(process.env).filter(([name]) => isHandedOn(name))
  return {
    ...Object.fromEntries(handedOn),
    AGENT_BROWSER_NO_VERSION_CHECK: '1',
    ...env,
  }
}

/** A JSON object of the engine's, whose fields are not known until they are read. */
type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const rowOf = (value: unknown): Row => (isRow(value) ? value : {})
const rowsOf = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(isRow) : [])
const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const STALE_REF = /unknown ref|no longer loaded|stale ref|ref not found/i

/** Why a command failed, in the engine's words, with what helps the agent go on. */
function engineWords(answer: unknown): string {
  const said = rowOf(answer)
  const words = String(said.error ?? 'agent-browser failed without saying why').trim()

  // A select that found no such option says which options there are.
  const options = rowOf(said.data).options ?? rowOf(said.result).options
  if (Array.isArray(options)) {
    const names = options.map((option) => rowOf(option).label ?? rowOf(option).value)
    return `${words}: ${names.join(', ')}.`
  }

  if (STALE_REF.test(words)) return `${words}. Refs change when a new page loads: read again and use the new ref.`
  return words
}

interface Engine {
  session: string
  shotsDir: string
  timeoutMs: number
  signal: AbortSignal | undefined
  /** Whether there are places this browser is kept off. Its commands then run in its own tab, behind a guard. */
  keepsPlaces: boolean
  /** One command. Answers its data, or fails the step in agent-browser's words. */
  call(...args: string[]): Promise<Row>
  /** Several commands in one process, stopping at the first that fails. Answers each one's data. */
  batch(commands: string[][]): Promise<Row[]>
  /** Several commands in one process, each run whatever the others did. Answers each one's row: `success`, `result`, `error`. */
  each(commands: string[][]): Promise<Row[]>
}

/**
 * The commands that are not about the page the browser is on, or that take it elsewhere: they run on a refused place
 * too, which is how a browser found there is asked where it is and moved off.
 */
const NOT_ON_THE_PAGE = new Set(['open', 'close', 'stream', 'network', 'get', 'tab'])
/**
 * The browser's own tab: the first one, which is the one whose requests are blocked. A tab that a page opens has no
 * blocks, and the engine moves to it by itself, so such a tab is closed as soon as it is seen and the browser is
 * brought back to this one. (Coming back before every command would be surer, but the engine forgets every ref when
 * it is told to change tab, even to the tab it is on.)
 */
const HOME_TAB = 't1'

function engine({ binary, session, exec = execFileOnce, env, shotsDir, signal, refused = [] }: RunOptions): Engine {
  if (typeof binary !== 'string' || !binary) throw Error('The browser needs the path of the agent-browser binary.')
  if (typeof session !== 'string' || !/^[\p{L}\p{N}_-]+$/u.test(session)) throw Error('The browser needs a session name of letters, numbers, - and _.')
  const environment = engineEnv(env)

  // A page can take the browser to a refused place between two commands, by a tab it opens on a timer. So a command
  // on the page goes in one batch behind a guard that fails there: the two run a moment apart inside the engine,
  // not a process apart.
  const guardScript = placeGuard(refused)
  const guard = guardScript ? script(guardScript) : null
  const keepsPlaces = guard !== null
  const isOnThePage = (commands: string[][]): boolean => commands.some(([name = '']) => !NOT_ON_THE_PAGE.has(name))

  /** Runs commands on the page behind the guard, in one batch. Answers their rows alone. */
  async function behindGuard(guard: string[], commands: string[][]): Promise<unknown[]> {
    const rows = await ask(['batch', '--bail'], JSON.stringify([guard, ...commands]))
    if (!Array.isArray(rows)) throw new StepFailure(engineWords(rows))

    const [guarded, ...answers] = rows
    if (!rowOf(guarded).success) {
      const onRefusedPlace = String(rowOf(guarded).error ?? '').includes(REFUSED_PLACE_MARK)
      throw onRefusedPlace ? new OnRefusedPlace() : new StepFailure(engineWords(guarded))
    }
    return answers
  }

  async function ask(args: string[], input?: string): Promise<unknown> {
    signal?.throwIfAborted()
    const { stdout, stderr } = await exec(binary, ['--session', session, '--json', ...args], { env: environment, signal, input })
    try {
      return JSON.parse(stdout)
    } catch {
      const said = String(stderr || stdout).trim().slice(0, 300)
      throw new StepFailure(`agent-browser gave no answer: ${said || 'empty output'}`)
    }
  }

  return {
    session,
    shotsDir,
    timeoutMs: Number(environment.AGENT_BROWSER_DEFAULT_TIMEOUT) || DEFAULT_TIMEOUT_MS,
    signal,

    keepsPlaces,

    async call(...args) {
      if (guard && isOnThePage([args])) {
        const [answer] = await behindGuard(guard, [args])
        if (!rowOf(answer).success) throw new StepFailure(engineWords(answer))
        return rowOf(rowOf(answer).result)
      }

      const answer = rowOf(await ask(args))
      if (!answer.success) throw new StepFailure(engineWords(answer))
      return rowOf(answer.data)
    },

    async batch(commands) {
      let rows: unknown
      if (guard && isOnThePage(commands)) {
        rows = await behindGuard(guard, commands)
      } else {
        rows = await ask(['batch', '--bail'], JSON.stringify(commands))
      }
      if (!Array.isArray(rows)) throw new StepFailure(engineWords(rows))

      const failed = rows.find((row) => !rowOf(row).success)
      if (failed) throw new StepFailure(engineWords(failed))
      return rows.map((row) => rowOf(rowOf(row).result))
    },

    async each(commands) {
      const rows = await ask(['batch'], JSON.stringify(commands))
      if (!Array.isArray(rows)) throw new StepFailure(engineWords(rows))
      return rows.map(rowOf)
    },
  }
}

/**
 * Makes the session's browser safe to load a page in, and answers where it is now.
 *
 * Every session of the engine starts with a control port open on this computer, which takes commands for any session
 * from a page loaded from it: an agent's browser could be steered there and drive another agent's. So the port is
 * closed first. Closing it works once for each browser, which is how a new browser is told from one made safe
 * before, and only a new one has the refused places blocked, so the blocks are set once.
 */
async function makeSafe(browser: Engine, blocks: readonly string[]): Promise<Seen> {
  // With places to keep off, the browser is also asked which tabs a page has opened since the last call.
  const asking = browser.keepsPlaces ? [['get', 'url'], ['tab', 'list']] : [['get', 'url']]
  let rows: Row[]
  try {
    rows = await browser.each([['stream', 'disable'], ...asking])
  } catch (failure) {
    if (failure instanceof StepFailure) throw new NotSafe(failure.message)
    throw failure
  }

  const [closing, ...answers] = rows
  const isNewBrowser = closing?.success === true
  const wasClosedAlready = /not enabled/i.test(String(closing?.error ?? ''))
  if (!isNewBrowser && !wasClosedAlready) throw new NotSafe(engineWords(closing))


  if (isNewBrowser && blocks.length) {
    try {
      await browser.batch(blocks.map((pattern) => ['network', 'route', pattern, '--abort']))
    } catch (failure) {
      if (failure instanceof StepFailure) throw new NotSafe(failure.message)
      throw failure
    }
  }

  const [place, tabs] = answers
  return {
    place: { url: textOrNull(rowOf(place?.result).url), title: null },
    opened: openedTabs(rowOf(tabs?.result).tabs),
  }
}

/** Where the browser is, and the tabs a page has opened beside the browser's own. */
interface Seen {
  place: { url: string | null; title: string | null }
  opened: { tabId: string; url: string | null }[]
}

function openedTabs(tabs: unknown): Seen['opened'] {
  return rowsOf(tabs)
    .map((tab) => ({ tabId: String(tab.tabId ?? ''), url: textOrNull(tab.url) }))
    .filter(({ tabId }) => tabId && tabId !== HOME_TAB)
}

// ── Reading the page ────────────────────────────────────────────────────────────────────────────────────────

// One line of a snapshot: `- role "name" [checked=false, ref=e4, url=…]: value`. The name is JSON-escaped.
const SNAPSHOT_LINE = /^\s*- (\S+?)(?: ("(?:[^"\\]|\\.)*"))?(?: \[(.*?)\])?(?:: (.*))?$/
const REF_MARK = /(?:^|, )ref=(e\d+)(?:, |$)/
const ADDRESS_MARK = /, url=(.*?)(?:, hint=|$)/
const STATES = ['checked', 'disabled', 'selected', 'expanded'] as const

/** A page writes an element's name, value and address, so each is kept to a length. */
const cutTo = (text: string, most: number): string => (text.length > most ? `${text.slice(0, most)}…` : text)

function elementOf(line: string): BrowserElement | null {
  const [, role = '', quotedName, marks = '', value] = SNAPSHOT_LINE.exec(line) ?? []
  const ref = REF_MARK.exec(marks)
  if (!ref?.[1]) return null

  const element: BrowserElement = {
    ref: ref[1],
    role,
    name: cutTo(quotedName ? (JSON.parse(quotedName) as string) : '', LIMITS.elementName),
  }
  if (value) element.value = cutTo(value, LIMITS.elementValue)

  // The element's states come before its ref, and a link's address after it.
  const stateMarks = marks.slice(0, ref.index).split(', ')
  for (const mark of stateMarks) {
    const [name, setting = 'true'] = mark.split('=')
    const state = STATES.find((known) => known === name)
    // A half-checked box reads as not checked.
    if (state) element[state] = setting === 'true'
  }

  const address = ADDRESS_MARK.exec(marks.slice(ref.index))?.[1]
  if (address !== undefined) element.href = cutTo(address, LIMITS.elementAddress)
  return element
}

/** The elements of a snapshot that carry a ref, in page order. */
export function snapshotElements(snapshot: unknown): BrowserElement[] {
  const lines = String(snapshot ?? '').split('\n')
  return lines.map(elementOf).filter((element) => element !== null)
}

/** Whether any of an element's words were cut, which the result then says. */
function wasCut({ name, value, href }: BrowserElement): boolean {
  return name.length > LIMITS.elementName || (value?.length ?? 0) > LIMITS.elementValue || (href?.length ?? 0) > LIMITS.elementAddress
}

/** Cuts what a read found to what a script may be given, and says so. */
function capped(found: Found): Found {
  const kept: Found = { ...found }
  if (found.elements?.some(wasCut)) kept.truncated = true

  if (found.elements && found.elements.length > LIMITS.keptElements) {
    kept.elements = found.elements.slice(0, LIMITS.keptElements)
    kept.truncated = true
  }
  if (found.text !== undefined && found.text.length > LIMITS.keptText) {
    kept.text = found.text.slice(0, LIMITS.keptText)
    kept.truncated = true
  }
  return kept
}

const ALL_MATCHES_TEXT = (selector: string): string => `(() => {
  const found = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
  return found.length ? found.map(element => element.innerText ?? element.textContent ?? '').join('\\n\\n') : null;
})()`

/** The engine command that runs JavaScript in the page. Base64 carries any code as one argument. */
const script = (code: string): string[] => ['eval', '-b', Buffer.from(code, 'utf8').toString('base64')]

/** What a verb gives back: a word for its line, what it found, where it landed, and whether it closed the browser. */
interface Outcome {
  note: string
  data?: Found & { ref?: string }
  at?: { url: string | null; title: string | null }
  closed?: boolean
}

async function readText(within: string | undefined, browser: Engine): Promise<Outcome> {
  let text: string
  if (within) {
    const found = (await browser.call(...script(ALL_MATCHES_TEXT(within.trim())))).result
    if (found === null || found === undefined) throw new StepFailure(`Nothing on the page matches \`within\`: ${within}`)
    text = String(found)
  } else {
    text = String((await browser.call('read')).content ?? '')
  }

  return { note: `${text.length} characters of text`, data: capped({ text }) }
}

async function read(step: Extract<BrowserStep, { do: 'read' }>, browser: Engine): Promise<Outcome> {
  const what = step.what ?? 'elements'
  if (what === 'text') return readText(step.within, browser)

  const onlyInteractive = what === 'elements' ? ['-i'] : []
  const scope = step.within ? ['-s', step.within.trim()] : []
  const tree = String((await browser.call('snapshot', ...onlyInteractive, '-u', ...scope)).snapshot ?? '')
  const elements = snapshotElements(tree)

  if (what === 'all') {
    const lineCount = tree ? tree.split('\n').length : 0
    return { note: `the page tree, ${lineCount} lines`, data: capped({ text: tree, elements }) }
  }
  return { note: plural(elements.length, 'element'), data: capped({ elements }) }
}

// ── Finding what a step acts on ─────────────────────────────────────────────────────────────────────────────

const plain = (words: string): string => words.replace(/\s+/g, ' ').trim().toLowerCase()
const candidate = ({ ref, role, name }: Candidate): Candidate => ({ ref, role, name })
const candidateLine = ({ ref, role, name }: Candidate): string => `${ref} ${role} ${quote(name)}`

/** A target is a ref (`e12`, `@e12`), `css:` and a selector, or the words a person sees. */
type Target = { ref: string } | { css: string } | { name: string }

function targetOf(words: string): Target {
  const ref = /^@?(e\d+)$/.exec(words.trim())?.[1]
  if (ref) return { ref }
  if (words.startsWith('css:')) return { css: words.slice(4).trim() }
  return { name: words }
}

/** What a name may point at, and what to call it when it points at nothing. */
interface Kind {
  roles?: Set<string>
  one: string
  many: string
}

const FIELD: Kind = { roles: FIELD_ROLES, one: 'field', many: 'fields' }
const LIST: Kind = { roles: LIST_ROLES, one: 'list', many: 'lists' }
const ANY: Kind = { one: 'element', many: 'elements' }

/** Elements a name could mean: the exact name first, and only without one, names that contain it. */
function named(elements: BrowserElement[], name: string, kind: Kind): { pool: BrowserElement[]; found: BrowserElement[] } {
  const wanted = plain(name)
  const pool = elements.filter((element) => element.name && (!kind.roles || kind.roles.has(element.role)))

  const exact = pool.filter((element) => plain(element.name) === wanted)
  if (exact.length) return { pool, found: exact }

  const containing = pool.filter((element) => plain(element.name).includes(wanted))
  return { pool, found: containing }
}

// With no match, the elements sharing a word with the name come first, then page order.
function nearest(pool: BrowserElement[], name: string): BrowserElement[] {
  const words = new Set(plain(name).split(' '))
  const sharedWords = (element: BrowserElement) => plain(element.name).split(' ').filter((word) => words.has(word)).length
  return [...pool].sort((a, b) => sharedWords(b) - sharedWords(a)).slice(0, LIMITS.candidates)
}

function severalNamed(found: BrowserElement[], name: string, kind: Kind): StepFailure {
  const shown = found.slice(0, LIMITS.candidates)
  const more = found.length > shown.length ? `\n… and ${found.length - shown.length} more` : ''
  const message = `${found.length} ${kind.many} are named ${quote(name)}. Use the ref of the one you mean:\n${shown.map(candidateLine).join('\n')}${more}`
  return new StepFailure(message, shown.map(candidate))
}

function noneNamed(pool: BrowserElement[], name: string, kind: Kind, waited = ''): StepFailure {
  const head = `No ${kind.one} is named ${quote(name)}${waited}.`
  const shown = nearest(pool, name)
  if (!shown.length) return new StepFailure(`${head} The page has no ${kind.many} with a name.`, [])

  const more = pool.length > shown.length ? `\n… and ${pool.length - shown.length} more; read the page to see them all` : ''
  return new StepFailure(`${head} The page has:\n${shown.map(candidateLine).join('\n')}${more}`, shown.map(candidate))
}

async function interactive(browser: Engine): Promise<BrowserElement[]> {
  const { snapshot } = await browser.call('snapshot', '-i')
  return snapshotElements(snapshot)
}

/** What to pass agent-browser for a target, and how to tell the agent what was acted on. */
interface Located {
  arg: string
  ref?: string
  shown: string
}

const locatedAt = (element: BrowserElement): Located => ({ arg: `@${element.ref}`, ref: element.ref, shown: candidateLine(element) })

/** Finds the one element a target means among those of `kind`, or fails with the ones it could have meant. */
async function locate(words: string, kind: Kind, browser: Engine): Promise<Located> {
  const target = targetOf(words)
  if ('ref' in target) return { arg: `@${target.ref}`, ref: target.ref, shown: target.ref }
  if ('css' in target) return { arg: target.css, shown: `css:${target.css}` }

  const { pool, found } = named(await interactive(browser), target.name, kind)
  if (found.length > 1) throw severalNamed(found, target.name, kind)
  const [only] = found
  if (!only) throw noneNamed(pool, target.name, kind)
  return locatedAt(only)
}

/** Waits until exactly one element has the name. Several is a failure at once; none is one when time runs out. */
async function awaitNamed(name: string, browser: Engine): Promise<Located> {
  const deadline = Date.now() + browser.timeoutMs

  for (;;) {
    const { pool, found } = named(await interactive(browser), name, ANY)
    if (found.length > 1) throw severalNamed(found, name, ANY)
    const [only] = found
    if (only) return locatedAt(only)

    const noTimeForAnotherLook = Date.now() + POLL_MS > deadline
    if (noTimeForAnotherLook) throw noneNamed(pool, name, ANY, ` after ${browser.timeoutMs}ms`)
    await pause(POLL_MS, undefined, { signal: browser.signal })
  }
}

// ── The verbs ───────────────────────────────────────────────────────────────────────────────────────────────

const acted = (at: Located): Outcome => ({ note: at.shown, ...(at.ref ? { data: { ref: at.ref } } : {}) })
// What the console holds piles up from page to page, so each time the agent loads a page it starts empty.
const FRESH_CONSOLE = [['console', '--clear'], ['errors', '--clear']]
const titled = ({ title, url }: { title: string | null; url: string | null }): string => `${quote(title ?? '')} ${url ?? ''}`.trim()

async function open(url: string, browser: Engine): Promise<Outcome> {
  const answers = await browser.batch([...FRESH_CONSOLE, ['open', '--', url]])
  const page = answers.at(-1) ?? {}
  const at = { url: textOrNull(page.url), title: textOrNull(page.title) }
  return { note: titled(at), at }
}

async function history(verb: 'back' | 'forward' | 'reload', browser: Engine): Promise<Outcome> {
  const answers = await browser.batch([...FRESH_CONSOLE, [verb]])
  const moved = answers.at(-1) ?? {}
  return { note: String(moved.url ?? 'done') }
}

async function actOn(verb: 'click' | 'hover', on: string, browser: Engine): Promise<Outcome> {
  const at = await locate(on, ANY, browser)
  await browser.call(verb, at.arg)
  return acted(at)
}

async function fill(on: string, text: string, browser: Engine): Promise<Outcome> {
  const at = await locate(on, FIELD, browser)
  await browser.call('fill', at.arg, '--', text)
  return acted(at)
}

async function select(on: string, option: string, browser: Engine): Promise<Outcome> {
  const at = await locate(on, LIST, browser)
  await browser.call('select', at.arg, '--', option)
  return { ...acted(at), note: `${quote(option)} in ${at.shown}` }
}

async function press(key: string, browser: Engine): Promise<Outcome> {
  await browser.call('press', '--', key)
  return { note: key }
}

async function waitUntil(step: WaitStep, browser: Engine): Promise<Outcome> {
  if ('ms' in step) {
    // Kept here: agent-browser's own delay goes on after a cancelled call and holds up the next one.
    await pause(step.ms, undefined, { signal: browser.signal })
    return { note: `${step.ms}ms` }
  }

  if ('url' in step) {
    const reached = await browser.call('wait', '--url', step.url)
    return { note: String(reached.url ?? step.url) }
  }

  if ('text' in step) {
    // agent-browser would read text that starts with a dash as one of its own options.
    const textIsInPage = `document.body.innerText.includes(${JSON.stringify(step.text)})`
    const condition = step.text.startsWith('-') ? ['--fn', textIsInPage] : ['--text', step.text]
    await browser.call('wait', ...condition)
    return { note: `text ${quote(step.text)}` }
  }

  const target = targetOf(step.on)
  if ('name' in target) return acted(await awaitNamed(target.name, browser))

  const at = await locate(step.on, ANY, browser)
  await browser.call('wait', at.arg)
  return acted(at)
}

/** What a wait was waiting for, in words. */
function awaited(step: WaitStep): string {
  if ('text' in step) return `text ${quote(step.text)}`
  if ('url' in step) return `address ${step.url}`
  if ('on' in step) return step.on
  return `${step.ms}ms`
}

async function wait(step: WaitStep, browser: Engine): Promise<Outcome> {
  try {
    return await waitUntil(step, browser)
  } catch (failure) {
    // "Wait timed out after 25000ms" does not say for what.
    const timedOut = failure instanceof StepFailure && /timed out/i.test(failure.message)
    if (timedOut) throw new StepFailure(`${failure.message}: ${awaited(step)} never showed.`)
    throw failure
  }
}

async function scroll(step: Extract<BrowserStep, { do: 'scroll' }>, browser: Engine): Promise<Outcome> {
  if (step.to === 'top' || step.to === 'bottom') {
    await browser.call('scroll', step.to === 'top' ? 'up' : 'down', FAR)
    return { note: step.to }
  }

  if (step.to !== undefined) {
    const at = await locate(step.to, ANY, browser)
    await browser.call('scrollintoview', at.arg)
    return acted(at)
  }

  const pixels = step.by ?? (await oneScreen(browser))
  const direction = pixels < 0 ? 'up' : 'down'
  await browser.call('scroll', direction, String(Math.abs(pixels)))
  return { note: `${direction} ${Math.abs(pixels)}px` }
}

/** The height of the page's window, which is how far a scroll with nothing said goes. */
async function oneScreen(browser: Engine): Promise<number> {
  const { result } = await browser.call(...script('window.innerHeight'))
  return Math.round(Number(result)) || ONE_SCREEN_PX
}

async function screenshot(full: boolean | undefined, browser: Engine): Promise<Outcome> {
  mkdirSync(browser.shotsDir, { recursive: true })
  const file = join(browser.shotsDir, `${browser.session}-${Date.now()}.png`)

  const wholePage = full ? ['--full'] : []
  const saved = await browser.call('screenshot', ...wholePage, '--', file)
  const path = String(saved.path ?? file)
  return { note: path, data: { path } }
}

async function evaluate(code: string, browser: Engine): Promise<Outcome> {
  const { result } = await browser.call(...script(code))
  // A value JSON cannot hold, such as undefined, comes back as null.
  const value: unknown = result ?? null

  // The page decides how large its value is. One too large becomes a line that is still JSON and says what happened.
  const size = JSON.stringify(value).length
  if (size > LIMITS.keptText) {
    const cut = `[cut: the value was ${size} characters of JSON, more than the ${LIMITS.keptText} that are kept. Return less from the page.]`
    return { note: 'a value, cut', data: { value: cut, truncated: true } }
  }
  return { note: 'a value', data: { value } }
}

async function consoleReport(browser: Engine): Promise<Outcome> {
  const [logged, thrown] = await browser.batch([['console'], ['errors']])
  const messages = rowsOf(logged?.messages).map(({ type, text }) => ({ type: String(type ?? 'log'), text: String(text ?? '') }))
  const errors = rowsOf(thrown?.errors).map(({ text }) => ({ text: String(text ?? '') }))

  const latest = <Entry extends { text: string }>(entries: Entry[]): Entry[] =>
    entries.slice(-LIMITS.keptMessages).map((entry) => ({ ...entry, text: entry.text.slice(0, LIMITS.messageText) }))
  const data: Found = { messages: latest(messages), errors: latest(errors) }

  const tooMany = messages.length > LIMITS.keptMessages || errors.length > LIMITS.keptMessages
  const tooLong = [...messages, ...errors].some((entry) => entry.text.length > LIMITS.messageText)
  if (tooMany || tooLong) data.truncated = true

  return { note: `${plural(messages.length, 'message')}, ${plural(errors.length, 'error')}`, data }
}

async function close(browser: Engine): Promise<Outcome> {
  await browser.call('close')
  return { note: 'closed', closed: true }
}

function runStep(step: PageStep, browser: Engine): Promise<Outcome> {
  switch (step.do) {
    case 'open':
      return open(step.url, browser)
    case 'read':
      return read(step, browser)
    case 'click':
    case 'hover':
      return actOn(step.do, step.on, browser)
    case 'drag':
    case 'type':
    case 'upload':
      throw Error(`${step.do} requires target: "canvas".`)
    case 'fill':
      return fill(step.on, step.text, browser)
    case 'press':
      return press(step.key, browser)
    case 'select':
      return select(step.on, step.option, browser)
    case 'scroll':
      return scroll(step, browser)
    case 'wait':
      return wait(step, browser)
    case 'back':
    case 'forward':
    case 'reload':
      return history(step.do, browser)
    case 'screenshot':
      return screenshot(step.full, browser)
    case 'eval':
      return evaluate(step.code, browser)
    case 'console':
      return consoleReport(browser)
    case 'close':
      return close(browser)
  }
}

// ── What the model reads ────────────────────────────────────────────────────────────────────────────────────

const clip = (text: string, most: number): string => (text.length > most ? `${text.slice(0, most)}…` : text)
const NARROW_IT = 'Narrow it with `within`, a CSS selector.'

function elementLine(element: BrowserElement): string {
  // A box that is not checked is worth a word; a list that is not open is not.
  const worthSaying = STATES.filter((state) => element[state] || (state === 'checked' && element.checked === false))
  const marks = worthSaying.map((state) => (element[state] ? state : `not ${state}`))

  const value = element.value ? ` = ${quote(element.value)}` : ''
  const states = marks.length ? ` [${marks.join(', ')}]` : ''
  return `${candidateLine(element)}${value}${states}`
}

function textLines(text: string, cutAlready: boolean): string[] {
  if (text.length <= LIMITS.shownText) return [text]

  const moreStill = cutAlready ? ' (the page has more still)' : ''
  return [text.slice(0, LIMITS.shownText), `… the first ${LIMITS.shownText} of ${text.length} characters${moreStill}. ${NARROW_IT}`]
}

function elementLines(elements: BrowserElement[], cutAlready: boolean): string[] {
  const lines = elements.slice(0, LIMITS.shownElements).map(elementLine)
  const hidden = elements.length - lines.length
  if (hidden <= 0) return lines

  return [...lines, `… ${hidden}${cutAlready ? ' or more' : ''} more elements. ${NARROW_IT}`]
}

function consoleLines({ messages = [], errors = [] }: Found): string[] {
  const logged = messages.map(({ type, text }) => `${type}: ${text}`)
  const thrown = errors.map(({ text }) => `page error: ${text}`)
  const lines = [...logged, ...thrown].map((line) => clip(line, LIMITS.shownMessageText))

  const hidden = lines.length - LIMITS.shownMessages
  if (hidden <= 0) return lines
  return [`… ${hidden} earlier ones left out`, ...lines.slice(-LIMITS.shownMessages)]
}

/** The lines under a step's own line: what it found, cut to what the model should read. */
function foundLines(step: PageStep, found: Found): string[] {
  const cutAlready = found.truncated === true

  if (step.do === 'read') {
    const readElements = (step.what ?? 'elements') === 'elements'
    return readElements ? elementLines(found.elements ?? [], cutAlready) : textLines(found.text ?? '', cutAlready)
  }
  if (step.do === 'eval') return [clip(JSON.stringify(found.value) ?? 'null', LIMITS.shownText)]
  if (step.do === 'console') return consoleLines(found)
  return []
}

// ── Running a call ──────────────────────────────────────────────────────────────────────────────────────────

/** What a place is called when nothing is known of it: after a close, a cancelled call, or a browser that cannot say. */
const NOWHERE = { url: null, title: null }

/** Where the browser is now, and what a page opened. A browser that cannot say is no reason to fail a call that worked. */
async function whereabouts(browser: Engine): Promise<Seen> {
  try {
    const asking = [['get', 'url'], ['get', 'title']]
    if (browser.keepsPlaces) asking.push(['tab', 'list'])

    const [place, page, tabs] = await browser.batch(asking)
    return { place: { url: textOrNull(place?.url), title: textOrNull(page?.title) }, opened: openedTabs(tabs?.tabs) }
  } catch {
    return { place: NOWHERE, opened: [] }
  }
}

/**
 * Deals with the tabs a page opened, and answers where the browser is after that. Such a tab has no request blocks,
 * so nothing is read or done in it: it is closed, and the page it was on is opened in the browser's own tab instead,
 * as if the link had opened there. One that was on a refused place is not followed: that fails the step.
 */
async function followOpenedTabs(seen: Seen, browser: Engine, refused: readonly string[]): Promise<Seen['place']> {
  const latest = seen.opened.at(-1)
  if (!latest) return seen.place

  // Closed, and the browser brought back to its own tab, which is where its blocks are.
  await browser.batch([...seen.opened.map(({ tabId }) => ['tab', 'close', tabId]), ['tab', HOME_TAB]])
  if (isRefusedPlace(latest.url, refused)) throw new OnRefusedPlace()

  let address: string
  try {
    address = pageUrl(latest.url ?? '', refused)
  } catch {
    // A tab with nothing a browser can open, such as a blank one a script was still writing.
    return seen.place
  }
  const followed = await open(address, browser)
  return followed.at ?? seen.place
}

/** The guide as an answer: it is the one step that needs no browser. */
export function guideAnswer(guide: string): { result: BrowserResult; text: string } {
  const step: StepResult = { do: 'help', ok: true, ms: 0, text: guide }
  return { result: { ok: true, ...NOWHERE, steps: [step], text: guide }, text: guide }
}

/** How a failure starts when it was not the page's or agent-browser's word, such as a binary that is not there. */
const COULD_NOT_RUN = 'The browser could not run:'

/** Why a step did not do its work, as the agent is told. */
function failureWords(failure: unknown, cancelled: boolean): string {
  if (cancelled) return 'Cancelled before it finished.'
  // Only what the page or agent-browser said is passed on as is; a fault of this file's own keeps its name.
  if (failure instanceof StepFailure) return failure.message
  return `${COULD_NOT_RUN} ${failure instanceof Error ? failure.message : String(failure)}`
}

/** Whether a call failed because the engine itself could not be run. */
export const couldNotRun = (result: BrowserResult): boolean => result.error?.message.startsWith(COULD_NOT_RUN) === true

/** Says where a chain stopped and how much of it never ran. */
function stoppedLine(index: number, total: number): string {
  const left = total - index - 1
  const notRun = left === 0 ? '' : `; the ${left === 1 ? 'step' : `${left} steps`} after it did not run`
  return `Stopped at step ${index + 1} of ${total}${notRun}.`
}

/** A blank page: where a browser is moved to when it is found on a place it must stay off. */
const BLANK_PAGE = { url: 'about:blank', title: null }

/** Moves the browser to a blank page. One that will not go is closed: it must not stay where it is. */
async function moveToBlankPage(browser: Engine): Promise<void> {
  try {
    await browser.call('open', '--', BLANK_PAGE.url)
  } catch {
    await browser.call('close').catch(() => {})
  }
}

/** What a step's part of the answer weighs, as the JSON a script is handed. */
const weightOf = (step: StepResult): number => PAYLOAD.reduce((total, key) => total + (JSON.stringify(step[key])?.length ?? 0), 0)

function forget(step: StepResult): void {
  for (const key of PAYLOAD) delete step[key]
  delete step.ref
}

/**
 * Keeps a whole call within what one answer may hold. Each step is within its own limits already, but a chain of
 * many is not. The last steps are what a chain is for, so they are kept, and earlier ones lose what they found.
 * Answers whether anything was dropped.
 */
function boundWhole(steps: StepResult[]): boolean {
  let room: number = LIMITS.keptResult
  let dropped = false

  const last = steps.at(-1)
  for (const step of steps.toReversed()) {
    // What the last step found is in the result twice: in its step, and at the top.
    const weight = weightOf(step) * (step === last ? 2 : 1)
    if (weight <= room) {
      room -= weight
      continue
    }
    forget(step)
    step.truncated = true
    dropped = true
    // Once a step does not fit, nothing before it is kept either: a result with holes in the middle misleads.
    room = 0
  }
  return dropped
}

/** One step's part of what the model reads: its own line, then what it found. */
interface Said {
  line: string
  found: string[]
}

/** The same bound for the model: the last steps' findings are shown, and earlier ones say they were left out. */
function shownLines(said: Said[]): string[] {
  let room: number = LIMITS.shownResult
  const blocks: string[][] = []

  for (const { line, found } of said.toReversed()) {
    const size = found.reduce((total, text) => total + text.length, 0)
    if (size <= room) {
      room -= size
      blocks.push([line, ...found])
    } else {
      room = 0
      blocks.push([line, '… left out: this call read more than one answer holds. Read less in one call.'])
    }
  }
  return blocks.toReversed().flat()
}

/**
 * Runs one step or a chain and answers `{ result, text }`: `result` is the structured value a script reads and
 * `text` is the compact account the model reads. `result.ok` is false when a step failed.
 *
 * Throws only for input that could not run (an unknown verb, a missing field, an address `open` does not take) and
 * for a missing `binary` or `session`, before anything runs. A step that fails on the page, a cancelled call and an
 * engine that will not start all come back as a result, with the steps that did run.
 *
 * Before its first page step the browser is made safe (`makeSafe`), and after every step it is asked where it is.
 * Found on a refused place, it is moved to a blank page, the step fails, the chain stops, and nothing read in the
 * call is given: there is no telling since when the page was there.
 */
export async function runBrowser(input: unknown, options: RunOptions): Promise<{ result: BrowserResult; text: string }> {
  const refused = options.refused ?? []
  const steps = browserSteps(input, refused)
  // `help` is never among other steps, so a chain that starts with it is the guide alone.
  if (steps[0]?.do === 'help') return guideAnswer(options.guide ?? 'There is no guide here.')

  const pageSteps = steps.filter((step) => step.do !== 'help')
  const browser = engine(options)
  const { signal } = options
  const blocks = blockPatterns(refused)

  const done: StepResult[] = []
  let said: Said[] = []
  let error: BrowserResult['error']
  /** Where the browser is after the last step that worked. */
  let place: Outcome['at']
  /** Whether a line of the answer already says where the browser is, or there is nowhere worth saying. */
  let placeSaid = false
  /** Whether this call has made its browser safe. A close ends that browser, and the next step starts another. */
  let madeSafe = false
  let closed = false

  /** The call ends here: the browser was found on a refused place, at `index`. */
  async function leaveRefusedPlace(index: number, step: PageStep): Promise<void> {
    const { message } = new OnRefusedPlace()
    await moveToBlankPage(browser)

    for (const earlier of done) forget(earlier)
    error = { step: index, do: step.do, message }
    said = [{ line: `${step.do} failed: ${message}`, found: pageSteps.length > 1 ? [stoppedLine(index, pageSteps.length)] : [] }]
    place = BLANK_PAGE
    placeSaid = true
  }

  for (const [index, step] of pageSteps.entries()) {
    const started = performance.now()
    const elapsedMs = () => Math.round(performance.now() - started)

    try {
      if (step.do !== 'close' && !madeSafe) {
        const startsOn = await followOpenedTabs(await makeSafe(browser, blocks), browser, refused)
        madeSafe = true
        if (isRefusedPlace(startsOn.url, refused)) throw new OnRefusedPlace()
      }

      const outcome = await runStep(step, browser)
      closed = outcome.closed === true
      if (closed) {
        madeSafe = false
        place = undefined
      } else {
        if (outcome.at && isRefusedPlace(outcome.at.url, refused)) throw new OnRefusedPlace()
        // Every step is followed by asking where the browser is and what the page opened. One that says where it
        // landed is taken at its word when nothing is refused, and so nothing needs a second look.
        const seen = outcome.at && !browser.keepsPlaces ? { place: outcome.at, opened: [] } : await whereabouts(browser)
        // A tab the page opened may have been in front while this step ran, and such a tab has no blocks: what the
        // step found may be from it, so it is not given.
        if (seen.opened.length && outcome.data && PAYLOAD.some((key) => outcome.data?.[key] !== undefined)) {
          outcome.data = {}
          outcome.note = 'not given: a tab the page opened was in front and was closed. Read again.'
        }

        const landed = await followOpenedTabs(seen, browser, refused)
        place = outcome.at && landed.url === null ? outcome.at : landed
        if (isRefusedPlace(place.url, refused)) throw new OnRefusedPlace()
      }
      placeSaid = outcome.at !== undefined

      const found = outcome.data ?? {}
      done.push({ do: step.do, ok: true, ms: elapsedMs(), ...found })
      said.push({ line: `${step.do} → ${outcome.note}`, found: foundLines(step, found) })
    } catch (failure) {
      const cancelled = signal?.aborted === true
      done.push({ do: step.do, ok: false, ms: elapsedMs() })

      if (failure instanceof OnRefusedPlace && !cancelled) {
        await leaveRefusedPlace(index, step)
        break
      }

      const message = failureWords(failure, cancelled)
      const candidates = failure instanceof StepFailure && !cancelled ? failure.candidates : undefined
      error = { step: index, do: step.do, message, ...(candidates ? { candidates } : {}) }
      said.push({ line: `${step.do} failed: ${message}`, found: pageSteps.length > 1 ? [stoppedLine(index, pageSteps.length)] : [] })
      place = undefined
      placeSaid = false

      if (failure instanceof NotSafe && !cancelled) {
        // A browser that is not safe is not left running.
        await browser.call('close').catch(() => {})
        closed = true
      }
      break
    }
  }

  // The last step that worked left where the browser is. After a step that failed it is asked, and checked like any other.
  const nobodyToAsk = closed || signal?.aborted === true
  if (!nobodyToAsk && !place) {
    const failedAt = done.length - 1
    const failedStep = pageSteps[failedAt]
    try {
      place = await followOpenedTabs(await whereabouts(browser), browser, refused)
      if (isRefusedPlace(place.url, refused)) throw new OnRefusedPlace()
    } catch (failure) {
      if (!(failure instanceof OnRefusedPlace) || !failedStep) place = NOWHERE
      else await leaveRefusedPlace(failedAt, failedStep)
    }
  }
  const where = nobodyToAsk || !place ? NOWHERE : place

  const dropped = boundWhole(done)
  const lines = shownLines(said)
  if (!placeSaid && where.url) lines.push(`now at ${titled(where)}`)

  const result: BrowserResult = { ok: !error, url: where.url, title: where.title, steps: done }
  const last = done.at(-1)
  for (const key of PAYLOAD) {
    if (last?.[key] !== undefined) Object.assign(result, { [key]: last[key] })
  }
  if (dropped) result.truncated = true
  if (error) result.error = error

  return { result, text: lines.join('\n') }
}
