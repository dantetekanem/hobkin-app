/**
 * Cleaning up the reviews the home keeps (spec 058, A9). For each change the two newest reviews stay whole; an older
 * one keeps its change review's summary and progress, which the numbers read, and loses the rest: its review, its
 * files, its meta and its change review's other files. A change hobkin closed or merged loses all of that once nothing
 * of it changed for thirty days. A review tree that broke and was moved aside goes after seven days. Notes, the record
 * of what landed, a merge asked for, the record of agents sent back and every summary always stay. Remove on a row
 * stays the user's own delete. Each run says what it removed, so the host's log keeps the list.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { targetOfReviewFolder, type ReviewTarget } from '#shared/review/ids.ts'

/** How many of a change's newest reviews stay whole. */
export const KEPT_WHOLE = 2
/** How long a closed change's reviews stay whole after the last time anything of them changed. */
export const CLOSED_KEPT_MS = 30 * 24 * 60 * 60 * 1000
/** How long a broken review tree, moved aside, is kept. */
export const BROKEN_KEPT_MS = 7 * 24 * 60 * 60 * 1000

/** What an old change review keeps: what the numbers and the review before it read. */
const KEPT_IN_CHANGE_REVIEW = new Set(['summary.json', 'progress.json'])
const HEAD_FILE = /^(?:review|files|meta)-([0-9a-f]{12})\.json$/

const mtime = (path: string) => statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0

/** Each reviewed commit of a target's folder, newest first, by when its review or its change review last changed. */
function headsOf(folder: string): string[] {
  const at = new Map<string, number>()
  const seen = (head: string, time: number) => at.set(head, Math.max(at.get(head) ?? 0, time))
  for (const name of readdirSync(folder)) {
    const head = HEAD_FILE.exec(name)?.[1]
    if (head) seen(head, mtime(join(folder, name)))
  }
  const reviews = join(folder, 'change-review')
  for (const head of existsSync(reviews) ? readdirSync(reviews) : []) {
    if (!/^[0-9a-f]{12}$/.test(head)) continue
    for (const name of readdirSync(join(reviews, head))) seen(head, mtime(join(reviews, head, name)))
  }
  return [...at].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0])).map(([head]) => head)
}

/** The files of one reviewed commit that go: its review, files and meta, and its change review but its summary and progress. */
function heavyFilesOf(folder: string, head: string): string[] {
  const own = ['review', 'files', 'meta'].map((kind) => join(folder, `${kind}-${head}.json`)).filter((path) => existsSync(path))
  const review = join(folder, 'change-review', head)
  const told = existsSync(review) ? readdirSync(review).filter((name) => !KEPT_IN_CHANGE_REVIEW.has(name)).map((name) => join(review, name)) : []
  return [...own, ...told]
}

/** When any file of a target's folder was last written. A folder's own time moves when a file goes, so it does not count. */
function lastChanged(folder: string): number {
  let newest = 0
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name)
      const stat = statSync(child, { throwIfNoEntry: false })
      if (stat?.isDirectory()) walk(child)
      else if (stat) newest = Math.max(newest, stat.mtimeMs)
    }
  }
  walk(folder)
  return newest
}

/** When a tree was moved aside, from its name (`<tree>-broken-<ISO time with dashes>`), else from the folder. */
function brokenAt(path: string, name: string): number {
  const said = /-broken-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(name)
  const parsed = said ? Date.parse(`${said[1]}T${said[2]}:${said[3]}:${said[4]}.${said[5]}Z`) : Number.NaN
  return Number.isFinite(parsed) ? parsed : mtime(path)
}

/**
 * Removes what the home no longer needs, and answers every path it removed. `closed` says whether hobkin closed or
 * merged a change, or no longer has it. Nothing is removed on a doubt: a folder that cannot be read is left as it is.
 */
export function cleanUp({ root, now, closed }: { root: string; now: number; closed: (target: ReviewTarget) => boolean }): string[] {
  const removed: string[] = []
  const remove = (path: string, folder = false) => {
    rmSync(path, { force: true, ...(folder ? { recursive: true } : {}) })
    removed.push(path)
  }
  const reviews = join(root, 'client', 'reviews')
  for (const name of existsSync(reviews) ? readdirSync(reviews) : []) {
    const target = targetOfReviewFolder(name)
    const folder = join(reviews, name)
    if (!target || !statSync(folder, { throwIfNoEntry: false })?.isDirectory()) continue
    try {
      const heads = headsOf(folder)
      const done = target.kind === 'change' && closed(target) && now - lastChanged(folder) >= CLOSED_KEPT_MS
      for (const head of done ? heads : heads.slice(KEPT_WHOLE)) for (const path of heavyFilesOf(folder, head)) remove(path)
    } catch {
      // Left as it is: what cannot be read is not removed.
    }
  }
  const trees = join(root, 'client', 'review-trees')
  for (const name of existsSync(trees) ? readdirSync(trees) : []) {
    const path = join(trees, name)
    if (name.includes('-broken-') && now - brokenAt(path, name) >= BROKEN_KEPT_MS) remove(path, true)
  }
  return removed
}
