import { execFile } from 'node:child_process'
import { readItems, readProjects, paths, updateItem } from 'hobkin/src/cli/work/store.mjs'
import { closeMergedPull, type SurveyPull } from 'hobkin/src/cli/work/unmerged.mjs'
import type { GhCall } from './review/gh.ts'
import { ghText } from './review/gh.ts'

/**
 * A pull request that merged or closed outside the app leaves what the window shows within about a minute. hobkin's
 * own survey runs every half hour, so this asks GitHub on the GitHub page's cadence, one call for each repository,
 * for the pull requests of the finished changes that wait on one (by the address the item names, or by its branch),
 * and of the reviewed pull requests. A merged one is closed by hobkin's own `closeMergedPull`, the path a merge from
 * a card takes. One closed without merging goes where the survey sends it: its branch stays the record.
 * It only reads GitHub, never twice a minute for one repository, and a failed read is logged and tried again.
 */

const FIELDS = 'number,title,url,state,createdAt,mergedAt,mergeCommit,additions,deletions,changedFiles,headRefName'
/** The most pull requests asked for in one repository, the number hobkin's survey asks for too. */
const MOST_PULLS = 200
/** How often it asks again, as often as the GitHub page reads. */
export const MERGED_PULLS_EVERY_MS = 60_000
/** Items whose work is finished and still on its branch (`finishedOnBranch` in hobkin's `unmerged.mjs`). */
const FINISHED = ['pr', 'branch']

export interface ReviewedPull {
  owner: string
  repo: string
  number: number
  /** A pull request on a code host other than GitHub is never asked of GitHub. */
  host?: string
}

export interface MergedPullsOptions {
  /** hobkin's data folder. Throws while hobkin is not open in this host. */
  data: () => string
  gh: GhCall
  /** The pull requests that still have a review standing, to see which are no longer open. */
  reviewed: () => ReviewedPull[]
  /** A reviewed pull request is no longer open: its review leaves the lists. */
  retire: (pull: ReviewedPull) => void
  /** A pull request merged or closed, by its address, so the GitHub page drops it now. */
  closed: (pull: { repo: string; number: number; url: string }) => void
  /** Something changed in hobkin's records: hobkin's state is read again and published. */
  changed: () => Promise<unknown> | void
  /** The repository a folder's `origin` names, as `owner/name`. Git is asked when not given. */
  repoOf?: (folder: string) => Promise<string | null>
  /** Whether anyone is looking. While nobody is, GitHub is left alone. Always, when not given. */
  wanted?: () => boolean
  everyMs?: number
  now?: () => number
  log?: (line: string) => void
}

/** `owner/name` from a GitHub remote address, in any of its shapes. */
export function githubRepoOf(remote: string): string | null {
  const found = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(remote.trim())
  return found ? `${found[1]}/${found[2]}`.toLowerCase() : null
}

function originRepo(folder: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', folder, 'remote', 'get-url', 'origin'], { timeout: 10_000 }, (error, stdout) => resolve(error ? null : githubRepoOf(stdout)))
  })
}

type Item = { id: string; state: string; pr?: unknown; branch?: unknown; [key: string]: unknown }

/**
 * The pull request that speaks for an item, as hobkin's survey picks it (`pullOf` in `unmerged.mjs`): the one the item
 * names when it merged, else an open one on its branch, else a merged one there, else the one it names, else a closed one.
 */
export function pullOf(item: Item, pulls: SurveyPull[]): SurveyPull | undefined {
  const own = typeof item.pr === 'string' ? pulls.find((pull) => pull.url === item.pr) : undefined
  if (own?.state === 'MERGED') return own
  const heads = [item.branch, own?.headRefName].filter((head): head is string => typeof head === 'string' && head !== '')
  const inState = (state: string) => pulls.find((pull) => pull.state === state && pull.headRefName != null && heads.includes(pull.headRefName))
  return inState('OPEN') ?? inState('MERGED') ?? own ?? inState('CLOSED')
}

export class MergedPulls {
  private timer: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private isClosed = false
  private readonly askedAt = new Map<string, number>()
  private readonly options: MergedPullsOptions

  constructor(options: MergedPullsOptions) {
    this.options = options
  }

  /** Looks at once, then on the GitHub page's cadence while someone is looking. */
  start(): void {
    if (this.isClosed || this.timer) return
    const every = this.options.everyMs ?? MERGED_PULLS_EVERY_MS
    this.timer = setInterval(() => {
      if (this.options.wanted?.() ?? true) void this.read()
    }, every)
    this.timer.unref?.()
  }

