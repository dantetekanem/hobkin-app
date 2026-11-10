import { execFile } from 'node:child_process'
import { GITHUB_UNKNOWN, NO_GITHUB_LISTS, type GitHubLists, type GitHubState } from '#shared/protocol/github.ts'

/**
 * The user's GitHub for the GitHub page (_specs/024-github): pull requests waiting for their review, their own pull
 * requests and their issues, read through gh with the login gh already has. It only reads. It keeps what it read
 * last, reads again when asked and every few minutes while someone is looking, and never runs two reads at once.
 */

/** What one read found. */
export type GitHubRead =
  | { found: 'connected'; login: string; lists: GitHubLists; note: string | null }
  | { found: 'signed-out'; message: string | null }
  | { found: 'missing' }
  /** The read did not get through. What was read before stays. */
  | { found: 'failed'; message: string }

/** Where reads come from: gh, or made-up data. */
export interface GitHubSource {
  /** The data is made up. */
  sample: boolean
  read(): Promise<GitHubRead>
}

/** How often it reads again by itself. */
export const GITHUB_EVERY_MS = 5 * 60_000

export interface GitHubOptions {
  source: GitHubSource
  /** The state changed. */
  onChange: () => void
  /** Whether anyone is looking. While nobody is, the timer leaves GitHub alone. Always, when not given. */
  wanted?: () => boolean
  everyMs?: number
  log?: (line: string) => void
}

// gh's own tokens, fine-grained tokens, and whatever follows a bearer or a `token=`.
const TOKEN_SHAPES: [RegExp, string][] = [
  [/\bgh[opusr]_[A-Za-z0-9]{20,}/g, '[hidden]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, '[hidden]'],
  [/\b(Bearer\s+)\S+/gi, '$1[hidden]'],
  [/\b(token\s*[=:]\s*)\S+/gi, '$1[hidden]'],
]
const ESCAPES = /\u001b\[[0-9;]*[A-Za-z]/g

/** Words that are safe to show and to log: on one line, without escape codes or anything shaped like a token, and not too long. */
export function plainWords(text: string, most = 300): string {
  const lines = text
    .replace(ESCAPES, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  // Each line but the last ends as a sentence, so the lines read as one.
  const sentences = lines.map((line, index) => {
    const last = index === lines.length - 1
    return last || /[.:!?]$/.test(line) ? line : `${line}.`
  })

  let safe = sentences.join(' ')
  for (const [shape, mark] of TOKEN_SHAPES) {
    safe = safe.replace(shape, mark)
  }
  return safe.length > most ? `${safe.slice(0, most).trimEnd()}...` : safe
}

/** What a read changes in the state. A failed read changes only the message, so what was read before stays. */
function changesFrom(read: GitHubRead, now: string): Partial<GitHubState> {
  switch (read.found) {
    case 'connected':
      return { connection: 'connected', login: read.login, ...read.lists, refreshedAt: now, error: read.note }
    case 'signed-out':
      return { connection: 'signed-out', login: null, ...NO_GITHUB_LISTS, refreshedAt: now, error: read.message }
    case 'missing':
      return { connection: 'missing', login: null, ...NO_GITHUB_LISTS, refreshedAt: now, error: null }
    case 'failed':
      return { error: read.message }
  }
}

export class GitHub {
  private current: GitHubState
  private running: Promise<GitHubState> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private readonly options: GitHubOptions

  constructor(options: GitHubOptions) {
    this.options = options
    this.current = { ...GITHUB_UNKNOWN, sample: options.source.sample }
  }

  get state(): GitHubState {
    return this.current
  }

  /** Reads now, then again every few minutes while someone is looking. */
  start(): void {
    if (this.closed || this.timer) return
    void this.refresh()
    this.timer = setInterval(() => {
      if (this.options.wanted?.() ?? true) void this.refresh()
    }, this.options.everyMs ?? GITHUB_EVERY_MS)
    // The timer alone never keeps the host running.
    this.timer.unref?.()
  }

  /** Reads GitHub again. A read already under way answers this one too, so there is never more than one at a time. */
  refresh(): Promise<GitHubState> {
    if (this.closed) return Promise.resolve(this.current)
    if (!this.running) {
      this.running = this.read().finally(() => {
        this.running = null
      })
      this.change({ refreshing: true })
    }
    return this.running
  }

  close(): void {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private async read(): Promise<GitHubState> {
    let outcome: GitHubRead
    try {
      outcome = await this.options.source.read()
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      outcome = { found: 'failed', message: `Could not read GitHub: ${plainWords(said)}` }
    }
    if (this.closed) return this.current

    if (outcome.found === 'failed') this.options.log?.(`GitHub: ${outcome.message}`)
    this.change({ ...changesFrom(outcome, new Date().toISOString()), refreshing: false })
    return this.current
  }

  private change(change: Partial<GitHubState>): void {
    this.current = { ...this.current, ...change }
    this.options.onChange()
  }
}

/** Opens a GitHub page in the system browser. Only an https://github.com address is ever handed to the system, and no shell sees it. */
export function openGitHubPage(url: string): void {
  const page = new URL(url)
  if (page.protocol !== 'https:' || page.hostname !== 'github.com') throw Error('Only pages on github.com open from here.')
  execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [page.href], () => {})
}
