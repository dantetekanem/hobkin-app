import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { scrubText } from '#shared/integrations/redact.ts'
import { SIGN_IN_CODE_MAX, type ProgramSignIn, type ProgramSignInEnd, type SignInProgram } from '#shared/protocol/setup.ts'
import { Unavailable } from '../commands.ts'
import { lastLines } from './run.ts'

/**
 * A program's own web sign-in, run for the user from the setup's review (025-onboarding), so no one needs Terminal.
 * The program owns the whole sign-in and keeps what it gets, as it does in Terminal: hobkin only starts it, shows the
 * window what it says to do, and passes along a code the user pastes. Nothing it prints is logged.
 *
 * - gh: `gh auth login --web`. Without a terminal it opens no browser and asks nothing: it prints a one-time code and
 *   GitHub's device page on stderr (`internal/authflow/flow.go` in cli/cli), then waits until the code is entered there.
 * - Claude Code: `claude auth login --claudeai`. It opens the browser itself, and prints the sign-in page on stdout for
 *   a browser that did not open. That page ends with a code, which it reads from stdin.
 */

/** How long a program may take to say what to do. */
const PROMPT_MS = 30_000
/** How long a sign-in may wait for the user. gh's code lasts 15 minutes. */
const SIGN_IN_MS = 16 * 60_000

