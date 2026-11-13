import { execFileSync } from 'node:child_process'
import type { HobkinSnapshot } from 'hobkin/src/cli/application.mjs'
import { shownTitle } from 'hobkin/src/cli/work/groups.mjs'
import { githubRepoOf } from 'hobkin/src/cli/work/issues.mjs'
import { readItems } from 'hobkin/src/cli/work/store.mjs'
import type { FinishedChange, FinishedGroup, MergingRow, QueueRow, WorkIssue, WorkState } from '#shared/protocol/work.ts'
import { changeOf, workFrom } from './work.ts'

/**
 * Work mode as the Work screen draws it (`workFrom`), with what hobkin keeps and its snapshot's groups leave out: the
 * repository on GitHub of each project it works on, the GitHub issue each piece of work was filed from, the finished
 * branches whose run left the user a note, which hobkin lists apart from its groups (`waiting.yours`), and what the
 * user said yes to that is still being brought up to date
 * before it merges. Nothing here decides anything hobkin does not. Spec: 011-work.
 */

type ReadyRow = Parameters<typeof changeOf>[0]
type Item = ReturnType<typeof readItems>[number]

/** A row of hobkin's `closingItems`: finished work an agent has gone back to. */
interface ClosingRow {
  slug?: unknown
  project?: unknown
  item?: unknown
  title?: unknown
  branch?: unknown
  doing?: unknown
}

/**
 * What hobkin says the main agent's session is doing once a refresh and merge was handed to it, because work mode was
 * off or paused (`REFRESH_JOB` in its `src/cli/work/refresh.mjs`, which does not export it).
 */
const REFRESH_HANDED_OFF = 'refreshing it, then merging it'

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null)

const GITHUB_REPO = /^[\w.-]+\/[\w.-]+$/

/** The issue as hobkin keeps it on the item. A link that is not GitHub's is made from the repository and number instead. */
function issueOf(item: Item | undefined): WorkIssue | null {
  const issue = item?.issue as { repo?: unknown; number?: unknown; url?: unknown } | null | undefined
  const repo = text(issue?.repo)
  const number = issue?.number
  if (!repo || !GITHUB_REPO.test(repo)) return null
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null

  const url = text(issue?.url)
  return {
    repo,
    number,
    url: url?.startsWith('https://github.com/') ? url : `https://github.com/${repo}/issues/${number}`,
  }
}

/** hobkin's item `id` on the project `slug`, or nothing when hobkin has no such item. */
type ItemOf = (slug: string, id: string) => Item | undefined

/** One read of each project's items, only for the projects asked about. A home that cannot be read has none to give. */
function itemsReader(root: () => string): ItemOf {
  const read = new Map<string, Item[]>()
  const itemsOf = (slug: string): Item[] => {
    const known = read.get(slug)
    if (known) return known

    let items: Item[] = []
    try {
      items = readItems(root(), slug)
    } catch {
      // A home that cannot be read now has no items to add, and the work goes as the snapshot has it.
    }
    read.set(slug, items)
    return items
  }
  return (slug, id) => itemsOf(slug).find((item) => item.id === id)
}

/** A folder's origin, as `git remote get-url origin` prints it, or null when it has none. */
export type OriginOf = (folder: string) => string | null

const ORIGIN_TIMEOUT_MS = 2000

