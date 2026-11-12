/**
 * Where a review's change comes from: a finished hobkin branch, read with git in the project's repository, or a
 * GitHub pull request, whose words are read through gh and whose code is read with git from a checkout of it on this
 * Mac. Both only read what the user has: a pull request is fetched into hobkin's own refs. Each answers the commit the
 * change is at, cheaply, and the whole change at that commit for the review passes.
 */
import { captureChange, type SizeLimit } from '#shared/review/capture.ts'
import type { PrepareInput } from '#shared/review/draft.ts'
import { pullUrl, type ReviewTarget } from '#shared/review/ids.ts'
import { SIZE_LIMIT } from '#shared/review/types.ts'
import type { Vicinity } from '#shared/review/vicinity.ts'
import { ghText, type GhCall } from './gh.ts'
import { gitReader, type GitReader } from './git.ts'
import type { PullCheckout, PullTarget, Say } from './pull-checkout.ts'

/** What the review passes need, but its id. A pull request also has its description, which the review shows as it is. */
export type ChangeInput = Omit<PrepareInput, 'id'> & { description?: string }

/** What a source tells while it reads: each step, in plain words, and the change's title as soon as it knows it. */
export interface ReadWatch {
  say?: Say
  titled?: (title: string) => void
}

export interface ReviewSource {
  /** The commit the change is at now, or null when it is gone: merged, closed or deleted. */
  head(target: ReviewTarget): Promise<string | null>
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
}

/** A finished hobkin change, read with git in the project's own repository. */
export function changeSource({
  find,
  repoOf,
  baseOf,
  git = gitReader,
  vicinity,
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
}): ReviewSource {
  const where = (target: ReviewTarget) => {
    if (target.kind !== 'change') throw new Error('Not a finished change.')
    const facts = find(target.slug, target.item)
    if (!facts) throw new Error('hobkin no longer lists this change as finished.')
    const repo = repoOf(target.slug)
    if (!repo) throw new Error(`hobkin knows no folder for the project ${target.slug}.`)
    return { facts, repo, target }
  }
  return {
    async head(target) {
      const { facts, repo } = where(target)
      if (facts.head) return facts.head
      return facts.branch ? git(repo).resolve(facts.branch) : null
    },
    async read(target, head, watch) {
      const { facts, repo, target: change } = where(target)
      const reader = git(repo)
      const base = await reader.mergeBase(await baseOf(repo), head)
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

/**
 * A GitHub pull request: its title, description and branches read through gh with GET requests only, and its code
 * from a checkout of it on this Mac, where the review's tests can run.
 */
export function pullSource({
  gh,
  checkout,
  vicinity,
  limit = SIZE_LIMIT,
}: {
  gh: GhCall
  /** Where its code comes from. Without one, a pull request is not read. */
  checkout?: PullCheckout
  /** The unchanged code around the change, from a call-graph scan of a checkout at `head`. Without it the review shows none. */
  vicinity?: (target: PullTarget, repo: string, base: string, head: string, say?: Say) => Promise<Vicinity>
  limit?: SizeLimit
}): ReviewSource {
  const api = async <Value>(path: string): Promise<Value> => JSON.parse(await ghText(gh, ['api', '--hostname', 'github.com', path])) as Value
  const pullOf = (target: ReviewTarget): PullTarget => {
    if (target.kind !== 'pull') throw new Error('Not a pull request.')
    return target
  }

  return {
    async head(target) {
      const pull = pullOf(target)
      const answer = await api<{ state?: string; head?: { sha?: string } }>(`repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`)
      return answer.state === 'open' && answer.head?.sha ? answer.head.sha : null
    },
    async read(target, head, watch = {}) {
      const pull = pullOf(target)
      if (!checkout) throw new Error('This host checks out no pull requests, so it cannot read one.')
      const say = watch.say ?? (() => {})
      say(`Reading #${pull.number} on GitHub.`)
      const details = await api<{ title: string; body?: string | null; base: { ref: string }; head: { ref: string } }>(`repos/${pull.owner}/${pull.repo}/pulls/${pull.number}`)
      watch.titled?.(details.title)
      const { repo, base } = await checkout.fetch(pull, { head, baseBranch: details.base.ref }, say)
      const reader = gitReader(repo)
      say('Reading the changed files.')
      const capture = await captureChange(reader, base, head, limit)
      const specPath = specPathFor(details.head.ref, capture.files)
      const specText = specPath ? await reader.text(head, specPath) : null
      const around = vicinity ? await vicinity(pull, repo, base, head, say) : undefined
      return {
        change: { project: `${pull.owner}/${pull.repo}`, item: `#${pull.number}`, title: details.title, branch: details.head.ref },
        // GitHub writes its lines with \r\n.
        description: (details.body ?? '').replace(/\r\n?/g, '\n').trim(),
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