const ESCAPES = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-9;?]*[A-Za-z]/g
/** An address in a terminal link, `ESC ] 8 ; ; <address> ST`, which a program may print around the text. */
const LINKED = /\x1b\]8;[^;\x07\x1b]*;(https:\/\/[^\x07\x1b\s]+)/
const ADDRESS = /https:\/\/[^\s"'<>]+/
const GH_CODE = /one-time code: ([A-Z0-9]{4}-[A-Z0-9]{4})\b/

interface SignInWay {
  args: string[]
  /** The pages it may send the user to, by their host and the hosts under it. */
  sites: string[]
  /** It prints what to do on stderr, not stdout. */
  onStderr: boolean
  needsCode: boolean
  pastes: boolean
}

const WAYS: Record<SignInProgram, SignInWay> = {
  gh: { args: ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'], sites: ['github.com'], onStderr: true, needsCode: true, pastes: false },
  claude: { args: ['auth', 'login', '--claudeai'], sites: ['claude.ai', 'claude.com', 'anthropic.com'], onStderr: false, needsCode: false, pastes: true },
}

const NAMES: Record<SignInProgram, string> = { gh: 'gh', claude: 'Claude Code' }

/** gh asks nothing, prints no colors and says nothing of updates. Claude Code has no switches for these. */
const QUIET: NodeJS.ProcessEnv = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' }

export interface SignInChild {
  stdout: Readable | null
  stderr: Readable | null
  stdin: Writable | null
  kill(signal?: NodeJS.Signals): boolean
  on(event: 'exit', listener: (code: number | null) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
}

export type SignInSpawn = (file: string, args: readonly string[], env: NodeJS.ProcessEnv) => SignInChild

const realSpawn: SignInSpawn = (file, args, env) => spawn(file, [...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })

/** The first page in what a program printed, from a terminal link where it printed one, if it is on one of `sites`. */
export function signInPage(printed: string, sites: readonly string[]): string | null {
  const found = LINKED.exec(printed)?.[1] ?? ADDRESS.exec(printed.replace(ESCAPES, ''))?.[0]
  if (!found) return null
  try {
    const url = new URL(found)
    const onSite = sites.some((site) => url.hostname === site || url.hostname.endsWith(`.${site}`))
    return url.protocol === 'https:' && onSite ? url.href : null
  } catch {
    return null
  }
}

/** What the user does next, once the program has printed all of it: its page, and gh's code too. Null until then. */
function promptIn(printed: string, name: SignInProgram): ProgramSignIn | null {
  const way = WAYS[name]
  const url = signInPage(printed, way.sites)
  const code = GH_CODE.exec(printed.replace(ESCAPES, ''))?.[1] ?? null
  if (!url || (way.needsCode && !code)) return null

  return {
    name,
    url,
    code: way.needsCode ? code : null,
    pastes: way.pastes,
  }
}

/** Why a sign-in ended without signing in, then the program's last lines, without the one-time code, which is spent. */
function lastWords(why: string, said: string): string {
  const lines = lastLines(said).filter((line) => !GH_CODE.test(line))
  const printed = lines.length ? `\n${lines.join('\n')}` : ''
  return scrubText(`${why}${printed}`)
}

interface Running {
  child: SignInChild
  ended: Promise<ProgramSignInEnd>
}

export interface ProgramSignInsOptions {
  /** Finds the program to run, or null when it is not installed. */
  find: (name: SignInProgram) => string | null
  spawn?: SignInSpawn
  env?: () => NodeJS.ProcessEnv
  promptMs?: number
  signInMs?: number
}

/** The sign-ins under way, one per program. Starting one again stops the one before. */
export class ProgramSignIns {
  private readonly running = new Map<SignInProgram, Running>()
  private readonly options: ProgramSignInsOptions
  private readonly spawn: SignInSpawn

  constructor(options: ProgramSignInsOptions) {
    this.options = options
    this.spawn = options.spawn ?? realSpawn
  }

  /** Starts the program's sign-in and answers with what the user does next, once the program has said it. */
  start(name: SignInProgram): Promise<ProgramSignIn> {
    const file = this.options.find(name)
    if (!file) return Promise.reject(new Unavailable(`${NAMES[name]} is not installed, so it cannot sign in. Install it first.`))
    this.stop(name)

    const way = WAYS[name]
    const child = this.spawn(file, way.args, { ...(this.options.env?.() ?? process.env), ...QUIET })
    let showPrompt: (prompt: ProgramSignIn) => void = () => {}
    let refusePrompt: (error: Error) => void = () => {}
    const prompted = new Promise<ProgramSignIn>((resolve, reject) => {
      showPrompt = resolve
      refusePrompt = reject
    })

    // Why it ended without a sign-in, unless something more particular stops it first.
    let why = `${NAMES[name]} did not sign in.`
    const stopAfter = (ms: number, words: string) =>
      setTimeout(() => {
        why = words
        child.kill('SIGTERM')
      }, ms)
    const promptMs = this.options.promptMs ?? PROMPT_MS
    const signInMs = this.options.signInMs ?? SIGN_IN_MS
    const promptTimer = stopAfter(promptMs, `${NAMES[name]} did not say how to sign in within ${Math.round(promptMs / 1000)} seconds, so it was stopped.`)
    const signInTimer = stopAfter(signInMs, `The sign-in waited ${Math.round(signInMs / 60_000)} minutes for you, so it was stopped. Press Sign in to start again.`)

    // Everything it says, for its last words, and the one stream where it says what to do.
    let said = ''
    child.stdout?.on('data', (chunk) => (said += String(chunk)))
    child.stderr?.on('data', (chunk) => (said += String(chunk)))
    let printed = ''
    const promptStream = way.onStderr ? child.stderr : child.stdout
    promptStream?.on('data', (chunk) => {
      printed += String(chunk)
      const prompt = promptIn(printed, name)
      if (!prompt) return

      clearTimeout(promptTimer)
      showPrompt(prompt)
    })

    const ended = new Promise<ProgramSignInEnd>((resolve) => {
      let over = false
      const end = (signedIn: boolean) => {
        if (over) return
        over = true
        clearTimeout(promptTimer)
        clearTimeout(signInTimer)
        if (this.running.get(name)?.child === child) this.running.delete(name)

        const message = signedIn ? null : lastWords(why, said)
        // A program that signed in before it said anything to do has nothing left for the user.
        refusePrompt(signedIn ? new Unavailable(`${NAMES[name]} is signed in.`) : Error(message ?? why))
        resolve({ signedIn, message })
      }
      child.on('exit', (code) => end(code === 0))
      child.on('error', (error) => {
        why = `${NAMES[name]} could not start its sign-in: ${error.message}`
        end(false)
      })
    })
    this.running.set(name, { child, ended })
    return prompted
  }

  /** Passes a code the user pasted to the program, which reads it as it would from Terminal. */
  paste(name: SignInProgram, code: string): void {
    const running = this.running.get(name)
    if (!running || !WAYS[name].pastes) throw new Unavailable(`No ${NAMES[name]} sign-in is waiting for a code. Press Sign in again.`)

    const line = code.trim()
    const oneLine = line !== '' && line.length <= SIGN_IN_CODE_MAX && !/[\r\n\0]/.test(line)
    if (!oneLine) throw new Unavailable('That is not a code to paste. Copy the whole code from the page, then paste it.')

    running.child.stdin?.write(`${line}\n`)
  }

  /** How the program's sign-in ended, once it has. With none under way, at once: not signed in, and nothing said. */
  wait(name: SignInProgram): Promise<ProgramSignInEnd> {
    return this.running.get(name)?.ended ?? Promise.resolve({ signedIn: false, message: null })
  }

  /** Stops a sign-in under way. */
  stop(name: SignInProgram): void {
    this.running.get(name)?.child.kill('SIGTERM')
    this.running.delete(name)
  }

  /** Stops every sign-in, as the host closes. */
  close(): void {
    for (const name of [...this.running.keys()]) this.stop(name)
  }
}