/** git, only reading, as hobkin's `repoOfProject` asks it. A folder git cannot answer for has no origin. */
function gitOrigin(folder: string): string | null {
  try {
    return execFileSync('git', ['-C', folder, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: ORIGIN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null
  } catch {
    return null
  }
}

/**
 * Each project's repository on GitHub, by its slug, as hobkin's `repoOfProject` finds it: its folder's origin, or the remote hobkin
 * clones. Only for the projects hobkin works on, as a look for projects can propose many folders. Each folder's origin is asked once
 * for the host's life, so a refresh runs no git.
 */
function reposReader(originOf: OriginOf): (projects: unknown) => Map<string, string | null> {
  const origins = new Map<string, string | null>()
  const originIn = (folder: string) => {
    if (!origins.has(folder)) origins.set(folder, originOf(folder))
    return origins.get(folder) ?? null
  }
  return (projects) => {
    const repos = new Map<string, string | null>()
    for (const project of Array.isArray(projects) ? (projects as Record<string, unknown>[]) : []) {
      const slug = text(project.slug)
      if (!slug || project.state !== 'chosen') continue
      const folder = text(project.path)
      repos.set(slug, githubRepoOf(folder ? originIn(folder) : project.remote))
    }
    return repos
  }
}

const LEFT_HEADING = 'Left for you'

function leftWhy(count: number): string {
  if (count === 1) return 'Its run left you a note: something it could not do or decide alone.'
  return 'Their runs left you a note: something each could not do or decide alone.'
}

/** A finished branch whose run left a note: its note, Review, and Close without merging, which is hobkin's own done. No merge is offered. */
function leftCard(row: ReadyRow, note: string, item: Item | undefined): FinishedChange {
  const keeps = row.pr ? 'its branch and its PR stay as they are' : 'its branch stays as it is'
  const opensPr: FinishedChange['choices'] = row.pr ? [{ value: 'open', label: 'Open the PR in the browser' }] : []
  return {
    ...changeOf(row, 'needs'),
    reason: 'Its run left you a note, so no group merges it until you answer.',
    yes: `Close without merging marks it done: nothing merges, and ${keeps}.`,
    choices: [{ value: 'diff', label: 'Show the diff' }, ...opensPr, { value: 'done', label: 'Close without merging' }],
    issue: issueOf(item),
    left: note,
  }
}

/** hobkin's `waiting.yours` rows that are finished branches with a note from their run, and that no group already shows. */
function leftGroup(yours: unknown, shown: ReadonlySet<string>, itemOf: ItemOf): FinishedGroup | null {
  const rows = Array.isArray(yours) ? (yours as Record<string, unknown>[]) : []
  const changes = rows.flatMap((row) => {
    const slug = text(row.slug)
    const id = text(row.item)
    const note = text(row.left)
    // A step only the user can take has no branch: it is not finished work.
    const finishedBranch = Boolean(text(row.branch))
    if (!slug || !id || !note || !finishedBranch || shown.has(`${slug}:${id}`)) return []
    return [leftCard(row as unknown as ReadyRow, note, itemOf(slug, id))]
  })
  if (!changes.length) return null
  return { name: 'left', heading: LEFT_HEADING, why: leftWhy(changes.length), action: null, changes }
}

/** What the user said yes to: a refresh and merge hobkin keeps on the item (`mergeWhenFresh`), or one handed to the main agent's session. */
function mergingRows(closing: unknown, itemOf: ItemOf): MergingRow[] {
  const rows = Array.isArray(closing) ? (closing as ClosingRow[]) : []
  return rows.flatMap((row) => {
    const slug = text(row.slug)
    const id = text(row.item)
    if (!slug || !id) return []

    const item = itemOf(slug, id)
    const asked = item?.mergeWhenFresh as { at?: unknown } | null | undefined
    const handedOff = !asked && row.doing === REFRESH_HANDED_OFF
    if (!asked && !handedOff) return []

    return [
      {
        key: `${slug}:${id}`,
        slug,
        project: text(row.project) ?? slug,
        item: id,
        title: shownTitle(row.title),
        branch: text(row.branch),
        issue: issueOf(item),
        pr: text(item?.pr),
        since: text(asked?.at),
        handedOff,
      },
    ]
  })
}

function withItems(snapshot: HobkinSnapshot, root: () => string, reposOf: ReturnType<typeof reposReader>): WorkState | null {
  const work = workFrom(snapshot)
  if (!work) return null
  const itemOf = itemsReader(root)
  const waiting = snapshot.waiting as { yours?: unknown } | null | undefined
  const closing = (snapshot.work as { closing?: unknown }).closing
  const repos = reposOf((snapshot.work as { projects?: unknown }).projects)
  const projects = work.projects.map((project) => (repos.has(project.slug) ? { ...project, repo: repos.get(project.slug) ?? null } : project))

  const finished = work.finished.map((group) => ({
    ...group,
    changes: group.changes.map((change) => ({ ...change, issue: issueOf(itemOf(change.slug, change.item)) })),
  }))
  const shown = new Set(finished.flatMap(({ changes }) => changes.map(({ key }) => key)))
  const left = leftGroup(waiting?.yours, shown, itemOf)

  const queue = work.queue.map((row): QueueRow => {
    const item = row.slug && row.item ? itemOf(row.slug, row.item) : undefined
    return { ...row, issue: issueOf(item), pr: text(item?.pr) }
  })

  return {
    ...work,
    queue,
    projects,
    finished: left ? [...finished, left] : finished,
    merging: mergingRows(closing, itemOf),
  }
}

/**
 * What Change Review prepares by itself: the finished work in hobkin's groups. A branch whose run left a note is
 * reviewed once the user asks, from its card, so no review is spent on work its own run called unfinished.
 */
export function preparedByItself(work: WorkState | null): WorkState | null {
  return work && { ...work, finished: work.finished.filter(({ name }) => name !== 'left') }
}

/**
 * The Work screen's work mode from a snapshot. hobkin's items are read once each time its work or its waiting rows
 * change (a refresh replaces both), and not again while neither does. A home that cannot be read gives the work as
 * hobkin's snapshot has it, with nothing it would have read from the items.
 */
export function workReader(root: () => string, originOf: OriginOf = gitOrigin): (snapshot: HobkinSnapshot) => WorkState | null {
  let last: { work: unknown; waiting: unknown; read: WorkState | null } | null = null
  const reposOf = reposReader(originOf)
  return (snapshot) => {
    if (last && last.work === snapshot.work && last.waiting === snapshot.waiting) return last.read
    const read = withItems(snapshot, root, reposOf)
    last = { work: snapshot.work, waiting: snapshot.waiting, read }
    return read
  }
}
