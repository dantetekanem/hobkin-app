/**
 * The repository, read through git: what changed between two commits, the diffs, and files as a revision holds them.
 * Every answer comes from the commits, never the working tree, except `head()` and `clean()`, which are about the
 * checkout. git runs as a program of its own, never through a shell, with a time limit, and never asks anything.
 *
 * This file also holds `runProgram`, the one way this package starts a program. The scan and the proof use it too.
 */
import { spawn, type StdioOptions } from 'node:child_process'
import { accessSync, constants as files, existsSync, statSync } from 'node:fs'
import { constants } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import type { ChangedFile, ChangeMeta, Commit, FileDiff, FileStatus, Hunk, RepoReader } from './types.ts'

// ───────────────────────── Running a program ─────────────────────────

export interface RunOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
  /** How long a program has between SIGTERM and SIGKILL. */
  graceMs?: number
  /** Start it as a process group, and stop the whole group: for programs that start programs of their own. */
  group?: boolean
  signal?: AbortSignal
  /** Written to the program's stdin, which is closed after it. */
  input?: string
  /** Most bytes of stdout kept. Past it, `overflow: 'stop'` stops the program and `'tail'` keeps the last bytes. */
  maxBytes?: number
  overflow?: 'stop' | 'tail'
  /** Send stdout nowhere, for a program whose output is not needed. */
  ignoreStdout?: boolean
}

export type ProgramRun =
  | { started: false; reason: string }
  | {
      started: true
      /** The exit code. A program stopped by a signal reports 128 plus the signal's number, as a shell does. */
      code: number
      signal: NodeJS.Signals | null
      timedOut: boolean
      aborted: boolean
      /** stdout went past `maxBytes`. */
      overflow: boolean
      stdout: Buffer
      stderr: Buffer
      /** The end of stdout and stderr together, in the order they came. */
      tail: string
      /** Measured from start until its output closed, or a moment after it exited. */
      seconds: number
    }

const STDERR_BYTES = 1024 * 1024
const TAIL_BYTES = 16 * 1024
/** How long the output of a program that has exited may stay open before it is cut off from this side. */
const CLOSE_GRACE_MS = 1_000

/** Chunks of output, keeping at most `limit` bytes: the last ones. */
function keeper(limit: number) {
  const chunks: Buffer[] = []
  let kept = 0
  let seen = 0
  return {
    push(chunk: Buffer) {
      seen += chunk.length
      chunks.push(chunk)
      kept += chunk.length
      while (chunks.length > 1 && kept - chunks[0]!.length >= limit) kept -= chunks.shift()!.length
    },
    get seen() {
      return seen
    },
    buffer() {
      const all = Buffer.concat(chunks)
      return all.length > limit ? all.subarray(all.length - limit) : all
    },
  }
}

/** macOS's program for starting another at a lower priority. */
const TASKPOLICY = '/usr/sbin/taskpolicy'

/** Whether `program` is a file that can run where spawn would find it: a path from `cwd`, or a name on the PATH. */
function runnable(program: string, cwd: string, env: NodeJS.ProcessEnv): boolean {
  const places = program.includes('/') ? [program] : (env.PATH ?? '').split(delimiter).filter(Boolean).map((folder) => join(folder, program))
  return places.some((place) => {
    try {
      accessSync(resolve(cwd, place), files.X_OK)
      return statSync(resolve(cwd, place)).isFile()
    } catch {
      return false
    }
  })
}

/**
 * A group run (a test run, a scan, an agent: programs that start programs of their own) runs at utility priority on
 * macOS, as hobkin's agents do, so the window and the host keep the fast cores when every core is busy. It is the rule
 * of hobkin's `src/cli/priority.mjs`, which this package does not import. taskpolicy replaces itself with the program,
 * so its process id, its group, its signals and its pipes stay the program's own. A program that is not there starts
 * as it is, so it fails to start as before.
 */
