import { GITHUB_UNKNOWN, NO_GITHUB_LISTS, type GitHubLists, type GitHubState } from '../protocol.ts'

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
export const GITHUB_EVERY_MS = 60_000
/** How long after something merged or closed GitHub is read once more: its search takes a moment to follow. */
const READ_AGAIN_MS = 10_000
/** How long what the host heard has merged or closed stays out of the lists, whatever GitHub's search still says. */
const GONE_FOR_MS = 5 * 60_000

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
  private isClosed = false
  /** What the host heard has merged or closed, by address, and until when it stays out of the lists. */
  private readonly gone = new Map<string, number>()
  private readonly again = new Set<ReturnType<typeof setTimeout>>()
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
    if (this.isClosed || this.timer) return
    void this.refresh()
    this.timer = setInterval(() => {
      if (this.options.wanted?.() ?? true) void this.refresh()
    }, this.options.everyMs ?? GITHUB_EVERY_MS)
    // The timer alone never keeps the host running.
    this.timer.unref?.()
  }

  /** Reads GitHub again. A read already under way answers this one too, so there is never more than one at a time. */
  refresh(): Promise<GitHubState> {
    if (this.isClosed) return Promise.resolve(this.current)
    if (!this.running) {
      this.running = this.read().finally(() => {
        this.running = null
      })
      this.change({ refreshing: true })
    }
    return this.running
  }

  /**
   * A pull request or an issue has merged or closed, as the host itself just saw: it leaves the lists now, and stays
   * out while GitHub's search catches up. GitHub is read again at once and once more a little later. It is named by
   * its repository and number, or by its address.
   */
  closed(what: { repo?: string; number?: number; url?: string }): void {
    if (this.isClosed) return
    const matches = (row: { repo: string; number: number; url: string }) => (what.url ? row.url === what.url : row.repo.toLowerCase() === what.repo?.toLowerCase() && row.number === what.number)
    for (const row of [...this.current.reviews, ...this.current.pulls, ...this.current.issues]) if (matches(row)) this.gone.set(row.url, Date.now() + GONE_FOR_MS)
    if (what.url) this.gone.set(what.url, Date.now() + GONE_FOR_MS)
    this.change(this.withoutGone(this.current))
    this.readSoon()
  }

  /** Reads GitHub now and once more a little later, as after anything that may have merged or closed something. */
  readSoon(): void {
    if (this.isClosed) return
    void this.refresh()
    const timer = setTimeout(() => {
      this.again.delete(timer)
      void this.refresh()
    }, READ_AGAIN_MS)
    timer.unref?.()
    this.again.add(timer)
  }

  /** The lists without what the host heard has merged or closed. */
  private withoutGone<Lists extends Pick<GitHubState, 'reviews' | 'pulls' | 'issues'>>(lists: Lists): Pick<GitHubState, 'reviews' | 'pulls' | 'issues'> {
    const now = Date.now()
    for (const [url, until] of this.gone) if (until <= now) this.gone.delete(url)
    const here = <Row extends { url: string }>(rows: Row[]) => (this.gone.size ? rows.filter((row) => !this.gone.has(row.url)) : rows)
    return { reviews: here(lists.reviews), pulls: here(lists.pulls), issues: here(lists.issues) }
  }

  close(): void {
    this.isClosed = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const timer of this.again) clearTimeout(timer)
    this.again.clear()
  }

  private async read(): Promise<GitHubState> {
    let outcome: GitHubRead
    try {
      outcome = await this.options.source.read()
    } catch (error) {
      const said = error instanceof Error ? error.message : String(error)
      outcome = { found: 'failed', message: `Could not read GitHub: ${plainWords(said)}` }
    }
    if (this.isClosed) return this.current

    if (outcome.found === 'failed') this.options.log?.(`GitHub: ${outcome.message}`)
    const read = changesFrom(outcome, new Date().toISOString())
    // What the host heard has merged or closed stays out, even when GitHub's search still lists it.
    const lists = read.pulls ? this.withoutGone({ reviews: read.reviews ?? [], pulls: read.pulls, issues: read.issues ?? [] }) : {}
    this.change({ ...read, ...lists, refreshing: false })
    return this.current
  }

  private change(change: Partial<GitHubState>): void {
    this.current = { ...this.current, ...change }
    this.options.onChange()
  }
}
