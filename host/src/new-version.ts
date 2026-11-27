import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VersionStatus, VersionUpdated } from '#shared/protocol/version.ts'

/**
 * A copy of hobkin run from its git repository, as the README installs it, hears of a newer version on GitHub and
 * updates itself on the user's word (`077-new-version`). A release build updates itself through the shell
 * (`src-tauri/src/updates.rs`), and its host is not a git checkout, so it never looks here.
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
  /** The app starts this host again when it ends, so hobkin restarts into an update by itself (`code-age.ts`). */
  restarts: boolean
  /** What installs the copy's packages once it is at the new version. */
  install?: readonly string[]
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
const INSTALL_MS = 10 * 60_000
/** It installs `packages/hobkin` and the app from their lockfiles, as the README's setup does. */
const INSTALL = ['pnpm', 'run', 'bootstrap']
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

/** The lines an error says, without the blank ones. */
function linesOf(error: unknown): string[] {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n').filter((line) => line.trim())
}

const firstLine = (error: unknown) => linesOf(error)[0]?.trim() ?? 'no reason given'
const lastLines = (error: unknown) => linesOf(error).slice(-12).join('\n')

/** One look at the default branch on origin: the version it found there, or why it found none. */
type Look = { at: number; branch: string } & ({ newest: string; problem: null } | { newest: null; problem: string })

export class NewVersion {
  private readonly repo: string
  private readonly looks: boolean
  private readonly restarts: boolean
  private readonly install: readonly string[]
  private readonly run: Run
  private readonly now: () => number
  private last: Look | null = null
  private looking: Promise<Look> | null = null
  private updating: Promise<VersionUpdated> | null = null

  constructor({ repo, looks, restarts, install = INSTALL, run = runProgram, now = Date.now }: NewVersionOptions) {
    this.repo = repo
    this.looks = looks
    this.restarts = restarts
    this.install = install
    this.run = run
    this.now = now
  }

  /** This copy's version against the newest, looking again once the last look has stopped holding. */
  async read(): Promise<VersionStatus> {
    const current = this.current()
    const off = this.off()
    if (off) {
      return { current, newest: null, available: false, blocked: null, problem: off, checkedAt: null }
    }

    const look = await this.look({ fresh: false })
    const available = isNewer(look.newest, current)
    return {
      current,
      newest: look.newest,
      available,
      blocked: available ? await this.blocked(look.branch) : null,
      problem: look.problem,
      checkedAt: new Date(look.at).toISOString(),
    }
  }

  /** Brings this copy up to the newest version, on the user's word: a fresh look, a fast-forward, and the install. */
  update(): Promise<VersionUpdated> {
    this.updating ??= this.updateNow().finally(() => {
      this.updating = null
    })
    return this.updating
  }

  private async updateNow(): Promise<VersionUpdated> {
    const off = this.off()
    if (off) throw Error(off)
    const look = await this.look({ fresh: true })
    if (look.newest === null) throw Error(look.problem)

    const current = this.current()
    if (!isNewer(look.newest, current)) return { version: current ?? look.newest, restarts: this.restarts }
    const blocked = await this.blocked(look.branch)
    if (blocked) throw Error(blocked)

    await this.git(['merge', '--ff-only', '--quiet', `origin/${look.branch}`])
    const version = this.current() ?? look.newest
    const [program, ...args] = this.install
    try {
      await this.run(program, args, { cwd: this.repo, timeoutMs: INSTALL_MS })
    } catch (error) {
      const byHand = `Run \`${this.install.join(' ')}\` in ${this.repo}, then restart hobkin.`
      throw Error(`This copy is at ${version} now, but its packages did not install. ${byHand} The install said:\n${lastLines(error)}`)
    }
    return { version, restarts: this.restarts }
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

  /** Why Update can't fast-forward this copy to the branch, or null when it can. */
  private async blocked(branch: string): Promise<string | null> {
    const onBranch = await this.git(['symbolic-ref', '--quiet', '--short', 'HEAD']).catch(() => '')
    if (onBranch !== branch) return `Update works only on ${branch}, and this copy is on ${onBranch || 'no branch'}.`

    const changed = await this.git(['status', '--porcelain', '--untracked-files=no'])
    if (changed) return 'This copy has uncommitted changes, so Update leaves it alone.'

    const ahead = await this.git(['rev-list', '--count', `origin/${branch}..HEAD`])
    if (ahead !== '0') return `This copy has commits that ${branch} on origin does not have, so Update leaves it alone.`
    return null
  }

  private git(args: readonly string[]): Promise<string> {
    return this.run('git', args, { cwd: this.repo, timeoutMs: GIT_MS })
  }
}