function atUtilityPriority(program: string, args: readonly string[], { cwd, env, group }: { cwd: string; env: NodeJS.ProcessEnv; group: boolean }) {
  const asItIs = { program, args: [...args] }
  if (!group || process.platform !== 'darwin' || !existsSync(TASKPOLICY)) return asItIs
  if (!runnable(program, cwd, env)) return asItIs
  return { program: TASKPOLICY, args: ['-c', 'utility', program, ...args] }
}

/**
 * Runs a program with no shell. It is stopped with SIGTERM, then SIGKILL, when it outlives `timeoutMs` or `signal`
 * aborts. With `group`, the stop reaches everything it started, and whatever it leaves running when it exits is
 * stopped too, so nothing outlives the run. The run ends when the program has exited and its output has closed; when
 * something it started in a group of its own still holds that output a moment after the exit, the output is cut off.
 */
export function runProgram(program: string, args: readonly string[], options: RunOptions): Promise<ProgramRun> {
  const {
    cwd,
    env = process.env,
    timeoutMs,
    graceMs = 2_000,
    signal,
    input,
    maxBytes = 64 * 1024 * 1024,
    overflow = 'stop',
    ignoreStdout = false,
  } = options
  const group = options.group === true && process.platform !== 'win32'
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ started: false, reason: 'it was stopped before it started.' })
    const startedAt = performance.now()
    let child: ReturnType<typeof spawn>
    try {
      const stdio: StdioOptions = [input === undefined ? 'ignore' : 'pipe', ignoreStdout ? 'ignore' : 'pipe', 'pipe']
      const started = atUtilityPriority(program, args, { cwd, env, group })
      child = spawn(started.program, started.args, { cwd, env, detached: group, windowsHide: true, stdio })
    } catch (error) {
      return resolve({ started: false, reason: error instanceof Error ? error.message : String(error) })
    }
    const stdout = keeper(maxBytes)
    const stderr = keeper(STDERR_BYTES)
    const tail = keeper(TAIL_BYTES)
    let timedOut = false
    let aborted = false
    let overflowed = false
    let settled = false
    let killTimer: NodeJS.Timeout | undefined
    let closeTimer: NodeJS.Timeout | undefined

    const send = (name: NodeJS.Signals) => {
      try {
        if (group && child.pid) process.kill(-child.pid, name)
        else child.kill(name)
      } catch {
        // Already gone.
      }
    }
    const stop = () => {
      send('SIGTERM')
      killTimer ??= setTimeout(() => send('SIGKILL'), graceMs)
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, timeoutMs)
    const onAbort = () => {
      aborted = true
      stop()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const done = () => {
      settled = true
      clearTimeout(timer)
      clearTimeout(killTimer)
      clearTimeout(closeTimer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (code: number | null, closedBy: NodeJS.Signals | null) => {
      if (settled) return
      done()
      for (const stream of [child.stdin, child.stdout, child.stderr]) stream?.destroy()
      resolve({
        started: true,
        code: code ?? 128 + (closedBy ? (constants.signals[closedBy] ?? 0) : 0),
        signal: closedBy,
        timedOut,
        aborted,
        overflow: overflowed,
        stdout: stdout.buffer(),
        stderr: stderr.buffer(),
        tail: tail.buffer().toString('utf8'),
        seconds: Math.round(performance.now() - startedAt) / 1000,
      })
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.push(chunk)
      tail.push(chunk)
      if (overflow === 'stop' && stdout.seen > maxBytes && !overflowed) {
        overflowed = true
        stop()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.push(chunk)
      tail.push(chunk)
    })
    child.stdin?.on('error', () => {
      // The program closed its stdin before reading it all; its exit says what happened.
    })
    child.on('error', (error) => {
      if (settled || child.pid !== undefined) return
      done()
      resolve({ started: false, reason: error.message })
    })
    // What the group leaves running when its first program exits is stopped: nothing outlives the run. The output
    // closes once everything holding it lets go, which a program started in a group of its own may never do. The cut
    // waits until output already waiting has been read, even when the grace ran out while this process was busy.
    child.on('exit', (code, closedBy) => {
      clearTimeout(timer)
      if (group) send('SIGKILL')
      closeTimer = setTimeout(() => setImmediate(() => finish(code, closedBy)), CLOSE_GRACE_MS)
    })
    child.on('close', finish)
    if (input !== undefined) child.stdin?.end(input)
  })
}

