import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sampleGitHub, type GitHubIssue, type GitHubPull } from '../protocol.ts'
import { pullStacks } from '#shared/review/pull-stacks.ts'
import { arrangePulls, elsewhereWords, orderIssues, stackHeading, type PullUnit } from '../window/page-order.ts'
import { pageIn } from '../window/project-filter.ts'
import { pullSections, type PullEntry } from '../window/pull-reviews.ts'

const NOW = Date.parse('2026-11-24T12:00:00Z')
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

function pull(number: number, minutes: number, branches: { base?: string; head?: string } = {}, rest: Partial<GitHubPull> = {}): GitHubPull {
  return {
    repo: 'octo/app',
    number,
    title: `Pull ${number}`,
    labels: [],
    updatedAt: ago(minutes),
    url: `https://github.com/octo/app/pull/${number}`,
    draft: false,
    author: 'mira',
    review: 'none',
    checks: 'none',
    baseBranch: branches.base ?? 'main',
    headBranch: branches.head ?? `topic-${number}`,
    ...rest,
  }
}

const issue = (number: number, minutes: number): GitHubIssue => ({ repo: 'octo/app', number, title: `Issue ${number}`, labels: [], updatedAt: ago(minutes), url: `https://github.com/octo/app/issues/${number}`, assigned: true, authored: false })

/** A pull request the AI reviewed that GitHub no longer lists: it has no time of GitHub's, only its place in the list. */
const reviewed = (number: number): PullEntry => ({ id: `pr:octo/app/${number}`, pull: null, ai: { state: 'none' }, title: `Merged ${number}`, repo: 'octo/app', number, size: null })

/** Each unit by its numbers: one for a pull request on its own, the layers bottom first for a stack. */
const numbers = (units: readonly PullUnit[]) => units.map((unit) => (unit.kind === 'stack' ? unit.layers.map(({ entry }) => entry.number) : unit.entry.number))

/** A stack of three, 1185 at the bottom: its oldest layer is the bottom and its newest the top. */
const stack = [pull(1185, 310, { head: 'limits' }), pull(1186, 240, { base: 'limits', head: 'counts' }), pull(1187, 45, { base: 'counts', head: 'headers' })]

function page(reviews: GitHubPull[], pulls: GitHubPull[], others: PullEntry[] = []) {
  const sections = pullSections({ reviews, pulls }, [])
  return { sections: { ...sections, reviewed: others }, places: pullStacks([...reviews, ...pulls]) }
}

test('Newest is GitHub’s own order, the most recently updated first, and Oldest the other way, in every list and for issues', () => {
  const { sections, places } = page([pull(7, 5), pull(8, 50), pull(9, 500)], [pull(3, 20), pull(4, 2000)], [reviewed(1), reviewed(2)])

  const newest = arrangePulls(sections, places, 'newest')
  assert.deepEqual([numbers(newest.requested), numbers(newest.mine), numbers(newest.reviewed)], [[7, 8, 9], [3, 4], [1, 2]])
  const oldest = arrangePulls(sections, places, 'oldest')
  assert.deepEqual([numbers(oldest.requested), numbers(oldest.mine), numbers(oldest.reviewed)], [[9, 8, 7], [4, 3], [2, 1]], 'the others reviewed, which GitHub no longer lists, turn round as they came')

  const issues = [issue(12, 30), issue(11, 300), issue(10, 3)]
  assert.deepEqual(orderIssues(issues, 'newest').map(({ number }) => number), [10, 12, 11])
  assert.deepEqual(orderIssues(issues, 'oldest').map(({ number }) => number), [11, 12, 10])
  assert.deepEqual(issues.map(({ number }) => number), [12, 11, 10], 'the list it was given stays as it was')
})

test('a stack keeps its layers together, bottom first, and sorts by its newest layer under Newest and its oldest under Oldest', () => {
  // GitHub lists them newest first, so the stack comes in out of order and apart.
  const { sections, places } = page([], [stack[2]!, pull(479, 120), stack[1]!, stack[0]!, pull(470, 2900)])

  assert.deepEqual(numbers(arrangePulls(sections, places, 'newest').mine), [[1185, 1186, 1187], 479, 470], 'its newest layer was updated 45 minutes ago')
  assert.deepEqual(numbers(arrangePulls(sections, places, 'oldest').mine), [470, [1185, 1186, 1187], 479], 'its oldest layer was updated 310 minutes ago')

  const [unit] = arrangePulls(sections, places, 'newest').mine
  assert.equal(unit?.kind, 'stack')
  if (unit?.kind !== 'stack') return
  assert.deepEqual(unit.layers.map(({ place, under }) => [place.layer, place.of, under]), [[1, 3, null], [2, 3, 1], [3, 3, 2]])
  assert.deepEqual([unit.key, unit.base, unit.elsewhere], [`stack:${stack[0]!.url}`, 'main', []])
  assert.equal(stackHeading(unit), 'Stack of 3 on main')
})

