import { filedIssues, projectOfRepo } from 'hobkin/src/cli/work/issues.mjs'
import type { GitHubState, IssueWork } from '#shared/protocol/github.ts'
import { Unavailable, type HostHandlers } from './commands.ts'
import { ghText, type GhCall } from './review/gh.ts'
import type { WorkApp } from './work.ts'

/**
 * Add to queue on the GitHub page: the host finds the hobkin project whose repository the issue is in, reads the issue through gh, only reading,
 * and hands it to hobkin's own `issue` work action, which files it first in the queue. Specs: 011-work, 024-github.
 */

export interface IssueSeat {
  /** hobkin's application. Throws, with the reason, while hobkin is not open in this host. */
  app: () => WorkApp
  /** The folder the home's data is in. */
  root: () => string
  /** gh, to read the issue. A host without it, such as the scripted one, never runs gh, and refuses. */
  gh?: GhCall
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

export function workIssueHandlers({ app, root, gh }: IssueSeat): Pick<HostHandlers, 'work.issue'> {
  return {
    'work.issue': async ({ repo, number }) => {
      if (!gh) throw new Unavailable('This host does not run gh, so the issue cannot be read and nothing was added. Start the host with --github to add issues.')
      const project = await projectOfRepo(root(), repo)
      if (!project) throw new Unavailable(`No hobkin project is github.com/${repo}. Add it on the Work screen first.`)
      const issue = issueFrom(await ghText(gh, ['issue', 'view', String(number), '--repo', repo, '--json', ISSUE_FIELDS]), repo, number)
      const said = (await app().workAction('issue', project.slug, issue)) as { message?: unknown } | null
      return { message: String(said?.message ?? '') }
    },
  }
}

type Filed = ReturnType<ReturnType<typeof filedIssues>>

const workOf = (filed: Filed): IssueWork | null =>
  filed ? { slug: filed.project.slug, project: filed.project.name ?? filed.project.slug, item: filed.item.id, state: filed.item.state, pr: filed.item.pr ?? null } : null

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
