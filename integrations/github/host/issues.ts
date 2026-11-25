import { filedIssues, projectOfRepo } from 'hobkin/src/cli/work/issues.mjs'
import { ownerView } from 'hobkin/src/cli/work/store.mjs'
import type { GitHubState, IssueWork } from '../protocol.ts'
import { Unavailable } from '#host/commands.ts'
import { ghText, type GhCall } from '#host/review/gh.ts'
import type { WorkApp } from '#host/work.ts'
import type { GitHubResults } from '../integration.ts'

/**
 * Add to queue on the GitHub page (`github.issue.add`): the host finds the hobkin project whose repository the issue is in, reads the issue through gh, only reading,
 * and hands it to hobkin's own `issue` work action, which files it first in the queue. Close issue: gh closes it as the user, and hobkin's own
 * work actions decline the work filed for it when that work is not finished. Specs: 011-work, 024-github.
 */

export interface IssueSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => WorkApp
  /** The folder the home's data is in. */
  root: () => string
  /** gh, to read an issue and to close one on the user's word. A host without it, such as the scripted one, never runs gh, and refuses. */
  gh?: GhCall
  /** Reads GitHub's lists again, so an issue that closed leaves them. */
  refreshGitHub?: () => Promise<unknown>
}

const ISSUE_FIELDS = 'number,title,body,url,labels'

/** The issue as hobkin's `issue` action takes it, from what gh printed. */
function issueFrom(stdout: string, repo: string, number: number) {
  let answer: { title?: unknown; body?: unknown; url?: unknown; labels?: unknown } | null
  try {
    answer = JSON.parse(stdout)
  } catch {
    throw new Error('gh answered with something that is not JSON, so nothing was added.')
  }
  const title = typeof answer?.title === 'string' ? answer.title.trim() : ''
  if (!title) throw new Error(`gh sent no title for ${repo}#${number}, so nothing was added.`)
  const labels = (Array.isArray(answer?.labels) ? answer.labels : [])
    .map((label: unknown) => (label as { name?: unknown } | null)?.name)
    .filter((name): name is string => typeof name === 'string')
  return {
    repo,
    number,
    title,
    body: typeof answer?.body === 'string' ? answer.body : '',
    url: typeof answer?.url === 'string' ? answer.url : `https://github.com/${repo}/issues/${number}`,
    labels,
  }
}

/** gh's words for why an issue closed. */
const CLOSE_REASONS = { completed: 'completed', 'not-planned': 'not planned' } as const

/** hobkin's states for work that is over: merged, done, or said no to. Closing its issue changes nothing for it. */
const OVER = ['merged', 'done', 'declined', 'dropped']

type IssueRef = { repo: string; number: number }

const messageOf = (said: unknown) => String((said as { message?: unknown } | null)?.message ?? '')

/**
 * hobkin's word on the work filed for an issue the user closed, through its own work actions: its item declined, or a run going on it stopped
 * as not approved, which declines it once the run has ended. Null when nothing is filed for the issue or its work is over.
 */
async function declineWorkFor({ app, root }: IssueSeat, issue: IssueRef): Promise<string | null> {
  const filed = filedIssues(root())(issue)
  if (!filed || OVER.includes(filed.item.state)) return null

  const { slug } = filed.project
  const run = ownerView(root()).running.find((entry) => entry.slug === slug && entry.item === filed.item.id)
  const said = run ? await app().workAction('stop', run.id, 'decline') : await app().workAction('decline', slug, filed.item.id)
  return messageOf(said)
}

/** What the user hears once the issue has closed: that, then hobkin's word on its item, or why hobkin could not decline it. The close stands either way. */
async function afterClosing(closed: string, seat: IssueSeat, issue: IssueRef): Promise<string> {
  try {
    const said = await declineWorkFor(seat, issue)
    return said ? `${closed}. ${said}` : `${closed}.`
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return `${closed}, and hobkin could not decline its item: ${why}`
  }
}

export function issueHandlers(seat: IssueSeat) {
  const { app, root, gh, refreshGitHub = async () => {} } = seat
  return {
    'github.issue.add': async ({ repo, number }: IssueRef): Promise<GitHubResults['github.issue.add']> => {
      if (!gh) throw new Unavailable('This host does not run gh, so the issue cannot be read and nothing was added. Start the host with --github to add issues.')
      const project = await projectOfRepo(root(), repo)
      if (!project) throw new Unavailable(`No hobkin project is github.com/${repo}. Add it on the Work screen first.`)
      const issue = issueFrom(await ghText(gh, ['issue', 'view', String(number), '--repo', repo, '--json', ISSUE_FIELDS]), repo, number)
      const said = (await app().workAction('issue', project.slug, issue)) as { message?: unknown } | null
      return { message: String(said?.message ?? '') }
    },
    // Only ever the user's word, given twice on the GitHub page. The issue closes first; hobkin's item for it follows, and never undoes the close.
    'github.issue.close': async ({ repo, number, reason }: IssueRef & { reason: keyof typeof CLOSE_REASONS }): Promise<GitHubResults['github.issue.close']> => {
      if (!gh) throw new Unavailable('This host does not run gh, so nothing was closed. Start the host with --github to close issues.')
      const how = CLOSE_REASONS[reason]
      await ghText(gh, ['issue', 'close', String(number), '--repo', repo, '--reason', how])
      const message = await afterClosing(`Closed ${repo}#${number} on GitHub as ${how}`, seat, { repo, number })

      // The issue leaves the lists once GitHub is read again. A read that fails keeps them as they were, and the next one drops it.
      await refreshGitHub().catch(() => {})
      return { message }
    },
  }
}

type Filed = ReturnType<ReturnType<typeof filedIssues>>

/** Where the deploy that carries a merged item stands, as hobkin's `deploys.mjs` marks it on the item. Null where nothing deploys it. */
const deployOf = (item: object): string | null => {
  const state = (item as { deploy?: { state?: unknown } | null }).deploy?.state
  return typeof state === 'string' ? state : null
}

function workOf(filed: Filed): IssueWork | null {
  if (!filed) return null

  const { project, item } = filed
  return {
    slug: project.slug,
    project: project.name ?? project.slug,
    item: item.id,
    state: item.state,
    pr: item.pr ?? null,
    deploy: deployOf(item),
  }
}

/**
 * The GitHub page's issues, each with the hobkin work filed for it, so a filed issue shows where its work stands on every load. hobkin's items
 * are read once each time GitHub's lists or hobkin's work change (`work` is the snapshot's, which a refresh replaces), and not again while
 * neither does. Without hobkin's work, as before hobkin opens, or with a home that cannot be read, the issues go as they are.
 */
export function issueWorkReader(root: () => string): (github: GitHubState, work: unknown) => GitHubState {
  let last: { github: GitHubState; work: unknown; read: GitHubState } | null = null
  return (github, work) => {
    if (!work || github.issues.length === 0) return github
    if (last?.github === github && last.work === work) return last.read
    try {
      const filedFor = filedIssues(root())
      const read = { ...github, issues: github.issues.map((issue) => ({ ...issue, work: workOf(filedFor(issue)) })) }
      last = { github, work, read }
      return read
    } catch {
      return github
    }
  }
}