test('a pull request in no stack is one unit with no place, as before', () => {
  const { sections, places } = page([pull(7, 5)], [])
  const [unit] = arrangePulls(sections, places, 'newest').requested
  assert.deepEqual(unit && unit.kind === 'pull' ? [unit.key, unit.place, unit.elsewhere] : null, [pull(7, 5).url, null, []])
})

test('a stack the page holds in two lists keeps its count, and each list says plainly where its other layers are', () => {
  // The user's own bottom, and two layers a colleague put on it that ask for the user's review.
  const { sections, places } = page([stack[2]!, stack[1]!], [stack[0]!, pull(479, 120)])
  const { requested, mine } = arrangePulls(sections, places, 'newest')

  assert.deepEqual(numbers(requested), [[1186, 1187]])
  const over = requested[0]!
  assert.ok(over.kind === 'stack')
  assert.deepEqual(over.layers.map(({ place }) => `${place.layer} of ${place.of}`), ['2 of 3', '3 of 3'])
  assert.equal(stackHeading(over), 'Stack of 3 on main · Layer 1 is under Your pull requests.')

  // One layer alone in its list is a card of its own, with its place, and says where the rest are.
  assert.deepEqual(numbers(mine), [479, 1185])
  const bottom = mine[1]!
  assert.ok(bottom.kind === 'pull')
  assert.deepEqual([bottom.place?.layer, bottom.place?.of, bottom.elsewhere], [1, 3, [{ layer: 2, list: 'requested' }, { layer: 3, list: 'requested' }]])
  assert.equal(elsewhereWords(bottom.elsewhere), 'Layers 2 and 3 are under Review requested.')
  assert.equal(elsewhereWords([{ layer: 1, list: 'mine' }, { layer: 2, list: 'mine' }, { layer: 4, list: 'mine' }]), 'Layers 1, 2 and 4 are under Your pull requests.')
  assert.equal(elsewhereWords([]), null)
})

test('the heading of a stack whose bottom GitHub did not say the base of names no branch', () => {
  const { sections, places } = page([], [pull(2, 5, { base: 'one', head: 'two' }), pull(3, 4, { base: 'two', head: 'three' })])
  const [unit] = arrangePulls(sections, places, 'newest').mine
  assert.ok(unit?.kind === 'stack')
  assert.equal(stackHeading(unit), 'Stack of 2 on one', 'a bottom here that sits on a branch no listed pull request has says that branch')
  assert.equal(stackHeading({ ...unit, base: null }), 'Stack of 2')
})

test('the sample, which the page shows with no host, holds a stack of three of the user’s own and one of two among the review requests', () => {
  const github = sampleGitHub(NOW)
  const { requested, mine } = arrangePulls(pullSections(github, []), pullStacks([...github.reviews, ...github.pulls]), 'newest')
  assert.deepEqual(numbers(requested), [[482, 484], 1190, 77])
  assert.deepEqual(numbers(mine), [[1185, 1186, 1187], 479, 470, 71])
  assert.deepEqual(numbers(arrangePulls(pullSections(github, []), pullStacks([...github.reviews, ...github.pulls]), 'oldest').mine), [71, 470, [1185, 1186, 1187], 479])
})

test('under a project tab a stack stays whole, as all its layers are in one repository', () => {
  const github = sampleGitHub(NOW)
  const page = pageIn({ sections: pullSections(github, []), issues: github.issues }, { slug: 'billing-api', label: 'Billing API', repo: 'hobkin-sample/api', count: 6 })
  const places = pullStacks([...github.reviews, ...github.pulls])
  assert.deepEqual(numbers(arrangePulls(page.sections, places, 'newest').mine), [[1185, 1186, 1187]])
  assert.deepEqual(numbers(arrangePulls(page.sections, places, 'oldest').requested), [1190])
})
