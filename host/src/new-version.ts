import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VersionStatus } from '#shared/protocol/version.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { fill, oneAgentAtATime, readPromptFile } from './review/agent-prompt.ts'

/**
 * A copy of hobkin run from its git repository, as the README installs it, hears of a newer version on GitHub, and
 * Update opens an agent that brings it up to date (`077-new-version`). A release build updates itself through the
 * shell (`src-tauri/src/updates.rs`), and its host is not a git checkout, so it never looks here.
 *
 * A new version is a higher `version` in package.json on the default branch of the copy's origin. A merge without a
 * version bump is not one. A look fetches that one branch, which changes none of the copy's files.
 */

/** Runs a program in a folder and gives what it printed. Rejects with what it said when it fails. */
export type Run = (file: string, args: readonly string[], options: { cwd: string; timeoutMs: number }) => Promise<string>

export interface NewVersionOptions {
  /** The copy's repository: the folder with its package.json and .git. */
  repo: string
  /** Only a live host looks, so tests and throwaway homes never reach the network. */
  looks: boolean
  run?: Run
  now?: () => number
}

/** The repository this host runs from. In a release build, the app's resources, which are no checkout. */
export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** How long a look that worked holds: the release build's updater looks as often. */
const LOOK_EVERY_MS = 6 * 60 * 60 * 1000
/** A look that failed, such as one made offline, is made again sooner. */
const FAILED_LOOK_MS = 30 * 60 * 1000
const GIT_MS = 60_000
/** Git never waits on a sign-in prompt that nobody sees. */
const NO_PROMPTS = {
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
}