  close(): void {
    this.isClosed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One pass over every repository that has something waiting. Never throws, and never runs twice at once. */
  read(): Promise<void> {
    if (this.isClosed) return Promise.resolve()
    this.running ??= this.pass()
      .catch((error: unknown) => this.options.log?.(`Merged pull requests: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.running = null
      })
    return this.running
  }

  private async pass(): Promise<void> {
    const wants = await this.wants()
    let changed = false
    for (const [repo, want] of wants) {
      if (this.isClosed) return
      // A repository is asked at most once a minute, with a second of slack for the timer.
      const every = (this.options.everyMs ?? MERGED_PULLS_EVERY_MS) - 1000
      const now = (this.options.now ?? Date.now)()
      if (now - (this.askedAt.get(repo) ?? Number.NEGATIVE_INFINITY) < every) continue
      this.askedAt.set(repo, now)
      let pulls: SurveyPull[]
      try {
        pulls = await this.pullsOf(repo)
      } catch (error) {
        this.options.log?.(`Merged pull requests: ${repo}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      if (this.settleItems(want.items, pulls)) changed = true
      this.settleReviews(want.reviewed, pulls)
    }
    if (changed) await Promise.resolve(this.options.changed()).catch((error: unknown) => this.options.log?.(`Merged pull requests: reading hobkin again failed: ${error instanceof Error ? error.message : String(error)}`))
  }

  /** What waits on each GitHub repository: finished changes by project, and reviewed pull requests. */
  private async wants(): Promise<Map<string, { items: { slug: string; id: string }[]; reviewed: ReviewedPull[] }>> {
    const wants = new Map<string, { items: { slug: string; id: string }[]; reviewed: ReviewedPull[] }>()
    const of = (repo: string) => {
      let found = wants.get(repo)
      if (!found) wants.set(repo, (found = { items: [], reviewed: [] }))
      return found
    }
    for (const pull of this.options.reviewed()) if (!pull.host) of(`${pull.owner}/${pull.repo}`.toLowerCase()).reviewed.push(pull)
    let data: string
    try {
      data = this.options.data()
    } catch {
      return wants
    }
    const repoOf = this.options.repoOf ?? originRepo
    for (const project of readProjects(data)) {
      if (project.state !== 'chosen') continue
      const waiting = (readItems(data, project.slug) as Item[]).filter((item) => FINISHED.includes(item.state))
      if (!waiting.length) continue
      const repo = await repoOf(project.path ?? paths(data, project.slug).clone)
      if (repo) of(repo).items.push(...waiting.map((item) => ({ slug: project.slug, id: item.id })))
    }
    return wants
  }

  private async pullsOf(repo: string): Promise<SurveyPull[]> {
    const text = await ghText(this.options.gh, ['pr', 'list', '--repo', repo, '--state', 'all', '--limit', String(MOST_PULLS), '--json', FIELDS])
    const list = JSON.parse(text) as unknown
    if (!Array.isArray(list)) throw new Error('gh answered with something that is not a list.')
    return list as SurveyPull[]
  }

  /** Merged ones are closed as hobkin closes a merge from a card, closed ones as its survey does. Says whether any item changed. */
  private settleItems(wanted: { slug: string; id: string }[], pulls: SurveyPull[]): boolean {
    let changed = false
    for (const { slug, id } of wanted) {
      try {
        const data = this.options.data()
        // Read again now: the item may have merged from a card, or gone back to work, while GitHub was asked.
        const item = (readItems(data, slug) as Item[]).find((known) => known.id === id)
        if (!item || !FINISHED.includes(item.state)) continue
        const pull = pullOf(item, pulls)
        if (pull?.state === 'MERGED') {
          closeMergedPull(data, slug, item, pull)
        } else if (pull && pull.state !== 'OPEN' && item.state === 'pr') {
          // The user closes a PR to keep its work as a local branch for review: nothing is declined, and the branch stays the record.
          const branch = typeof item.branch === 'string' && item.branch ? item.branch : (pull.headRefName ?? null)
          updateItem(data, slug, id, { state: 'branch', pr: null, closedPr: pull.url, branch })
        } else continue
        changed = true
        if (pull.url && pull.number != null) this.options.closed({ repo: urlRepo(pull.url), number: pull.number, url: pull.url })
      } catch (error) {
        this.options.log?.(`Merged pull requests: ${slug}/${id}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return changed
  }

  private settleReviews(reviewed: ReviewedPull[], pulls: SurveyPull[]): void {
    for (const target of reviewed) {
      const pull = pulls.find((found) => found.number === target.number)
      if (!pull?.state || pull.state === 'OPEN') continue
      try {
        this.options.retire(target)
        if (pull.url) this.options.closed({ repo: urlRepo(pull.url), number: target.number, url: pull.url })
      } catch (error) {
        this.options.log?.(`Merged pull requests: ${target.owner}/${target.repo}#${target.number}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}

const urlRepo = (url: string) => /github\.com\/([^/]+\/[^/]+)\/pull\//i.exec(url)?.[1] ?? ''