// ───────────────────────── git ─────────────────────────

export const GIT_TIMEOUT_MS = 60_000
const GIT_MAX_BYTES = 512 * 1024 * 1024

/** git never prompts, never takes optional locks, and speaks the same language everywhere so its errors can be read. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', LC_ALL: 'C', LANGUAGE: '' }
/** Settings that would change git's output: quoted paths, colors, a file-system monitor that stays running. */
const GIT_CONFIG = ['-c', 'core.quotePath=false', '-c', 'color.ui=never', '-c', 'core.fsmonitor=false', '-c', 'grep.column=false']
/** Patches as written in the repository, with the usual prefixes, whatever the user's diff settings are. */
const PATCH = ['--no-color', '--no-ext-diff', '--no-textconv', '--src-prefix=a/', '--dst-prefix=b/']

export interface GitRepo extends RepoReader {
  /** The change from `base` to `head`, from metadata alone. `range` is how the change was named, `base..head` if not given. */
  meta(base: string, head: string, range?: string): Promise<ChangeMeta>
  /** The unified diffs, three lines of context, renames found. Limited to paths at either side when given. */
  diffs(base: string, head: string, paths?: readonly string[]): Promise<FileDiff[]>
  /** The best common ancestor, or null when the histories share no commit. */
  mergeBase(a: string, b: string): Promise<string | null>
  /** The commit a name points at, as a full id, or null when it names no commit. */
  resolve(ref: string): Promise<string | null>
  /** The commit checked out. */
  head(): Promise<string>
  /** No tracked file changed and, unless `untracked` is false, no untracked file either. Ignored files do not count. */
  clean(options?: { untracked?: boolean }): Promise<boolean>
  /** The repository's top folder: every path is relative to it. */
  top(): Promise<string>
}

class GitError extends Error {}

/** A revision or name handed to git is never read as an option. */
function revision(value: string): string {
  if (value.startsWith('-')) throw new GitError(`"${value}" looks like an option, not a revision.`)
  return value
}

const firstLine = (text: string) => text.trim().split('\n')[0] ?? ''

