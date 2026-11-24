/**
 * Cleaning up the reviews the home keeps (spec 058, A9). Of each change, the review at the commit the change is at stays
 * whole, and so does the next newest by when it was built; an older one keeps its change review's summary, progress and
 * usage, which the numbers read, and loses its review, its files, its meta and the change review's other known files. A
 * change hobkin closed or merged loses all of that once nothing of it was written for thirty days. A review tree the host
 * moved aside as broken goes after seven days, through git when git still has it, and only when git removes it without
 * losing anything: one with changes or untracked files, or locked, is left and the log says git's reason. Nothing being
 * built, or read in the last day, is touched. It never follows a link, never leaves the home's reviews and review-trees folders, and leaves
 * anything it does not know. Notes, the record of what landed, a merge asked for, the record of agents sent back and
 * every summary always stay. Remove on a row stays the user's own delete. Each run says what it removed, so the host's
 * log keeps the list; a look removes nothing and says what a run would.
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { join, sep } from 'node:path'
import { targetOfReviewFolder, type ReviewTarget } from '#shared/review/ids.ts'

/** How many of a change's reviews stay whole: the one at its commit, and the newest built besides. */
export const KEPT_WHOLE = 2
/** How long a closed change's reviews stay whole after the last time anything of them was written. */
export const CLOSED_KEPT_MS = 30 * 24 * 60 * 60 * 1000
/** How long a broken review tree, moved aside, is kept. */
export const BROKEN_KEPT_MS = 7 * 24 * 60 * 60 * 1000
/** A review read this recently is in use, and left whole. */
export const READ_KEPT_MS = 24 * 60 * 60 * 1000

/** A reviewed commit's own files of a review folder: its review, its files and its meta. */
const HEAD_FILE = /^(review|files|meta)-([0-9a-f]{12})\.json$/
/** The change review's files that go with an old review: what it was told and found. Anything else in there stays. */
const HEAVY_IN_CHANGE_REVIEW = new Set(['graph.json', 'units.json', 'story.md', 'story-words.json', 'blind-check.json', 'triage.json', 'risk-events.jsonl', 'rejected-events.json'])
/** The name the host gives a tree it moves aside (`readyReviewTree`): the tree's, then the time it broke. */
const BROKEN_TREE = /^.+-broken-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/

/** A regular file or folder at a path, never what a link points to; null for anything else. */
function kindAt(path: string): 'file' | 'folder' | null {
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat || stat.isSymbolicLink()) return null
  return stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : null
}

/** The entries of a folder that is no link, or none. */
const entriesOf = (path: string): string[] => (kindAt(path) === 'folder' ? readdirSync(path) : [])

/** When a reviewed commit's review was built: its change review's summary says, else its meta, else it is as old as can be. */
function builtAt(folder: string, head: string): number {
  const read = (path: string, field: string) => {
    if (kindAt(path) !== 'file') return Number.NaN
    try {
      return Date.parse(String((JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[field] ?? ''))
    } catch {
      return Number.NaN
    }
  }
  const finished = read(join(folder, 'change-review', head, 'summary.json'), 'at')
  if (Number.isFinite(finished)) return finished
  const prepared = read(join(folder, `meta-${head}.json`), 'preparedAt')
  return Number.isFinite(prepared) ? prepared : 0
}

/** A change review under way, or cut short: its progress, with no summary yet. */
const isBeingBuilt = (folder: string, head: string) => kindAt(join(folder, 'change-review', head, 'progress.json')) === 'file' && kindAt(join(folder, 'change-review', head, 'summary.json')) !== 'file'

/** Each reviewed commit of a target's folder. */
function headsOf(folder: string): string[] {
  const heads = new Set<string>()
  for (const name of entriesOf(folder)) {
    const head = HEAD_FILE.exec(name)?.[2]
    if (head && kindAt(join(folder, name)) === 'file') heads.add(head)
  }
  for (const head of entriesOf(join(folder, 'change-review'))) if (/^[0-9a-f]{12}$/.test(head) && kindAt(join(folder, 'change-review', head)) === 'folder') heads.add(head)
  return [...heads]
}

/** The files of one reviewed commit that go: its review, files and meta, and its change review's known heavy files. */
function heavyFilesOf(folder: string, head: string): string[] {
  const own = ['review', 'files', 'meta'].map((kind) => join(folder, `${kind}-${head}.json`)).filter((path) => kindAt(path) === 'file')
  const review = join(folder, 'change-review', head)
  const told = entriesOf(review).filter((name) => HEAVY_IN_CHANGE_REVIEW.has(name) && kindAt(join(review, name)) === 'file').map((name) => join(review, name))
  return [...own, ...told]
}

/** When any regular file of a target's folder was last written. Links and folders' own times do not count. */
function lastWritten(folder: string): number {
  let newest = 0
  const walk = (path: string) => {
    for (const name of entriesOf(path)) {
      const child = join(path, name)
      const kind = kindAt(child)
      if (kind === 'folder') walk(child)
      else if (kind === 'file') newest = Math.max(newest, lstatSync(child).mtimeMs)
    }
  }
  walk(folder)
  return newest
}

const GIT_ENV = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }

