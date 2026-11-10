/**
 * What a review is about, and its name. A finished hobkin change is named by its project and item, a GitHub pull
 * request by its repository and number. The name is what the UI opens and what the host caches under.
 */

export type ReviewTarget = { kind: 'change'; slug: string; item: string } | { kind: 'pull'; owner: string; repo: string; number: number }

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/

export function reviewIdOf(target: ReviewTarget): string {
  return target.kind === 'change' ? `change:${target.slug}:${target.item}` : `pr:${target.owner}/${target.repo}/${target.number}`
}

/** The target a review name stands for, or null for a name that is not one. A pull request's page on github.com reads as its review. */
export function targetOfReviewId(id: string): ReviewTarget | null {
  const change = /^change:([^:]+):([^:]+)$/.exec(id)
  if (change) return SLUG.test(change[1]!) && ITEM.test(change[2]!) ? { kind: 'change', slug: change[1]!, item: change[2]! } : null
  const pull = /^pr:([^/]+)\/([^/]+)\/(\d{1,9})$/.exec(id) ?? /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d{1,9})(?:[/?#].*)?$/.exec(id)
  // GitHub's names do not care about case, so one pull request has one name however it is written.
  if (pull && NAME.test(pull[1]!) && NAME.test(pull[2]!) && !pull[1]!.includes('..') && !pull[2]!.includes('..')) return { kind: 'pull', owner: pull[1]!.toLowerCase(), repo: pull[2]!.toLowerCase(), number: Number(pull[3]) }
  return null
}

/** The folder a review keeps its files in, under the home. `+` is in none of the names, so one target is always one folder. */
export function reviewFolder(target: ReviewTarget): string {
  return target.kind === 'change' ? `change+${target.slug}+${target.item}` : `pr+${target.owner}+${target.repo}+${target.number}`
}

/** A pull request's page on github.com. */
export function pullUrl(target: Extract<ReviewTarget, { kind: 'pull' }>): string {
  return `https://github.com/${target.owner}/${target.repo}/pull/${target.number}`
}