/** git at `cwd`, read-only. Commands run at the repository's top folder, so paths are repository-relative. */
export function gitRepo(cwd: string, { timeoutMs = GIT_TIMEOUT_MS }: { timeoutMs?: number } = {}): GitRepo {
  const env = { ...process.env, ...GIT_ENV }
  const run = async (folder: string, args: readonly string[], ok: readonly number[] = [0]) => {
    const result = await runProgram('git', [...GIT_CONFIG, ...args], { cwd: folder, env, timeoutMs, maxBytes: GIT_MAX_BYTES })
    if (!result.started) throw new GitError(`git could not start: ${result.reason}`)
    if (result.timedOut) throw new GitError(`git ${args[0]} took longer than ${Math.round(timeoutMs / 1000)} seconds.`)
    if (result.overflow) throw new GitError(`git ${args[0]} wrote more than ${GIT_MAX_BYTES} bytes.`)
    if (!ok.includes(result.code)) throw new GitError(firstLine(result.stderr.toString('utf8')) || `git ${args[0]} stopped with code ${result.code}.`)
    return result
  }
  let topFolder: Promise<string> | undefined
  const top = () => (topFolder ??= run(cwd, ['rev-parse', '--show-toplevel']).then((result) => result.stdout.toString('utf8').trim()))
  const git = async (args: readonly string[], ok?: readonly number[]) => run(await top(), args, ok)
  const out = async (args: readonly string[]) => (await git(args)).stdout.toString('utf8')

  const resolve = async (ref: string) => {
    const result = await git(['rev-parse', '--verify', '--quiet', `${revision(ref)}^{commit}`], [0, 1])
    return result.code === 0 ? result.stdout.toString('utf8').trim() : null
  }
  const mustResolve = async (ref: string) => {
    const sha = await resolve(ref)
    if (!sha) throw new GitError(`"${ref}" is not a commit in this repository.`)
    return sha
  }

  return {
    top,
    resolve,
    head: () => mustResolve('HEAD'),

    async mergeBase(a, b) {
      const result = await git(['merge-base', revision(a), revision(b)], [0, 1])
      return result.code === 0 ? result.stdout.toString('utf8').trim() : null
    },

    async clean({ untracked = true } = {}) {
      const status = await out(['status', '--porcelain=v1', '-z', `--untracked-files=${untracked ? 'normal' : 'no'}`])
      return status.length === 0
    },

    async text(rev, path) {
      const result = await git(['cat-file', 'blob', `${revision(rev)}:${path}`], [0, 128])
      if (result.code !== 0) {
        // A missing path, or a folder, is null; a revision that does not exist is the caller's mistake.
        await mustResolve(rev)
        return null
      }
      return isBinary(result.stdout) ? null : result.stdout.toString('utf8')
    },

    async list(rev, folder) {
      const path = folder.replace(/^\.\/+/, '').replace(/\/+$/, '')
      const listed = await out(['ls-tree', '-r', '--name-only', '-z', '--full-tree', revision(rev), ...(path && path !== '.' ? ['--', path] : [])])
      return listed.split('\0').filter(Boolean)
    },

    async grep(rev, pattern, paths) {
      if (paths && paths.length === 0) return []
      const result = await git(['grep', '-n', '-z', '-I', '-E', '--full-name', '--no-color', '-e', pattern, revision(rev), '--', ...(paths ?? [])], [0, 1])
      return result.code === 0 ? grepHits(result.stdout.toString('utf8'), `${rev}:`) : []
    },

    async meta(base, head, range) {
      const [baseSha, headSha] = await Promise.all([mustResolve(base), mustResolve(head)])
      const [numstat, status, log] = await Promise.all([
        out(['diff', '--numstat', '-M', '-z', '--no-ext-diff', '--no-textconv', baseSha, headSha]),
        out(['diff', '--name-status', '-M', '-z', '--no-ext-diff', baseSha, headSha]),
        out(['log', '-z', '--no-color', '--no-show-signature', '--encoding=UTF-8', '--reverse', '--date=short', '--format=%H%x1f%ad%x1f%an%x1f%s%x1f%b', `${baseSha}..${headSha}`]),
      ])
      const commits = commitsOf(log)
      return {
        range: range ?? `${base}..${head}`,
        base: baseSha,
        head: headSha,
        files: changedFiles(status, numstat),
        commits,
        description: { source: commits.length ? 'commits' : 'none' },
      }
    },

    async diffs(base, head, paths) {
      if (paths && paths.length === 0) return []
      const [baseSha, headSha] = await Promise.all([mustResolve(base), mustResolve(head)])
      let pathspec: string[] = []
      let wanted: Set<string> | undefined
      if (paths) {
        // A rename is found only when both of its sides are in the pathspec, so each path brings its old one along.
        wanted = new Set(paths)
        const sides = renameSides(await out(['diff', '--name-status', '-M', '-z', '--no-ext-diff', baseSha, headSha]))
        pathspec = ['--', ...new Set(paths.flatMap((path) => [path, ...(sides.get(path) ?? [])]))]
      }
      const patch = await out(['diff', ...PATCH, '-U3', '-M', baseSha, headSha, ...pathspec])
      const diffs = parsePatch(patch)
      return wanted ? diffs.filter((diff) => wanted.has(diff.path) || (diff.oldPath !== undefined && wanted.has(diff.oldPath))) : diffs
    },
  }
}

/** git's own test: a NUL byte in the first 8000 bytes makes a file binary. */
function isBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0)
}

