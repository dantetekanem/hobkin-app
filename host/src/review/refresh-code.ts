import type { ReviewStatus } from '#shared/review/status.ts'
import { Unavailable, type HostHandlers } from '../commands.ts'
import { fill, oneAgentAtATime, readPromptFile, titled } from './agent-prompt.ts'

/**
 * Code stale, refresh (the button beside Make it a stack). hobkin's code merges nothing: it gathers what it knows of the
 * change, fills the prompt in `refresh-code.md`, and starts one agent to bring the branch up to date.
 */

/** What this host knows of a review's change. A fact it does not have is null. */
export interface RefreshFacts {
  title: string
  /** The repository by name: `owner/repo` for a pull request, the project's name for hobkin's own change. */
  repository: string
  /** The repository's folder on this Mac, or null when there is none. */
  folder: string | null
  merged: boolean
  branch: string | null
  /** How far behind the branch it merges into, whether it conflicts with it, and that branch's name. */
  code: NonNullable<ReviewStatus['code']>
  /** hobkin's own finished change, the user's own pull request, or another author's pull request. */
  kind: 'own' | 'mine' | 'other'
  pull?: { number: number; address: string; author: string | null }
}

export interface RefreshSeat {
  /** What the review's change is. Throws, with the reason, for a review hobkin does not know. */
  facts: (id: string) => Promise<RefreshFacts>
  /** Starts a durable hobkin in `cwd` with `text` as its first message, on the tier for ordinary coding work. */
  start: (hobkin: { cwd: string; title: string; text: string }) => Promise<{ id: string; run: string | null }>
  /** Whether that hobkin is still there: not ended. */
  exists: (hobkin: string) => Promise<boolean>
}

/** Where a change stands against the branch it merges into, as a review's status carries it, from what one source knows. */
export const codeOf = (known: { behind?: number | null; conflict?: boolean | null; base?: string | null }): NonNullable<ReviewStatus['code']> => ({
  behind: known.behind ?? null,
  conflict: known.conflict ?? null,
  base: known.base ?? null,
})

/**
 * A pull request's conflict from GitHub's own pull answer: `mergeable` is null while GitHub works it out, so nothing is
 * said until it says. `behind` is counted from the checkout the review reads, so it is the count when that was read.
 */
export function pullCode(pull: { mergeable?: boolean | null; mergeable_state?: string }, behind: number | null, base: string | null): NonNullable<ReviewStatus['code']> {
  const conflict = pull.mergeable === false || pull.mergeable_state === 'dirty' ? true : pull.mergeable === true ? false : null
  return codeOf({ behind, conflict, base })
}

const template = readPromptFile(new URL('./refresh-code.md', import.meta.url))
const NOT_KNOWN = 'not known to hobkin: work it out with git'

/** What hobkin knew of the branch, in a sentence. */
function stateWords({ behind, conflict, base }: RefreshFacts['code']): string {
  const into = base ?? 'the branch it merges into'
  const far = behind == null ? null : `${behind} ${behind === 1 ? 'commit' : 'commits'} behind ${into}`
  const meets = conflict == null ? null : conflict ? `it conflicts with ${into}` : `it does not conflict with ${into}`
  const said = [far, meets].filter((part) => part != null)
  return said.length ? `${said.join(', and ')}.` : `hobkin could not say how far it is behind ${into}, or whether it conflicts.`
}

/** The prompt for a change, with every place filled. */
export function refreshPrompt(facts: RefreshFacts): string {
  const pull = facts.pull
    ? fill(template.part('pull'), { number: String(facts.pull.number), address: facts.pull.address, author: facts.pull.author ?? 'an author GitHub did not name' })
    : template.part('no pull')
  const ending = template.part(facts.kind === 'own' ? (facts.pull ? 'own with pull' : 'own') : facts.kind)
  return fill(template.main, {
    title: facts.title,
    repository: facts.repository,
    folder: facts.folder ?? NOT_KNOWN,
    branch: facts.branch ?? NOT_KNOWN,
    base: facts.code.base ?? NOT_KNOWN,
    state: stateWords(facts.code),
    pull,
    ending,
  })
}

/** The title the agent gets: "Refresh: <the change's title>", cut to the title's limit. */
export const refreshTitle = (title: string): string => titled('Refresh', title)

const MERGED = 'This change has merged, so there is nothing to refresh.'

export function refreshHandlers(seat: RefreshSeat): Pick<HostHandlers, 'review.refresh-code'> {
  const oneAtATime = oneAgentAtATime(seat.exists)

  const begin = async (id: string) => {
    const facts = await seat.facts(id)
    if (facts.merged) throw new Unavailable(MERGED)
    if (!facts.folder) throw new Unavailable(`hobkin needs the repository ${facts.repository} on this Mac to refresh its code, and has no folder for it.`)
    const { behind, conflict, base } = facts.code
    if (!((behind ?? 0) > 0) && conflict !== true) throw new Unavailable(`Its code is up to date with ${base ?? 'the branch it merges into'}.`)
    return seat.start({ cwd: facts.folder, title: refreshTitle(facts.title), text: refreshPrompt(facts) })
  }

  return {
    'review.refresh-code': ({ id }) => oneAtATime(id, () => begin(id)),
  }
}
