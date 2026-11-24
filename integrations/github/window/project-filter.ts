import type { GitHubIssue } from '#shared/protocol/github.ts'
import type { WorkProject } from '#shared/protocol/work.ts'
import { targetOfReviewId } from '#shared/review/ids.ts'
import { trackedProjects } from '../../../ui/src/features/work/projects.ts'
import { RECENT_MOST, type PullEntry, type PullSections } from './pull-reviews.ts'

/**
 * The GitHub page's quick filter by project: All, then a tab for each project hobkin works on, in the Work screen's
 * order. An item is a project's when its repository is the project's own on GitHub, as hobkin finds it; an item in no
 * project's repository shows under All only. Pure, so it is tested without a window. Spec: 024-github.
 */

/** What the page lists: its pull requests, as `pullSections` gives them, and its issues. */
export interface GitHubPage {
  sections: PullSections
  issues: GitHubIssue[]
}

export interface ProjectTab {
  /** The project, by hobkin's slug. Null for All. */
  slug: string | null
  label: string
  /** `owner/name` in lower case, as GitHub ignores case. Null for All. */
  repo: string | null
  /** How many open pull requests and issues it holds, each once. */
  count: number
}

const keyOf = (repo: string) => repo.toLowerCase()

/** A pull request's repository: GitHub's for one it lists, else its review's, which names it. */
function repoOfEntry({ pull, id, repo }: PullEntry): string {
  if (pull) return pull.repo
  const target = id ? targetOfReviewId(id) : null
  return target?.kind === 'pull' ? `${target.owner}/${target.repo}` : repo
}

/** The repository of each open pull request and issue on the page, each once. The others the AI reviewed are not open. */
const openRepos = ({ sections, issues }: GitHubPage): string[] => [...sections.requested.map(repoOfEntry), ...sections.mine.map(repoOfEntry), ...issues.map(({ repo }) => repo)].map(keyOf)

/**
 * All, then each project hobkin works on (paused ones included) whose repository is on GitHub, each with its count. A
 * project with nothing open keeps its tab, with 0. With no such project there are no tabs, and the row does not show.
 */
export function projectTabs(projects: readonly WorkProject[], page: GitHubPage): ProjectTab[] {
  const onGitHub = trackedProjects(projects).filter((project): project is WorkProject & { repo: string } => Boolean(project.repo))
  if (onGitHub.length === 0) return []

  const open = openRepos(page)
  const counted = new Map<string, number>()
  for (const repo of open) counted.set(repo, (counted.get(repo) ?? 0) + 1)

  return [
    { slug: null, label: 'All', repo: null, count: open.length },
    ...onGitHub.map(({ slug, name, repo }) => ({ slug, label: name, repo: keyOf(repo), count: counted.get(keyOf(repo)) ?? 0 })),
  ]
}

/** The tab the page shows: the remembered project's, or All when that project has no tab any more. Null without tabs. */
export function chosenTab(tabs: readonly ProjectTab[], wanted: string | null): ProjectTab | null {
  return tabs.find(({ slug }) => slug === wanted) ?? tabs[0] ?? null
}

/**
 * The page under a tab: every list narrowed to the project's repository. All, or no tab, leaves the lists whole. The others
 * the AI reviewed are then the `most` recent of what is left, so a busy project does not crowd a quiet one's out.
 */
export function pageIn(page: GitHubPage, tab: ProjectTab | null, most = RECENT_MOST): GitHubPage {
  const repo = tab?.repo
  const here = (entry: PullEntry) => !repo || keyOf(repoOfEntry(entry)) === repo
  const { requested, mine, reviewed } = page.sections
  return {
    sections: { requested: requested.filter(here), mine: mine.filter(here), reviewed: reviewed.filter(here).slice(0, most) },
    issues: repo ? page.issues.filter((issue) => keyOf(issue.repo) === repo) : page.issues,
  }
}