/** `git grep -n -z` lines: `<rev>:<path>\0<line>\0<text>`. */
function grepHits(output: string, prefix: string): { path: string; line: number; text: string }[] {
  const hits: { path: string; line: number; text: string }[] = []
  for (const row of output.split('\n')) {
    const [where, line, ...text] = row.split('\0')
    if (!where || !line) continue
    hits.push({ path: where.startsWith(prefix) ? where.slice(prefix.length) : where, line: Number(line), text: text.join('\0') })
  }
  return hits
}

// ───────────────────────── Metadata ─────────────────────────

const STATUS: Record<string, FileStatus> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'copied', T: 'modified' }

interface NameStatus {
  path: string
  oldPath?: string
  status: FileStatus
  similarity?: number
}

/** `git diff --name-status -z`: `X\0path\0`, or `R090\0old\0new\0` for a rename or copy. */
function nameStatus(output: string): NameStatus[] {
  const parts = output.split('\0')
  const entries: NameStatus[] = []
  for (let at = 0; at < parts.length; ) {
    const code = parts[at++]
    if (!code) continue
    const status = STATUS[code[0]!] ?? 'modified'
    if (status === 'renamed' || status === 'copied') {
      const oldPath = parts[at++] ?? ''
      const path = parts[at++] ?? ''
      entries.push({ path, oldPath, status, similarity: Number(code.slice(1)) })
    } else {
      entries.push({ path: parts[at++] ?? '', status })
    }
  }
  return entries
}

/** For each side of a rename or copy, the path at its other side. */
function renameSides(output: string): Map<string, string[]> {
  const sides = new Map<string, string[]>()
  const pair = (one: string, other: string) => sides.set(one, [...(sides.get(one) ?? []), other])
  for (const { path, oldPath } of nameStatus(output)) {
    if (oldPath === undefined) continue
    pair(path, oldPath)
    pair(oldPath, path)
  }
  return sides
}

/** `git diff --numstat -z`: `added\tdeleted\tpath\0`, or `added\tdeleted\t\0old\0new\0`; binary files count `-`. */
function lineCounts(output: string): Map<string, { added: number; deleted: number; binary: boolean }> {
  const parts = output.split('\0')
  const counts = new Map<string, { added: number; deleted: number; binary: boolean }>()
  for (let at = 0; at < parts.length; ) {
    const entry = parts[at++]
    if (!entry) continue
    const [added = '', deleted = '', ...rest] = entry.split('\t')
    let path = rest.join('\t')
    if (path === '') {
      at += 1
      path = parts[at++] ?? ''
    }
    const binary = added === '-' && deleted === '-'
    counts.set(path, { added: binary ? 0 : Number(added), deleted: binary ? 0 : Number(deleted), binary })
  }
  return counts
}

function changedFiles(status: string, numstat: string): ChangedFile[] {
  const counts = lineCounts(numstat)
  return nameStatus(status).map(({ path, oldPath, status: fileStatus, similarity }) => {
    const { added, deleted, binary } = counts.get(path) ?? { added: 0, deleted: 0, binary: false }
    return {
      path,
      ...(oldPath !== undefined ? { oldPath } : {}),
      status: fileStatus,
      added,
      deleted,
      binary,
      ...(similarity !== undefined ? { similarity } : {}),
    }
  })
}

/** `git log -z` with fields split by the unit separator; the body is last, so it may hold anything else. */
function commitsOf(log: string): Commit[] {
  return log
    .split('\0')
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [sha = '', date = '', author = '', subject = '', ...body] = record.split('\x1f')
      const text = body.join('\x1f').trim()
      return { sha, date, author, subject, ...(text ? { body: text } : {}) }
    })
}

// ───────────────────────── Patches ─────────────────────────