export const runProgram: Run = (file, args, { cwd, timeoutMs }) =>
  new Promise((done, fail) => {
    const options = {
      cwd,
      env: { ...process.env, ...NO_PROMPTS },
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      encoding: 'utf8' as const,
    }
    execFile(file, [...args], options, (error, stdout, stderr) => {
      if (!error) {
        done(stdout.trim())
        return
      }
      const said = `${stdout}\n${stderr}`.trim()
      if (error.killed) {
        fail(Error(`${said}\nIt ran longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`.trim()))
        return
      }
      fail(Error(said || error.message))
    })
  })

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** How two pre-release tags order, as semver orders them: numbers as numbers, and below any word. */
function compareTags(left: string, right: string): number {
  const leftParts = left.split('.')
  const rightParts = right.split('.')
  for (let i = 0; i < Math.max(leftParts.length, rightParts.length); i++) {
    const [leftPart, rightPart] = [leftParts[i], rightParts[i]]
    // A tag that ends first, with every part before equal, comes first.
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    const leftIsNumber = /^\d+$/.test(leftPart)
    const rightIsNumber = /^\d+$/.test(rightPart)
    if (leftIsNumber && rightIsNumber && Number(leftPart) !== Number(rightPart)) return Number(leftPart) - Number(rightPart)
    if (leftIsNumber !== rightIsNumber) return leftIsNumber ? -1 : 1
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/** Whether `version` is higher than `than`, both package.json versions. Anything that is not a version is never newer. */
export function isNewer(version: string | null, than: string | null): boolean {
  const newer = version ? VERSION.exec(version.trim()) : null
  const older = than ? VERSION.exec(than.trim()) : null
  if (!newer || !older) return false

  for (const part of [1, 2, 3]) {
    const difference = Number(newer[part]) - Number(older[part])
    if (difference) return difference > 0
  }

  const [newerTag, olderTag] = [newer[4], older[4]]
  // A release is newer than its own pre-release.
  if (!newerTag || !olderTag) return !newerTag && Boolean(olderTag)
  return compareTags(newerTag, olderTag) > 0
}

/** The version a package.json names, or null when it names none. */
function versionOf(packageJson: string): string | null {
  const parsed: unknown = JSON.parse(packageJson)
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) return null
  const { version } = parsed
  return typeof version === 'string' && version.trim() ? version.trim() : null
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n').find((line) => line.trim())?.trim() ?? 'no reason given'
}

/** One look at the default branch on origin: the version it found there, or why it found none. */
type Look = { at: number; branch: string } & ({ newest: string; problem: null } | { newest: null; problem: string })

export class NewVersion {
  readonly repo: string
  private readonly looks: boolean
  private readonly run: Run
  private readonly now: () => number
  private last: Look | null = null
  private looking: Promise<Look> | null = null

  constructor({ repo, looks, run = runProgram, now = Date.now }: NewVersionOptions) {
    this.repo = repo
    this.looks = looks
    this.run = run
    this.now = now
  }

  /** This copy's version against the newest, looking again once the last look has stopped holding, or now when `fresh`. */
  async read({ fresh = false }: { fresh?: boolean } = {}): Promise<VersionStatus> {
    const current = this.current()
    const off = this.off()
    if (off) {
      return { current, newest: null, available: false, inTheWay: null, problem: off, checkedAt: null, branch: null }
    }

    const look = await this.look({ fresh })
    const available = isNewer(look.newest, current)
    return {
      current,
      newest: look.newest,
      available,
      inTheWay: available ? await this.inTheWay(look.branch) : null,
      problem: look.problem,
      checkedAt: new Date(look.at).toISOString(),
      branch: look.branch,
    }
  }

  /** Why this host never looks, or null when it does. */
  private off(): string | null {
    if (!this.looks) return 'Only a live hobkin looks for a new version.'
    if (!existsSync(join(this.repo, '.git'))) return 'This hobkin is not run from a git checkout, so it does not look here. A release build updates itself.'
    return null
  }

  private current(): string | null {
    try {
      return versionOf(readFileSync(join(this.repo, 'package.json'), 'utf8'))
    } catch {
      return null
    }
  }

  private holds(look: Look): boolean {
    const lasts = look.problem === null ? LOOK_EVERY_MS : FAILED_LOOK_MS
    return this.now() - look.at < lasts
  }

  /** The last look while it holds, unless a fresh one is asked for. Looks asked for together share one. */
  private look({ fresh }: { fresh: boolean }): Promise<Look> {
    if (!fresh && this.last && this.holds(this.last)) return Promise.resolve(this.last)
    this.looking ??= this.lookNow()
      .then((look) => {
        this.last = look
        return look
      })
      .finally(() => {
        this.looking = null
      })
    return this.looking
  }

  private async lookNow(): Promise<Look> {
    const branch = await this.defaultBranch()
    const failed = (problem: string): Look => ({ at: this.now(), branch, newest: null, problem })

    try {
      await this.git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`])
    } catch (error) {
      return failed(`The copy's origin could not be reached: ${firstLine(error)}`)
    }

    try {
      const newest = versionOf(await this.git(['show', `origin/${branch}:package.json`]))
      if (!newest) return failed(`package.json on ${branch} on origin names no version.`)
      return { at: this.now(), branch, newest, problem: null }
    } catch (error) {
      return failed(`package.json on ${branch} on origin could not be read: ${firstLine(error)}`)
    }
  }

  /** The branch origin's HEAD names, or main when the copy was never told it. */
  private async defaultBranch(): Promise<string> {
    try {
      const remoteHead = await this.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
      return remoteHead.replace(/^origin\//, '') || 'main'
    } catch {
      return 'main'
    }
  }

  /** What stands between this copy and a plain fast-forward to the branch, or null when nothing does. */
  private async inTheWay(branch: string): Promise<string | null> {
    const onBranch = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')
    if (onBranch !== branch) return `This copy is on ${onBranch || 'no branch'}, not ${branch}.`

    const changed = await this.git(['status', '--porcelain', '--untracked-files=no'])
    if (changed) return 'This copy has uncommitted changes.'

    const ahead = await this.git(['rev-list', '--count', `origin/${branch}..HEAD`])
    if (ahead !== '0') return `This copy has commits that ${branch} on origin does not have.`
    return null
  }

  private git(args: readonly string[]): Promise<string> {
    return this.run('git', args, { cwd: this.repo, timeoutMs: GIT_MS })
  }
}

export interface VersionSeat {
  versions: NewVersion
  /** The app starts this host again when it ends, so hobkin restarts into an update by itself (`code-age.ts`). */
  restarts: boolean
  /** Starts a durable hobkin in `cwd` with `text` as its first message, on the tier for ordinary coding work. */
  start: (hobkin: { cwd: string; title: string; text: string }) => Promise<{ id: string; run: string | null }>
  /** Whether that hobkin is still there: not ended. */
  exists: (hobkin: string) => Promise<boolean>
}

const template = readPromptFile(new URL('./new-version.md', import.meta.url))
const FAST_FORWARD = 'nothing of its own is in the way, so a fast-forward should do.'

/** The update agent's first message, with every place filled. */
export function updatePrompt(status: VersionStatus & { newest: string; branch: string }, { repo, restarts }: { repo: string; restarts: boolean }): string {
  return fill(template.main, {
    newest: status.newest,
    current: status.current ?? 'unknown: its package.json names no version',
    repo,
    branch: status.branch,
    state: status.inTheWay ?? FAST_FORWARD,
    restart: template.part(restarts ? 'kept' : 'not kept'),
  })
}

/**
 * `version.read`, and `version.update`, which opens one agent on the mid tier to bring the copy up to the newest
 * version. While that agent is there, Update opens it again and starts no other.
 */
export function versionHandlers({ versions, restarts, start, exists }: VersionSeat): Pick<HostHandlers, 'version.read' | 'version.update'> {
  const oneAtATime = oneAgentAtATime(exists)

  const begin = async () => {
    const status = await versions.read({ fresh: true })
    if (status.problem) throw new Unavailable(status.problem)
    if (!status.available || status.newest === null || status.branch === null) {
      throw new Unavailable(`This copy is at ${status.current ?? 'an unknown version'}, the newest on GitHub.`)
    }
    const text = updatePrompt({ ...status, newest: status.newest, branch: status.branch }, { repo: versions.repo, restarts })
    return start({ cwd: versions.repo, title: `Update hobkin to ${status.newest}`, text })
  }

  return {
    'version.read': () => versions.read(),
    'version.update': () => oneAtATime('update', begin),
  }
}