/** The repository a linked worktree belongs to, from its `.git` file, when git still lists it there, and whether it is locked. */
function registeredIn(tree: string): { repo: string; locked: boolean } | null {
  const dotGit = join(tree, '.git')
  if (kindAt(dotGit) !== 'file') return null
  const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim()
  const at = gitdir?.lastIndexOf(`${sep}.git${sep}worktrees${sep}`) ?? -1
  if (!gitdir || at < 0) return null
  const repo = gitdir.slice(0, at)
  const listed = execFileSync('git', ['-C', repo, 'worktree', 'list', '--porcelain'], { encoding: 'utf8', timeout: 30_000, env: GIT_ENV })
  const real = realpathSync(tree)
  // Each tree is a block of lines: its path first, and `locked` among them when it is.
  const block = listed.split('\n\n').find((lines) => [tree, real].includes(lines.split('\n')[0]?.slice('worktree '.length) ?? ''))
  return block ? { repo, locked: block.split('\n').some((line) => line === 'locked' || line.startsWith('locked ')) } : null
}

/** What git says when a command fails, in a line. */
function gitSaid(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr
  const said = (typeof stderr === 'string' ? stderr : Buffer.isBuffer(stderr) ? stderr.toString('utf8') : '').trim().replace(/\s+/g, ' ')
  return said || (error instanceof Error ? error.message : String(error))
}

/**
 * Why git would not remove a tree without its force: it is locked, or holds changes or files git does not track. Null
 * when it would. Asked of git, and nothing is changed, so a look can say it too.
 */
function refusalOf(tree: string, locked: boolean): string | null {
  if (locked) return 'it is locked'
  const changes = execFileSync('git', ['-C', tree, 'status', '--porcelain'], { encoding: 'utf8', timeout: 30_000, env: GIT_ENV }).trim()
  return changes ? `it holds changes or untracked files (${changes.split('\n').length})` : null
}

export interface CleanUp {
  root: string
  now: number
  /** Whether hobkin closed or merged a change, or no longer has it. */
  closed: (target: ReviewTarget) => boolean
  /** The commit a change is at now, whose review always stays whole. */
  headOf?: (target: ReviewTarget) => string | null
  /** Whether a review was opened or read in the last day: then it is left whole. */
  readRecently?: (target: ReviewTarget) => boolean
  /** Remove nothing, and answer what a run would remove. */
  look?: boolean
  /** Where it says what it left, and why: a tree git would not remove. */
  say?: (line: string) => void
}

/**
 * Removes what the home no longer needs, and answers every path it removed. Nothing is removed on a doubt: what cannot
 * be read, is a link, or lies outside the home's reviews and review-trees folders is left as it is.
 */
export function cleanUp({ root, now, closed, headOf = () => null, readRecently = () => false, look = false, say }: CleanUp): string[] {
  const removed: string[] = []
  const reviews = join(root, 'client', 'reviews')
  const trees = join(root, 'client', 'review-trees')
  /** Only a path that really is inside one of the two folders, through no link. */
  const inside = (path: string, under: string) => {
    if (kindAt(under) !== 'folder') return false
    const real = realpathSync(path)
    return real.startsWith(`${realpathSync(under)}${sep}`)
  }
  const remove = (path: string, under: string) => {
    if (!kindAt(path) || !inside(path, under)) return
    if (!look) rmSync(path, { force: true, ...(kindAt(path) === 'folder' ? { recursive: true } : {}) })
    removed.push(path)
  }

  for (const name of entriesOf(reviews)) {
    const target = targetOfReviewFolder(name)
    const folder = join(reviews, name)
    if (!target || kindAt(folder) !== 'folder') continue
    try {
      if (readRecently(target)) continue
      const heads = headsOf(folder).filter((head) => !isBeingBuilt(folder, head))
      const done = target.kind === 'change' && closed(target) && now - lastWritten(folder) >= CLOSED_KEPT_MS
      const current = headOf(target)?.slice(0, 12)
      const byBuilt = heads.sort((a, b) => builtAt(folder, b) - builtAt(folder, a) || b.localeCompare(a))
      const kept = done ? [] : [...(current && heads.includes(current) ? [current] : []), ...byBuilt.filter((head) => head !== current)].slice(0, KEPT_WHOLE)
      for (const head of heads.filter((entry) => !kept.includes(entry))) for (const path of heavyFilesOf(folder, head)) remove(path, reviews)
    } catch {
      // Left as it is: what cannot be read is not removed.
    }
  }

  for (const name of entriesOf(trees)) {
    const path = join(trees, name)
    const said = BROKEN_TREE.exec(name)
    if (!said || kindAt(path) !== 'folder') continue
    const brokeAt = Date.parse(`${said[1]}T${said[2]}:${said[3]}:${said[4]}.${said[5]}Z`)
    if (!Number.isFinite(brokeAt) || now - brokeAt < BROKEN_KEPT_MS) continue
    try {
      // One git still has goes through git, so its repository forgets it, and never with force: what git would not
      // throw away stays. One git has none of is a folder.
      const registered = registeredIn(path)
      if (!registered) {
        remove(path, trees)
        continue
      }
      if (look) {
        const refused = refusalOf(path, registered.locked)
        if (refused) say?.(`Reviews: cleaning up left ${path}: git would not remove it: ${refused}.`)
        else removed.push(path)
        continue
      }
      try {
        execFileSync('git', ['-C', registered.repo, 'worktree', 'remove', path], { timeout: 60_000, stdio: ['ignore', 'ignore', 'pipe'], env: GIT_ENV })
        removed.push(path)
      } catch (error) {
        say?.(`Reviews: cleaning up left ${path}: git would not remove it: ${gitSaid(error)}`)
      }
    } catch (error) {
      // Git could not tell: left as it is.
      say?.(`Reviews: cleaning up left ${path}: git could not say whether it still has it: ${gitSaid(error)}`)
    }
  }
  return removed
}