/** A path as git writes it in a patch: C-quoted when it holds a tab, a newline, a quote or a backslash. */
function unquote(path: string): string {
  if (!path.startsWith('"') || !path.endsWith('"')) return path
  const bytes: number[] = []
  const escapes: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }
  const body = Buffer.from(path.slice(1, -1), 'utf8')
  for (let at = 0; at < body.length; at++) {
    const byte = body[at]!
    if (byte !== 92) {
      bytes.push(byte)
      continue
    }
    const next = String.fromCharCode(body[at + 1] ?? 0)
    if (/[0-7]/.test(next)) {
      bytes.push(parseInt(body.subarray(at + 1, at + 4).toString('latin1'), 8))
      at += 3
    } else {
      bytes.push(escapes[next] ?? body[at + 1]!)
      at += 1
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

/** The path after `--- ` or `+++ `, without its prefix; git adds a tab after a path with a space in it. */
function sidePath(rest: string, prefix: string): string | null {
  const path = unquote(rest.replace(/\t$/, ''))
  if (path === '/dev/null') return null
  return path.startsWith(prefix) ? path.slice(prefix.length) : path
}

/** `diff --git a/X b/X` names one path twice when nothing was renamed: half of what follows `a/`, less ` b/`. */
function headerPath(line: string): string | null {
  const rest = line.slice('diff --git '.length)
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1)
    return end > 0 ? sidePath(rest.slice(0, end + 1), 'a/') : null
  }
  const size = (rest.length - 5) / 2
  if (!Number.isInteger(size) || size <= 0) return null
  const path = rest.slice(2, 2 + size)
  return rest === `a/${path} b/${path}` ? path : null
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Unified diffs of `git diff`, one per file. Hunk lines are read by the counts in their header, never by their look. */
export function parsePatch(patch: string): FileDiff[] {
  const lines = patch.split('\n')
  const diffs: FileDiff[] = []
  let at = 0
  while (at < lines.length) {
    const header = lines[at]!
    if (!header.startsWith('diff --git ')) {
      at += 1
      continue
    }
    at += 1
    let oldPath: string | null = null
    let newPath: string | null = null
    let movedFrom: string | null = null
    let movedTo: string | null = null
    const hunks: Hunk[] = []
    while (at < lines.length && !lines[at]!.startsWith('diff --git ')) {
      const line = lines[at]!
      const hunk = HUNK.exec(line)
      if (hunk) {
        // A header without a count means one line.
        const parsed: Hunk = {
          oldStart: Number(hunk[1]),
          oldLines: hunk[2] === undefined ? 1 : Number(hunk[2]),
          newStart: Number(hunk[3]),
          newLines: hunk[4] === undefined ? 1 : Number(hunk[4]),
          lines: [],
        }
        at += 1
        let oldLeft = parsed.oldLines
        let newLeft = parsed.newLines
        while (at < lines.length && (oldLeft > 0 || newLeft > 0)) {
          const body = lines[at]!
          at += 1
          if (body.startsWith('\\')) continue
          // A blank line is unchanged context written without its leading space.
          const sign = body === '' ? ' ' : body[0]
          if (sign === '+') newLeft -= 1
          else if (sign === '-') oldLeft -= 1
          else {
            oldLeft -= 1
            newLeft -= 1
          }
          parsed.lines.push(body === '' ? ' ' : body)
        }
        while (at < lines.length && lines[at]!.startsWith('\\')) at += 1
        hunks.push(parsed)
        continue
      }
      if (line.startsWith('--- ')) oldPath = sidePath(line.slice(4), 'a/')
      else if (line.startsWith('+++ ')) newPath = sidePath(line.slice(4), 'b/')
      else if (line.startsWith('rename from ') || line.startsWith('copy from ')) movedFrom = unquote(line.slice(line.indexOf(' from ') + 6))
      else if (line.startsWith('rename to ') || line.startsWith('copy to ')) movedTo = unquote(line.slice(line.indexOf(' to ') + 4))
      at += 1
    }
    const path = movedTo ?? newPath ?? oldPath ?? headerPath(header)
    if (path === null) continue
    const before = movedFrom ?? (movedTo ? oldPath : null)
    diffs.push({ path, ...(before && before !== path ? { oldPath: before } : {}), hunks })
  }
  return diffs
}
