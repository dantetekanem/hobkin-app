import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub, type GitHubIssue } from '../protocol.ts'
import type { WorkProject } from '#shared/protocol/work.ts'
import { chosenTab, pageIn, projectTabs, type GitHubPage } from '../window/project-filter.ts'
import { pullSections, type PullEntry } from '../window/pull-reviews.ts'

const NOW = Date.parse('2026-11-13T09:00:00Z')

const project = (slug: string, rest: Partial<WorkProject> = {}): WorkProject => ({
  slug,
  name: slug,
  state: 'chosen',
  priority: 'P2',
  prMode: 'off',
  level: 'important',
  paused: false,
  open: 0,
  prs: 0,
  branches: 0,
  left: 0,
  unmerged: 0,
  nextLookAt: null,
  lookError: null,
  ...rest,
})

// Out of priority order, as hobkin may send them, with every way a project can stand.
const PROJECTS: WorkProject[] = [
  project('docs-site', { priority: 'P2', repo: 'hobkin-sample/docs' }),
  project('quiet', { priority: 'P3', repo: 'hobkin-sample/quiet' }),
  project('billing-api', { name: 'Billing API', priority: 'P1', paused: true, repo: 'Hobkin-Sample/API' }),
  project('storefront', { priority: 'P0', repo: 'hobkin-sample/storefront' }),
  project('design-kit', { state: 'proposed', repo: 'hobkin-sample/design-kit' }),
  project('old-landing', { state: 'dropped', repo: 'hobkin-sample/old-landing' }),
  project('notes', { repo: null }),
  project('older-host'),
]

/** An issue in a repository no project of hobkin's is. */
const elsewhere: GitHubIssue = { repo: 'someone/else', number: 3, title: 'Not ours', labels: [], updatedAt: new Date(NOW).toISOString(), url: 'https://github.com/someone/else/issues/3', assigned: true, authored: false }

/** A pull request the AI reviewed that GitHub's lists no longer hold. Its review names the project, not the repository. */
const reviewedApi: PullEntry = { id: 'pr:hobkin-sample/api/1100', pull: null, ai: { state: 'none' }, title: 'Merged last week', repo: 'Billing API', number: 1100, size: null }

function page(): GitHubPage {
  const github = sampleGitHub(NOW)
  const sections = pullSections(github, [])
  return { sections: { ...sections, reviewed: [reviewedApi] }, issues: [...github.issues, elsewhere] }
}

const summary = (tabs: ReturnType<typeof projectTabs>) => tabs.map(({ slug, label, count }) => [slug, label, count])

test('the tabs are All, then each project hobkin works on, by its repository on GitHub, each with how many open pull requests and issues it holds', () => {
  // The sample: storefront has 2 reviews asked, 2 of the user's own and 5 issues; the api 1, 3 and 2; the docs 1, 1 and 2.
  assert.deepEqual(summary(projectTabs(PROJECTS, page())), [
    [null, 'All', 20],
    ['storefront', 'storefront', 9],
    ['billing-api', 'Billing API', 6],
    ['docs-site', 'docs-site', 4],
    ['quiet', 'quiet', 0],
  ])
})

test('with no project hobkin works on that is on GitHub there are no tabs, so the row does not show', () => {
  assert.deepEqual(projectTabs([], page()), [])
  assert.deepEqual(projectTabs(PROJECTS.filter(({ state, repo }) => state !== 'chosen' || !repo), page()), [])
})

test("a project's tab narrows every list to its repository, whatever the case, and All shows everything again", () => {
  const all = page()
  const tabs = projectTabs(PROJECTS, all)
  const api = pageIn(all, tabs.find(({ slug }) => slug === 'billing-api')!)

  assert.deepEqual(api.sections.requested.map(({ number }) => number), [1190])
  assert.deepEqual(api.sections.mine.map(({ number }) => number), [1187, 1186, 1185])
  assert.deepEqual(api.sections.reviewed.map(({ number }) => number), [1100], 'one the AI reviewed is matched by its review, not by its name')
  assert.deepEqual(api.issues.map(({ number }) => number), [1168, 1172])

  const quiet = pageIn(all, tabs.find(({ slug }) => slug === 'quiet')!)
  assert.deepEqual([quiet.sections.requested, quiet.sections.mine, quiet.sections.reviewed, quiet.issues], [[], [], [], []])

  assert.deepEqual(pageIn(all, tabs[0]!), all)
  assert.deepEqual(pageIn(all, null), all, 'without tabs nothing is filtered')
})

test('the others the AI reviewed are the most recent of the tab’s own, so a busy project does not crowd out a quiet one', () => {
  const reviewed = (repo: string, number: number): PullEntry => ({ ...reviewedApi, id: `pr:${repo}/${number}`, number })
  const busy = Array.from({ length: 9 }, (_, at) => reviewed('hobkin-sample/storefront', 300 + at))
  const all = { ...page(), sections: { ...page().sections, reviewed: [...busy, reviewed('hobkin-sample/api', 1100)] } }
  const tabs = projectTabs(PROJECTS, all)

  assert.deepEqual(pageIn(all, tabs[0]!, 8).sections.reviewed.map(({ number }) => number), [300, 301, 302, 303, 304, 305, 306, 307])
  assert.deepEqual(pageIn(all, tabs.find(({ slug }) => slug === 'billing-api')!, 8).sections.reviewed.map(({ number }) => number), [1100])
})

test('the chosen tab is the one remembered, and a project hobkin no longer works on falls back to All', () => {
  const tabs = projectTabs(PROJECTS, page())
  assert.equal(chosenTab(tabs, 'billing-api')?.slug, 'billing-api')
  assert.equal(chosenTab(tabs, 'quiet')?.count, 0, 'a project with nothing open can still be chosen')
  assert.equal(chosenTab(tabs, null)?.label, 'All')
  assert.equal(chosenTab(tabs, 'design-kit')?.label, 'All', 'only proposed')
  assert.equal(chosenTab(tabs, 'gone')?.label, 'All')
  assert.equal(chosenTab([], 'storefront'), null)
})
