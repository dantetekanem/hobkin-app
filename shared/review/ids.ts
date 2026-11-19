/**
 * What a review is about, and its name. A finished hobkin change is named by its project and item, a pull request by
 * its repository and number, and, on a code host the home names other than GitHub, by that host too. A GitHub pull
 * request keeps the names it always had. The name is what the UI opens and what the host caches under.
 */

export type ReviewTarget = { kind: 'change'; slug: string; item: string } | { kind: 'pull'; owner: string; repo: string; number: number; host?: string }

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const ITEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
/** A named code host's short name. GitHub's own is never one. */
export const HOST_NAME = /^(?!github$)[a-z][a-z0-9-]{0,31}$/

/** A code host the home names, as far as names and pages go: its short name and its web address, with no trailing slash. */
export interface NamedCodeHost {
  name: string
  web: string
}

let named: readonly NamedCodeHost[] = []

/** The code hosts the home names now, so their pull request pages read as reviews here. The host and the window each learn them. */
export function learnCodeHosts(hosts: readonly NamedCodeHost[]): void {
  named = hosts.filter((host) => HOST_NAME.test(host.name)).map((host) => ({ name: host.name, web: host.web.replace(/\/+$/, '') }))
}

/** A named code host by its short name, or undefined when this side does not know it. */
export const codeHostOf = (name: string): NamedCodeHost | undefined => named.find((host) => host.name === name)

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function reviewIdOf(target: ReviewTarget): string {
  if (target.kind === 'change') return `change:${target.slug}:${target.item}`
  return `pr:${target.host ? `${target.host}:` : ''}${target.owner}/${target.repo}/${target.number}`
}

/**
 * The target a review name stands for, or null for a name that is not one. A pull request's page on github.com, or on
 * a code host the home names, reads as its review. An id reads by its shape alone, so it is never misread before its
 * host is learned.
 */
export function targetOfReviewId(id: string): ReviewTarget | null {
  const change = /^change:([^:]+):([^:]+)$/.exec(id)
  if (change) return SLUG.test(change[1]!) && ITEM.test(change[2]!) ? { kind: 'change', slug: change[1]!, item: change[2]! } : null
  let host: string | undefined
  let pull = /^pr:(?:([^:/]+):)?([^/]+)\/([^/]+)\/(\d{1,9})$/.exec(id)?.slice(1) ?? null
  if (pull) host = pull[0]
  else {
    pull = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d{1,9})(?:[/?#].*)?$/.exec(id)?.slice(0) ?? null
    for (const known of pull ? [] : named) {
      const page = new RegExp(`^${escaped(known.web)}\\/([^/]+)\\/([^/]+)\\/pull\\/(\\d{1,9})(?:[/?#].*)?$`, 'i').exec(id)
      if (page) {
        pull = page
        host = known.name
        break
      }
    }
  }
  if (!pull || (host !== undefined && !HOST_NAME.test(host))) return null
  const [owner, repo, number] = [pull[1]!, pull[2]!, pull[3]!]
  // The hosts' names do not care about case, so one pull request has one name however it is written.
  if (!NAME.test(owner) || !NAME.test(repo) || owner.includes('..') || repo.includes('..')) return null
  return { kind: 'pull', ...(host ? { host } : {}), owner: owner.toLowerCase(), repo: repo.toLowerCase(), number: Number(number) }
}

/** The folder a review keeps its files in, under the home. `+` is in none of the names, so one target is always one folder. */
export function reviewFolder(target: ReviewTarget): string {
  if (target.kind === 'change') return `change+${target.slug}+${target.item}`
  return `pr+${target.host ? `${target.host}+` : ''}${target.owner}+${target.repo}+${target.number}`
}

/** The target a review folder is named for, or null for a folder that is not one. */
export function targetOfReviewFolder(name: string): ReviewTarget | null {
  const parts = name.split('+')
  const pull = parts[0] === 'pr' && (parts.length === 4 || parts.length === 5) ? parts.slice(1) : null
  const id =
    parts[0] === 'change' && parts.length === 3
      ? `change:${parts[1]}:${parts[2]}`
      : pull
        ? `pr:${pull.length === 4 ? `${pull[0]}:` : ''}${pull.slice(-3).join('/')}`
        : null
  const target = id ? targetOfReviewId(id) : null
  // Only a name that comes back as itself: a folder these rules would not have made is no review's.
  return target && reviewFolder(target) === name ? target : null
}

/** A pull request's page: on github.com, or on the named code host it lives on. Null for a host this side does not know. */
export function pullUrl(target: Extract<ReviewTarget, { kind: 'pull' }>): string | null {
  const web = target.host ? codeHostOf(target.host)?.web : 'https://github.com'
  return web ? `${web}/${target.owner}/${target.repo}/pull/${target.number}` : null
}
