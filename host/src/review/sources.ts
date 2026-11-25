/**
 * Where a review's change comes from: a finished hobkin branch, read with git in the project's repository, or a
 * GitHub pull request, whose words are read through gh and whose code is read with git from a checkout of it on this
 * Mac. Both only read what the user has: a pull request is fetched into hobkin's own refs. Each answers the commit the
 * change is at, cheaply, and the whole change at that commit for the review passes.
 */
import { captureChange, type SizeLimit } from '#shared/review/capture.ts'
import type { PrepareInput } from '#shared/review/draft.ts'
import { pullUrl, reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'
import type { PullOwner, ReviewStatus } from '#shared/review/status.ts'
import { SIZE_LIMIT } from '#shared/review/types.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { gitIn } from './assessment.ts'
import { githubApi, type HostApi } from './code-hosts.ts'
import type { GhCall } from './gh.ts'
import { gitReader, type GitReader } from './git.ts'
import { whosePull, type WhoIsMe } from './owner.ts'
import { pullRefs, type PullCheckout, type PullTarget, type Say } from './pull-checkout.ts'
import { pullCode } from './refresh-code.ts'

/**
 * What the review passes need, but its id. A pull request also has its description, which the review shows as it is,
 * and whose it is, which decides whether it can be merged or closed from here.
 */
export type ChangeInput = Omit<PrepareInput, 'id'> & { description?: string; owner?: PullOwner; code?: ReviewStatus['code'] }

/** What a source tells while it reads: each step, in plain words, and the change's title as soon as it knows it. */
export interface ReadWatch {
  say?: Say
  titled?: (title: string) => void
}

export interface ReviewSource {
  /** The commit the change is at now, or null when it is gone: merged, closed or deleted. */
  head(target: ReviewTarget): Promise<string | null>
  /** Where the change starts at that commit, for a source that reads it with git here. A review is built from there. */
  start?(target: ReviewTarget, head: string): Promise<string | null>
  /** The whole change at that commit. */
  read(target: ReviewTarget, head: string, watch?: ReadWatch): Promise<ChangeInput>
}

/** The spec of a change on a hobkin branch: `hobkin/<id>-<slug>` keeps it in `_specs/<id>-<slug>/spec.md`. */
export function specPathFor(branch: string | null, changed: readonly { path: string }[]): string | null {
  const named = branch?.match(/^hobkin\/(.+)$/)?.[1]
  if (named) return `_specs/${named}/spec.md`
  // Otherwise the spec the change itself wrote or changed, when there is exactly one.
  const specs = changed.map((file) => file.path).filter((path) => /^_specs\/[^/]+\/spec\.md$/.test(path))
  return specs.length === 1 ? specs[0]! : null
}

/** A finished change as the Work screen knows it. */
export interface ChangeFacts {
  project: string
  title: string
  branch: string | null
  head: string | null
  /** Its place in a stack: a layer starts at the commit under it, the bottom layer where a change always started. */
  stack?: { base: string | null }
}

/**
 * Where a finished change started: the last commit it shares with its default branch, as this machine has it or as
 * origin has it. hobkin starts a branch from origin's copy, and this machine's copy can have gone its own way: measured
 * from that one alone, a review would take in other changes origin already holds. A change one of the two already
 * holds is its own range, as `ownStart` finds it.
 */
async function startOfChange({ reader, into, head, recorded }: { reader: GitReader; into: string; head: string; recorded: string | null }): Promise<string> {
  const onOrigin = `refs/remotes/origin/${into}`
  const originHasIt = (await reader.resolve(onOrigin)) !== null
  const defaultBranches = originHasIt ? [into, onOrigin] : [into]

  const forked = await reader.mergeBase(head, ...defaultBranches)
  if (forked !== head) return forked

  // Merged already, so no commit of it is left over: the copy that holds it says where the change began.
  const heldHere = !originHasIt || (await reader.contains(into, head))
  return ownStart({ reader, into: heldHere ? into : onOrigin, head, recorded })
}

/**
 * Where a change its default branch already holds started: before the merge that brought it in; else where an earlier
 * review of it started, when that is behind it; else its own last commit, so the review always shows what it changed.
 */
async function ownStart({ reader, into, head, recorded }: { reader: GitReader; into: string; head: string; recorded: string | null }): Promise<string> {
  const before = await reader.beforeMergeOf(head, into)
  if (before) {
    const base = await reader.mergeBase(before, head)
    if (base !== head) return base
  }
  if (recorded && recorded !== head && (await reader.contains(head, recorded))) return recorded
  return (await reader.commit(head)).parent
}

/** A finished hobkin change, read with git in the project's own repository. */
export function changeSource({
  find,
  repoOf,
  baseOf,
  git = gitReader,
  vicinity,
  recorded,
}: {
  /** The change as the Work screen has it, or null when hobkin no longer lists it. */
  find: (slug: string, item: string) => ChangeFacts | null
  /** The project's repository folder. */
  repoOf: (slug: string) => string | null
  /** The branch everything starts from in a repository. */
  baseOf: (repo: string) => Promise<string>
  git?: (repo: string) => GitReader
  /** The unchanged code around the change, from a call-graph scan of the repository. Without it the review shows none. */
  vicinity?: (repo: string, base: string, head: string) => Promise<Vicinity>
  /** Where an earlier review of the change said it started, for a change its default branch already holds. */
  recorded?: (target: ReviewTarget) => string | null
}): ReviewSource {
  const where = (target: ReviewTarget) => {
    if (target.kind !== 'change') throw new Error('Not a finished change.')
    const facts = find(target.slug, target.item)
    if (!facts) throw new Error('hobkin no longer lists this change as finished.')
    const repo = repoOf(target.slug)
    if (!repo) throw new Error(`hobkin knows no folder for the project ${target.slug}.`)
    return { facts, repo, target }
  }
  const startAt = async (target: ReviewTarget, head: string) => {
    const { facts, repo } = where(target)
    if (facts.stack?.base) {
      if (!(await git(repo).contains(head, facts.stack.base))) throw new Error(`The stack base ${facts.stack.base.slice(0, 7)} is not an ancestor of ${head.slice(0, 7)}. Check the layer before reviewing it.`)
      return facts.stack.base
    }
    return startOfChange({ reader: git(repo), into: await baseOf(repo), head, recorded: recorded?.(target) ?? null })
  }
  return {
    start: startAt,
    async head(target) {
      const { facts, repo } = where(target)
      // Where its branch is now is asked of git. The card can be a commit behind, as right after an agent reworked the
      // change, and a review built from the card would be of the older code.
      const tip = facts.branch ? await git(repo).resolve(`refs/heads/${facts.branch}`) : null
      return tip ?? facts.head
    },
    async read(target, head, watch) {
      const { facts, repo, target: change } = where(target)
      const reader = git(repo)
      const base = await startAt(target, head)
      const capture = await captureChange(reader, base, head)
      const specPath = specPathFor(facts.branch, capture.files)
      const specText = specPath ? await reader.text(head, specPath) : null
      if (vicinity) watch?.say?.('Mapping the callers and callees.')
      const around = vicinity ? await vicinity(repo, base, head) : undefined
      return {
        change: { project: facts.project, item: change.kind === 'change' ? change.item : '', title: facts.title, branch: facts.branch ?? head.slice(0, 12) },
        capture,
        spec: specPath && specText != null ? { path: specPath, text: specText } : null,
        readHead: (path) => reader.text(head, path),
        ...(around ? { vicinity: around } : {}),
      }
    },
  }
}

const SHA = /^[0-9a-f]{40}$/

/** The commits a pull request spans as its host says now, and where it starts once that is known. */
interface PullRange {
  head: string
  /** The tip of the branch it merges into. GitHub always says it; a named host may not. */
  tip?: string
  /** That branch, by name, which a named host's clone here fetches. */
  ref?: string
  base?: string
}

/** A pull request's range, or null when its host does not say enough of it: GitHub its base's tip, a named host its base branch. */
function rangeOf(pull: PullTarget, head: string | null | undefined, base?: { sha?: string; ref?: string }): PullRange | null {
  const tip = base?.sha && SHA.test(base.sha) ? base.sha : undefined
  const ref = base?.ref || undefined
  if (!head || !SHA.test(head) || (pull.host ? !ref : !tip)) return null
  return { head, tip, ref }
}

/**
 * A pull request: its title, description and branches read with GET requests only, through gh on GitHub or through
 * the API command of the code host it lives on, and its code from a checkout of it on this Mac, where the review's
 * tests can run.
 */
export function pullSource({
  gh,
  apiOf = () => null,
  canCheckOut = () => true,
  checkout,
  vicinity,
  limit = SIZE_LIMIT,
  whoIsMe,
}: {
  gh: GhCall
  /** The API of a pull request on a named code host, or null for one on GitHub, which gh answers. */
  apiOf?: (target: PullTarget) => HostApi | null
  /** Whether a review may check the pull request's repository out. One that may not gets no call-graph scan. */
  canCheckOut?: (target: PullTarget) => boolean
  /** Where its code comes from. Without one, a pull request is not read. */
  checkout?: PullCheckout
  /** Who the user is on the pull request's host, to say whose it is. Without it, their login there, and nothing more. */
  whoIsMe?: (target: PullTarget) => Promise<WhoIsMe>
  /** The unchanged code around the change, from a call-graph scan of a checkout at `head`. Without it the review shows none. */
  vicinity?: (target: PullTarget, repo: string, base: string, head: string, say?: Say) => Promise<Vicinity>
  limit?: SizeLimit
}): ReviewSource {
  const github = githubApi(gh)
  // A retargeted PR can keep the same head, so its range is its head and its base, by tip and by branch, under its review's name.
  const ranges = new Map<string, PullRange>()
  /** A read on the pull request's own host. */
  const read = (target: PullTarget) => async <Value>(path: string): Promise<Value> => JSON.parse(await (apiOf(target) ?? github)({ path })) as Value
  // Who the user is, when it cannot be said, leaves every pull request someone else's: nothing is merged or closed on a guess.
  const me = async (target: PullTarget): Promise<WhoIsMe> => {
    try {
      return whoIsMe ? await whoIsMe(target) : { viewer: (await read(target)<{ login?: string }>('user')).login ?? null }
    } catch {
      return { viewer: null }
    }
  }
  const pullOf = (target: ReviewTarget): PullTarget => {
    if (target.kind !== 'pull') throw new Error('Not a pull request.')
    return target
  }

  return {
    async head(target) {
      const pull = pullOf(target)
      const answer = await read(pull)<{ state?: string; head?: { sha?: string }; base?: { sha?: string; ref?: string } }>(`repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`)
      const head = answer.state === 'open' ? answer.head?.sha : null
      const key = reviewIdOf(pull)
      const range = rangeOf(pull, head, answer.base)
      const seen = ranges.get(key)
      if (!range) ranges.delete(key)
      else if (seen?.head !== range.head || seen.tip !== range.tip || seen.ref !== range.ref) ranges.set(key, range)
      return head ?? null
    },
    async start(target, head) {
      const pull = pullOf(target)
      const seen = ranges.get(reviewIdOf(pull))
      if (!seen || seen.head !== head) return null
      if (seen.base) return seen.base
      if (pull.host) {
        // A named host is asked nothing more: its clone here fetches the branch it merges into and meets it with the head.
        const base = (await checkout?.start?.(pull, { head, baseBranch: seen.ref! })) ?? null
        if (base) seen.base = base
        return base
      }
      const compared = await read(pull)<{ merge_base_commit?: { sha?: string } }>(`repos/${pull.owner}/${pull.repo}/compare/${seen.tip}...${head}?per_page=1`)
      const base = compared.merge_base_commit?.sha
      if (!base || !SHA.test(base)) throw new Error(`GitHub did not identify the merge base of #${pull.number}.`)
      seen.base = base
      return base
    },
    async read(target, head, watch = {}) {
      const pull = pullOf(target)
      if (!checkout) throw new Error('This host checks out no pull requests, so it cannot read one.')
      const say = watch.say ?? (() => {})
      say(`Reading #${pull.number} on ${pull.host ?? 'GitHub'}.`)
      const details = await read(pull)<{ title: string; body?: string | null; base: { ref: string; sha?: string }; head: { ref: string; sha?: string }; user?: { login?: string } | null; mergeable?: boolean | null; mergeable_state?: string }>(`repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`)
      if (details.head.sha && details.head.sha !== head) throw new Error(`#${pull.number} moved while its details were read. Start its review again.`)
      watch.titled?.(details.title)
      const { repo, base } = await checkout.fetch(pull, { head, baseBranch: details.base.ref, headBranch: details.head.ref }, say)
      const range = rangeOf(pull, head, details.base)
      if (range) ranges.set(reviewIdOf(pull), { ...range, base })
      // How far behind its base the pull request is, counted in the checkout this read already made.
      const behind = await gitIn(repo, 'rev-list', '--count', `${head}..${pullRefs(pull).base}`).then((count) => Number.parseInt(count, 10), () => null)
      const reader = gitReader(repo)
      say('Reading the changed files.')
      const capture = await captureChange(reader, base, head, limit)
      const specPath = specPathFor(details.head.ref, capture.files)
      const specText = specPath ? await reader.text(head, specPath) : null
      // A host that allows no checkout gets no call-graph scan, which reads a checkout.
      const around = vicinity && canCheckOut(pull) ? await vicinity(pull, repo, base, head, say) : undefined
      // GitHub writes its lines with \r\n.
      const description = (details.body ?? '').replace(/\r\n?/g, '\n').trim()
      return {
        change: { project: `${pull.owner}/${pull.repo}`, item: `#${pull.number}`, title: details.title, branch: details.head.ref },
        description,
        owner: whosePull({ author: details.user?.login ?? null, description }, await me(pull)),
        code: pullCode(details, Number.isSafeInteger(behind) ? behind : null, details.base.ref),
        capture,
        spec: specPath && specText != null ? { path: specPath, text: specText } : null,
        readHead: (path) => reader.text(head, path),
        ...(around ? { vicinity: around } : {}),
      }
    },
  }
}

/** The address a pull request review is about, for the words the screen shows. */
export const pullAddress = pullUrl
