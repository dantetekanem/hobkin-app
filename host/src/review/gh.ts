/**
 * gh, GitHub's command line tool, for reviews: reading a pull request's files, and posting a review the user
 * confirmed. It runs as its own program, never through a shell, with a time limit, and with the login gh already
 * has. Nothing here asks gh for its token.
 */
import { spawn } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** How one run of gh ended. */
export type GhOutcome =
  | { kind: 'done'; stdout: string }
  | { kind: 'missing' }
  | { kind: 'timeout'; ms: number }
  | { kind: 'failed'; code: number | null; stdout: string; stderr: string }

/** Where Homebrew puts gh. An app opened from the Finder gets a PATH without them. */
export const GH_PLACES: readonly string[] = ['/opt/homebrew/bin', '/usr/local/bin']

/** The gh program to run: the first one on the PATH, then in Homebrew's folders. Null when there is none. */
export function findGh({ path = process.env.PATH ?? '', places = GH_PLACES }: { path?: string; places?: readonly string[] } = {}): string | null {
  for (const folder of [...path.split(delimiter), ...places]) {
    if (!folder) continue
    const file = join(folder, 'gh')
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return file
    } catch {
      // Not here.
    }
  }
  return null
}

/**
 * Runs gh with these arguments, and with `input` on its standard input when given. `timeoutMs` gives one slow call,
 * such as a clone, longer than the usual limit.
 */
export type GhCall = (args: readonly string[], input?: string, options?: { timeoutMs?: number }) => Promise<GhOutcome>

export const REVIEW_GH_TIMEOUT_MS = 30_000

/** gh never asks anything, never shows a spinner or colors, and never says it has an update. */
const QUIET = { GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', GH_SPINNER_DISABLED: '1', NO_COLOR: '1', CLICOLOR: '0' }
const MAX_OUTPUT = 64 * 1024 * 1024

export function spawnGh({ file, timeoutMs = REVIEW_GH_TIMEOUT_MS }: { file?: string | null; timeoutMs?: number } = {}): GhCall {
  return (args, input, options) =>
    new Promise((resolve) => {
      const program = file === undefined ? findGh() : file
      const limit = options?.timeoutMs ?? timeoutMs
      if (!program) return resolve({ kind: 'missing' })
      const child = spawn(program, [...args], { env: { ...process.env, ...QUIET }, stdio: ['pipe', 'pipe', 'pipe'] })
      const out: Buffer[] = []
      const err: Buffer[] = []
      let size = 0
      let settled = false
      const finish = (outcome: GhOutcome) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(outcome)
      }
      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        finish({ kind: 'timeout', ms: limit })
      }, limit)
      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_OUTPUT) {
          child.kill('SIGTERM')
          return finish({ kind: 'failed', code: null, stdout: '', stderr: "gh's answer was larger than expected." })
        }
        out.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk))
      child.on('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ENOENT' ? { kind: 'missing' } : { kind: 'failed', code: null, stdout: '', stderr: error.message }))
      child.on('close', (code) => {
        const stdout = Buffer.concat(out).toString('utf8')
        finish(code === 0 ? { kind: 'done', stdout } : { kind: 'failed', code, stdout, stderr: Buffer.concat(err).toString('utf8') })
      })
      child.stdin.end(input ?? '')
    })
}

/** gh's answer, or an error that says in plain words why there is none. */
export async function ghText(gh: GhCall, args: readonly string[], input?: string, options?: { timeoutMs?: number }): Promise<string> {
  const outcome = await gh(args, input, options)
  if (outcome.kind === 'done') return outcome.stdout
  if (outcome.kind === 'missing') throw new Error('gh is not installed, so GitHub cannot be read. Install it with `brew install gh`.')
  if (outcome.kind === 'timeout') throw new Error(`gh did not answer within ${Math.round(outcome.ms / 1000)} seconds.`)
  if (outcome.code === 4) throw new Error('gh is not signed in. Run `gh auth login` in Terminal.')
  const said = (outcome.stderr || outcome.stdout).replace(/gh[opsu]_[A-Za-z0-9]{20,}/g, '[token]').trim().split('\n')[0]
  throw new Error(said ? `gh said: ${said}` : 'gh failed without saying why.')
}
