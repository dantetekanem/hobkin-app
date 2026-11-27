import { execFile } from 'node:child_process'
import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { ClaudeCodeStatus } from '#shared/protocol/claude-code.ts'

/** The places Claude Code installs itself, for a host that launchd started with a short PATH. */
const PLACES = (home: string): string[] => [join(home, '.local', 'bin'), join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']

export interface FindClaudeOptions {
  path?: string
  home?: string
  /** Replaces the places after the PATH. */
  places?: readonly string[]
}

/** The claude program to run: the first one on the PATH, then where Claude Code installs itself. Looked up on every call. */
export function findClaude({ path = process.env.PATH ?? '', home = homedir(), places }: FindClaudeOptions = {}): string | null {
  for (const folder of [...path.split(delimiter), ...(places ?? PLACES(home))]) {
    if (!folder) continue
    const file = join(folder, 'claude')
    try {
      accessSync(file, constants.X_OK)
      if (statSync(file).isFile()) return file
    } catch {
      // Not here.
    }
  }
  return null
}

export type ClaudeRun = (
  file: string,
  args: readonly string[],
  options: { timeout: number; maxBuffer: number; encoding: 'utf8' },
  done: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown

const run: ClaudeRun = (file, args, options, done) => execFile(file, [...args], options, done)

export interface ClaudeStatusOptions {
  find?: () => string | null
  run?: ClaudeRun
  timeoutMs?: number
}

/**
 * Stdout of the program, or null when it failed with nothing printed or timed out. `auth status` exits 1 when not
 * signed in, and still prints its answer.
 */
function output(execute: ClaudeRun, file: string, args: string[], timeout: number): Promise<string | null> {
  const answered = (error: Error | null, stdout: string) => !error || (typeof (error as { code?: unknown }).code === 'number' && Boolean(stdout?.trim()))
  return new Promise((resolve) => {
    try {
      execute(file, args, { timeout, maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => resolve(answered(error, stdout) ? stdout : null))
    } catch {
      resolve(null)
    }
  })
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null)

/** Whether Claude Code is installed and signed in. Only the version, the sign-in, how and the plan; never who. */
export async function claudeStatus({ find = findClaude, run: execute = run, timeoutMs = 5000 }: ClaudeStatusOptions = {}): Promise<ClaudeCodeStatus> {
  const file = find()
  if (!file) return { installed: false, version: null, signedIn: null, authMethod: null, plan: null }

  const [versionText, authText] = await Promise.all([
    output(execute, file, ['--version'], timeoutMs),
    output(execute, file, ['auth', 'status', '--json'], timeoutMs),
  ])
  const version = versionText?.match(/\d+\.\d+\.\d+\S*/)?.[0] ?? null
  let auth: Record<string, unknown> | null = null
  try {
    const parsed: unknown = authText === null ? null : JSON.parse(authText)
    auth = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    // Unreadable: it says nothing about the sign-in.
  }
  const signedIn = typeof auth?.loggedIn === 'boolean' ? auth.loggedIn : null
  return {
    installed: true,
    version,
    signedIn,
    authMethod: signedIn ? text(auth?.authMethod) : null,
    plan: signedIn ? (text(auth?.subscriptionType) ?? text(auth?.planTier)) : null,
  }
}
