import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { PullRequest } from '#shared/protocol/pulls.ts'
import type { StackPlace } from '#shared/protocol/work.ts'
import { pullStacks } from '#shared/review/pull-stacks.ts'

/** A pull request in `octo/app` unless said, on `base` with its own branch `head`. */
function pull(number: number, base: string | null, head: string | null, rest: Partial<PullRequest> = {}): PullRequest {
  const repo = rest.repo ?? 'octo/app'
  return {
    repo,
    number,
    title: `Pull ${number}`,
    labels: [],
    updatedAt: '2026-11-24T09:00:00Z',
    url: `https://github.com/${repo}/pull/${number}`,
    draft: false,
    author: 'mira',
    review: 'none',
    checks: 'none',
    head: String(number).padStart(40, '0'),
    ...(base === null ? {} : { baseBranch: base }),
    ...(head === null ? {} : { headBranch: head }),
    ...rest,
  }
}

/** Each stacked pull request by its number: its layer, of how many, and the number of the one under it. */
function summary(places: ReadonlyMap<string, StackPlace>): Record<number, [number, number, number | null]> {
  const numberOf = (url: string | null) => (url === null ? null : Number(url.split('/').at(-1)))
  return Object.fromEntries([...places].map(([url, place]) => [numberOf(url), [place.layer, place.of, numberOf(place.below)]]))
}

test('a chain of 2 to 5 is one stack, bottom first, whatever order the lists hold it in', () => {
  for (let size = 2; size <= 5; size++) {
    const chain = Array.from({ length: size }, (_, at) => pull(10 + at, at === 0 ? 'main' : `layer-${at}`, `layer-${at + 1}`))
    const places = pullStacks([...chain].reverse())

    assert.deepEqual(
      summary(places),
      Object.fromEntries(chain.map(({ number }, at) => [number, [at + 1, size, at === 0 ? null : number - 1]])),
      `a chain of ${size}`,
    )
    const bottom = chain[0]!
    assert.ok([...places.values()].every(({ id, name }) => id === bottom.url && name === null), 'the stack is named by its bottom, and has no name of its own')
    assert.equal(places.get(bottom.url)?.base, null)
    assert.equal(places.get(chain[1]!.url)?.base, bottom.head, "a layer's own change starts at the commit the one under it is at")
  }
})

test('two on one keep the stack together: each comes after the one it sits on, the one opened first first, and says which it sits on', () => {
  const places = pullStacks([pull(1, 'main', 'base'), pull(3, 'base', 'right'), pull(2, 'base', 'left'), pull(4, 'left', 'left-top')])
  assert.deepEqual(summary(places), { 1: [1, 4, null], 2: [2, 4, 1], 4: [3, 4, 2], 3: [4, 4, 1] })
})

test('a loop in bad data stacks nothing on it, and a sound chain beside it still stacks', () => {
  const places = pullStacks([
    pull(1, 'b', 'a'),
    pull(2, 'a', 'b'),
    // On the loop, so it has no bottom either.
    pull(3, 'a', 'c'),
    // Its own head as its base sits on nothing.
    pull(4, 'same', 'same'),
    pull(5, 'main', 'sound'),
    pull(6, 'sound', 'sound-top'),
  ])
  assert.deepEqual(summary(places), { 5: [1, 2, null], 6: [2, 2, 5] })
})

test("a branch only matches in its own repository, whatever the case of its name, and a branch two pull requests share is no one's base", () => {
  const places = pullStacks([
    pull(1, 'main', 'feature', { repo: 'octo/app' }),
    pull(2, 'feature', 'feature-top', { repo: 'octo/site' }),
    pull(3, 'feature', 'feature-next', { repo: 'Octo/App' }),
    // A fork's head never reaches the window, so nothing sits on it.
    pull(4, 'main', null),
    // Two of them on one branch: the one based on it sits on neither.
    pull(5, 'main', 'shared'),
    pull(6, 'release', 'shared'),
    pull(7, 'shared', 'over-shared'),
  ])
  assert.deepEqual(summary(places), { 1: [1, 2, null], 3: [2, 2, 1] })
})

test('a layer missing from the lists breaks the chain where it was, and the layers here are counted from what is listed', () => {
  // 2 sat on 1 and 3 on 2. 2 merged or is not listed, so 3 is a bottom with one layer on it.
  const places = pullStacks([pull(1, 'main', 'one'), pull(3, 'two', 'three'), pull(4, 'three', 'four')])
  assert.deepEqual(summary(places), { 3: [1, 2, null], 4: [2, 2, 3] })
})

test('a pull request on its own, one without branch names, and one listed twice are no stack', () => {
  const one = pull(1, 'main', 'one')
  assert.deepEqual(summary(pullStacks([one, pull(2, null, null), pull(3, 'main', 'three')])), {})
  assert.deepEqual(summary(pullStacks([one, one, pull(2, 'one', 'two')])), { 1: [1, 2, null], 2: [2, 2, 1] }, 'once, though both lists hold it')
  assert.deepEqual(summary(pullStacks([])), {})
})
