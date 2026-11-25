import { Unavailable, type HostHandlers } from '../commands.ts'
import { codeHostWords, fill, oneAgentAtATime, readPromptFile, titled } from './agent-prompt.ts'

/**
 * Make it a stack (060-make-it-a-stack). hobkin's code plans nothing: it gathers what it knows of the change, fills the
 * prompt in `stack.md`, and starts one agent on the max tier to do the split.
 */

/** What this host knows of a review's change. A fact it does not have is null. */
export interface StackFacts {
  title: string
  /** The repository by name: `owner/repo` for a pull request, the project's name for hobkin's own change. */
  repository: string
  /** The repository's folder on this Mac, or null when there is none. */
  folder: string | null
  merged: boolean
  /** The commit the change starts from, and the commit it is at now. */
  start: string | null
  head: string | null
  branch: string | null
  /** hobkin's own finished change, the user's own pull request, or another author's pull request. */
  kind: 'own' | 'mine' | 'other'
  /** For hobkin's own change: its Work project. */
  project?: string
  /** The pull request, with the named code host it is on: none for GitHub's. */
  pull?: { number: number; address: string; author: string | null; host?: string }
}

export interface StackSeat {
  /** What the review's change is. Throws, with the reason, for a review hobkin does not know. */
  facts: (id: string) => Promise<StackFacts>
  /** Starts a durable hobkin on the max tier in `cwd` with `text` as its first message. */
  start: (hobkin: { cwd: string; title: string; text: string }) => Promise<{ id: string; run: string | null }>
  /** Whether that hobkin is still there: not ended. */
  exists: (hobkin: string) => Promise<boolean>
}

const template = readPromptFile(new URL('./stack.md', import.meta.url))
const part = template.part

const NOT_KNOWN = 'not known to hobkin: work it out with git'

/** The prompt for a change, with every place filled. */
export function stackPrompt(facts: StackFacts): string {
  const known = (value: string | null) => value ?? NOT_KNOWN
  const host = codeHostWords(facts.pull)
  const pull = facts.pull
    ? fill(part('pull'), { number: String(facts.pull.number), address: facts.pull.address, author: facts.pull.author ?? `an author ${host} did not name` })
    : part('no pull')
  const ending = fill(part(facts.kind), { project: facts.project ?? '' })
  return fill(template.main, {
    title: facts.title,
    repository: facts.repository,
    folder: known(facts.folder),
    start: known(facts.start),
    head: known(facts.head),
    branch: known(facts.branch),
    pull,
    host,
    ending,
  })
}

const MERGED = 'This change has merged, so there is nothing to split.'

/** The title the agent gets: "Stack: <the change's title>", cut to the title's limit. */
export const stackTitle = (title: string): string => titled('Stack', title)

export function stackHandlers(seat: StackSeat): Pick<HostHandlers, 'review.stack'> {
  const oneAtATime = oneAgentAtATime(seat.exists)

  const begin = async (id: string) => {
    const facts = await seat.facts(id)
    if (facts.merged) throw new Unavailable(MERGED)
    if (!facts.folder) throw new Unavailable(`hobkin needs the repository ${facts.repository} on this Mac to make a stack, and has no folder for it.`)
    return seat.start({ cwd: facts.folder, title: stackTitle(facts.title), text: stackPrompt(facts) })
  }

  return {
    'review.stack': ({ id }) => oneAtATime(id, () => begin(id)),
  }
}
