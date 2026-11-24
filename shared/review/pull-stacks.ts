import type { PullRequest } from '../protocol/pulls.ts'
import type { StackPlace } from '../protocol/work.ts'

/**
 * Which open pull request sits on which. A pull request whose base branch is another open pull request's head branch,
 * in the same repository, is the layer over it; the bottom is one whose base is no listed pull request's head. Each
 * stacked pull request gets its place in Work's own shape for a layer (`StackPlace`), so the app draws a stack of pull
 * requests as it draws one of finished changes. Pure, so it is tested without a window. Specs: 024-github, 060-make-it-a-stack.
 *
 * What the lists hold is all there is to go on: a layer missing from them breaks the chain where it was, and the
 * layers here are counted from what is listed. Bad data stacks nothing: a pull request whose bases come round in a
 * loop, and one on a branch that two pull requests share, sit on none.
 */

/** A repository's branch: GitHub ignores the case of `owner/name`, never a branch's. */
const branchKey = (repo: string, branch: string) => `${repo.toLowerCase()}\n${branch}`

const byNumber = (a: PullRequest, b: PullRequest) => a.number - b.number

/**
 * Each stacked pull request's place, by its address: its layer counted from 1 at the bottom, of how many, and the one
 * under it. Two on one stay one stack, each after the one it sits on, the one opened first first. A pull request in no
 * stack has no place. A stack is named by its bottom's address, and has no name of its own.
 */
export function pullStacks(pulls: readonly PullRequest[]): Map<string, StackPlace> {
  const listed = [...new Map(pulls.map((pull) => [pull.url, pull])).values()]

  const onBranch = new Map<string, PullRequest[]>()
  for (const pull of listed) {
    if (!pull.headBranch) continue
    const key = branchKey(pull.repo, pull.headBranch)
    onBranch.set(key, [...(onBranch.get(key) ?? []), pull])
  }

  /** The one it sits on: the only other pull request whose head is its base. */
  const under = new Map<PullRequest, PullRequest>()
  for (const pull of listed) {
    if (!pull.baseBranch) continue
    const found = (onBranch.get(branchKey(pull.repo, pull.baseBranch)) ?? []).filter((other) => other !== pull)
    if (found.length === 1) under.set(pull, found[0]!)
  }

  /** Walking down from it reaches a bottom, and does not come round to where it has been. */
  const grounded = (pull: PullRequest): boolean => {
    const seen = new Set<PullRequest>()
    for (let at: PullRequest | undefined = pull; at; at = under.get(at)) {
      if (seen.has(at)) return false
      seen.add(at)
    }
    return true
  }

  const over = new Map<PullRequest, PullRequest[]>()
  for (const [pull, below] of under) {
    if (grounded(pull)) over.set(below, [...(over.get(below) ?? []), pull])
  }

  const places = new Map<string, StackPlace>()
  for (const bottom of listed) {
    if (under.has(bottom) || !over.has(bottom)) continue
    // Bottom first, each layer straight after the one it sits on.
    const layers: PullRequest[] = []
    const walk = (pull: PullRequest) => {
      layers.push(pull)
      for (const next of [...(over.get(pull) ?? [])].sort(byNumber)) walk(next)
    }
    walk(bottom)
    layers.forEach((pull, at) => {
      const below = under.get(pull) ?? null
      places.set(pull.url, { id: bottom.url, layer: at + 1, of: layers.length, name: null, below: below?.url ?? null, base: below?.head ?? null })
    })
  }
  return places
}
