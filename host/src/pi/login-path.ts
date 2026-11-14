import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter, dirname } from 'node:path'

/**
 * The login shell's PATH, asked again for the first-run setup (025-onboarding). The app asks the user's login shell for
 * its PATH once per run (`src-tauri/src/login_path.rs`) and starts the host with it. A Node or Pi installed while the
 * app is open can land in a folder that PATH lacks, such as one a version manager adds, so before the setup says a
 * program is missing the host asks the same way again and adds the folders it lacks to its own PATH, which everything
 * it starts inherits.
 */

/** What the shell prints around its PATH, since rc files may print other text. The same as `login_path.rs`. */
const START = '<hobkin-path>'
const END = '</hobkin-path>'
const SCRIPT = `printf '%s%s%s' '${START}' "$PATH" '${END}'`
/** The longest the setup waits for the shell. */
export const SHELL_WAIT_MS = 5000

/** Runs the shell and answers with what it printed by the time it printed the end marker, ended, or ran out of time. It never fails. */
export type ShellRun = (shell: string, args: readonly string[], timeoutMs: number) => Promise<string>

/** The PATH between the markers, or null when they are missing or the PATH between them is empty. */
export function markedPath(output: string): string | null {
  const start = output.indexOf(START)
  if (start < 0) return null
  const from = start + START.length
  const end = output.indexOf(END, from)
  if (end < 0) return null
  return output.slice(from, end) || null
}

/**
 * A PATH with more folders: the ones there keep their order, each once, then each added one it lacks. The carried
 * Node's folder (`last`), which the app puts last, stays last. A host started from a terminal runs on the user's own
 * Node, wherever it is on the PATH, and nothing already there moves.
 */
export function withFolders(path: string, added: readonly string[], last: string = dirname(process.execPath)): string {
  const kept: string[] = []
  for (const folder of path.split(delimiter)) if (folder && !kept.includes(folder)) kept.push(folder)
  const tail = kept.at(-1) === last ? kept.pop() : undefined
  for (const folder of added) if (folder && folder !== tail && !kept.includes(folder)) kept.push(folder)
  if (tail) kept.push(tail)
  return kept.join(delimiter)
}

/** Runs the shell with its stdin closed and its stderr ignored, reading what it prints as it comes. */
export const realShellRun: ShellRun = (shell, args, timeoutMs) =>
  new Promise((resolve) => {
    let output = ''
    let child: ChildProcess | null = null
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      // A process the rc files started may hold the output open, so it is let go, and an interactive shell ignores SIGTERM.
      child?.stdout?.destroy()
      if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      resolve(output)
    }
    const timer = setTimeout(finish, timeoutMs)
    try {
      child = spawn(shell, [...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      finish()
      return
    }
    child.once('error', finish)
    child.once('close', finish)
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      output += chunk
      if (markedPath(output) !== null) finish()
    })
  })

export interface AskOptions {
  shell: string
  run?: ShellRun
  timeoutMs?: number
}

/** The login shell's PATH, or null when it gave none in time. Asked as a terminal asks it, interactive and login, so `.zshrc` and version managers count. */
export async function askLoginShell({ shell, run = realShellRun, timeoutMs = SHELL_WAIT_MS }: AskOptions): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined
  // The runner keeps its own time limit too. This one holds even for a runner that never answers.
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), timeoutMs + 250)
    timer.unref?.()
  })
  try {
    return markedPath(await Promise.race([run(shell, ['-ilc', SCRIPT], timeoutMs).catch(() => ''), late]))
  } finally {
    clearTimeout(timer)
  }
}

export interface RefreshOptions {
  /** The environment whose PATH grows. The host's own when not given. */
  env?: NodeJS.ProcessEnv
  run?: ShellRun
  timeoutMs?: number
  /** The carried Node's folder, which stays last. */
  last?: string
}

/** Asks the login shell for its PATH and adds the folders the PATH lacks. True when it added any. */
export async function refreshPath({ env = process.env, run, timeoutMs, last }: RefreshOptions = {}): Promise<boolean> {
  const found = await askLoginShell({ shell: env.SHELL || '/bin/zsh', run, timeoutMs })
  if (!found) return false
  const before = env.PATH ?? ''
  const known = new Set(before.split(delimiter))
  const fresh = found.split(delimiter).filter((folder) => folder && !known.has(folder))
  if (!fresh.length) return false
  env.PATH = withFolders(before, fresh, last)
  return true
}
