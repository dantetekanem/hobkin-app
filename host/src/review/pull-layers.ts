import type { HostApi } from './code-hosts.ts'

/** A pull request listed by GitHub, as far as its place in a stack goes. */
interface Listed {
  number?: number
  head?: { ref?: string; repo?: { full_name?: string } | null }
  base?: { ref?: string }
}

/** Where a pull request sits among the open pull requests of its repository that are stacked with it. */
export interface PullLayers {
  /** The open pull requests it sits on, bottom first. */
  below: number[]
  /** How many layers the stack has, as far as the open pull requests say. */
  of: number
}

/**
 * The open pull requests under a pull request and over it, found by branch name: the one whose head is its base is the layer
 * under it, and the one whose base is its head is the layer over it. A branch two pull requests share, a head in another
 * repository, and a branch met twice end the walk there, so bad data stacks nothing. Reads only.
 */
export async function pullLayers(api: HostApi, { owner, repo, base, head, defaultBranch }: { owner: string; repo: string; base: string; head: string; defaultBranch: string }): Promise<PullLayers> {
  const only = async (key: 'head' | 'base', branch: string): Promise<Listed | null> => {
    const found = JSON.parse(await api({ path: `repos/${owner}/${repo}/pulls?state=open&${key}=${encodeURIComponent(key === 'head' ? `${owner}:${branch}` : branch)}` })) as Listed[]
    const here = found.filter((pull) => key === 'base' || !pull.head?.repo?.full_name || pull.head.repo.full_name.toLowerCase() === `${owner}/${repo}`.toLowerCase())
    return here.length === 1 && typeof here[0]!.number === 'number' ? here[0]! : null
  }
  const seen = new Set([head, base])
  const below: number[] = []
  for (let at = base; at !== defaultBranch; ) {
    const pull = await only('head', at)
    if (!pull?.base?.ref || seen.has(pull.base.ref)) break
    below.unshift(pull.number!)
    seen.add(pull.base.ref)
    at = pull.base.ref
  }
  let over = 0
  for (let at = head; ; ) {
    const pull = await only('base', at)
    const next = pull?.head?.ref
    if (!next || seen.has(next)) break
    over += 1
    seen.add(next)
    at = next
  }
  return { below, of: below.length + 1 + over }
}

/** "#480", "#480 and #481", "#480, #481 and #482". */
export function layerNames(numbers: readonly number[]): string {
  const names = numbers.map((number) => `#${number}`)
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}
