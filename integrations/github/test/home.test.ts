import assert from 'node:assert/strict'
import test from 'node:test'
import type { GitHubPull, GitHubState } from '#shared/protocol/github.ts'
import { githubHome } from '../window/home.ts'

const iso = new Date(2026, 10, 12, 18).toISOString()
const quiet: GitHubState = {
  connection: 'unknown', login: null, reviews: [], pulls: [], issues: [],
  more: { reviews: false, pulls: false, issues: false }, refreshedAt: null, refreshing: false, error: null, sample: false,
}
const pull = (number: number, rest: Partial<GitHubPull> = {}): GitHubPull => ({
  repo: 'org/app', number, title: `PR ${number}`, labels: [], updatedAt: iso, url: `https://github.com/org/app/pull/${number}`,
  draft: false, author: 'user', review: 'waiting', checks: 'passing', ...rest,
})

test('GitHub adds a need and a card for each review waiting on the user, and a card for each of their own pull requests whose checks fail, only when connected', () => {
  const github = { ...quiet, connection: 'connected' as const, reviews: [pull(1), pull(2, { review: 'approved' })], pulls: [pull(3, { checks: 'failing' }), pull(4)] }
  const home = githubHome(github)
  assert.equal(home.known, true)
  assert.equal(home.lift, 1)
  assert.deepEqual(home.needs?.map(({ row }) => [row.id, row.action]), [['github:org/app#1', { label: 'Review', target: { to: 'pull', url: pull(1).url } }]])
  assert.deepEqual(home.needs?.map(({ card }) => card.id), ['github:org/app#1'])
  assert.deepEqual(home.cards?.map((card) => [card.id, card.primary.target]), [['github:org/app#3', { to: 'url', url: pull(3).url }]])
  assert.equal(home.more, false)

  const signedOut = githubHome({ ...github, connection: 'signed-out' })
  assert.equal(signedOut.known, true)
  assert.deepEqual([signedOut.needs, signedOut.cards, signedOut.lift], [undefined, undefined, undefined])
})

test("GitHub's tile says how gh stands, and has none before the host has said anything", () => {
  assert.equal(githubHome(quiet).known, false)
  assert.equal(githubHome(quiet).tile, undefined)
  const tile = githubHome({ ...quiet, connection: 'connected', login: 'octo' }).tile
  assert.deepEqual([tile?.status, tile?.tone, tile?.note, tile?.target], ['Connected', 'ok', '@octo', { to: 'screen', screen: 'github' }])
  assert.equal(githubHome({ ...quiet, connection: 'missing' }).tile?.status, 'Not installed')
})

test('a list GitHub cut short makes the count of reviews "at least"', () => {
  assert.equal(githubHome({ ...quiet, connection: 'connected', more: { reviews: true, pulls: false, issues: false } }).more, true)
})
