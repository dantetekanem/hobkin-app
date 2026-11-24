import { readFileSync } from 'node:fs'
import { HOBKIN_TITLE_MAX } from '#shared/protocol/hobkins.ts'
import { Unavailable, type HostHandlers } from '../commands.ts'

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
  pull?: { number: number; address: string; author: string | null }
}

export interface StackSeat {
  /** What the review's change is. Throws, with the reason, for a review hobkin does not know. */
  facts: (id: string) => Promise<StackFacts>
  /** Starts a durable hobkin on the max tier in `cwd` with `text` as its first message. */
  start: (hobkin: { cwd: string; title: string; text: string }) => Promise<{ id: string; run: string | null }>
  /** Whether that hobkin is still there: not ended. */
  exists: (hobkin: string) => Promise<boolean>
}

const TEMPLATE = readFileSync(new URL('./stack.md', import.meta.url), 'utf8')
/** The paragraphs after a line `<!-- name -->` are parts the host chooses among. */
const [MAIN = '', ...PARTS] = TEMPLATE.split(/^<!-- (.+) -->\n/m)
const part = (name: string): string => {
  const at = PARTS.indexOf(name)
  if (at < 0 || at % 2 !== 0) throw new Error(`stack.md has no part named ${name}.`)
  return PARTS[at + 1]!.trim()
}

const NOT_KNOWN = 'not known to hobkin: work it out with git'

/** Fills each `{{place}}` from `values`, and throws for a place left with no value. */
function fill(text: string, values: Record<string, string>): string {
  const filled = text.replace(/\{\{(\w+)\}\}/g, (place, name: string) => values[name] ?? place)
  const left = /\{\{\w+\}\}/.exec(filled)
  if (left) throw new Error(`stack.md has a place with no value: ${left[0]}`)
  return filled
}

/** The prompt for a change, with every place filled. */
export function stackPrompt(facts: StackFacts): string {
  const known = (value: string | null) => value ?? NOT_KNOWN
  const pull = facts.pull
    ? fill(part('pull'), { number: String(facts.pull.number), address: facts.pull.address, author: facts.pull.author ?? 'an author GitHub did not name' })
    : part('no pull')
  const ending = fill(part(facts.kind), { project: facts.project ?? '' })
  return fill(MAIN.trim(), {
    title: facts.title,
    repository: facts.repository,
    folder: known(facts.folder),
    start: known(facts.start),
    head: known(facts.head),
    branch: known(facts.branch),
    pull,
    ending,
  })
}

const MERGED = 'This change has merged, so there is nothing to split.'

/** The title the agent gets: "Stack: <the change's title>", cut to the title's limit. */
export const stackTitle = (title: string): string => `Stack: ${title}`.slice(0, HOBKIN_TITLE_MAX).trim()

export function stackHandlers(seat: StackSeat): Pick<HostHandlers, 'review.stack'> {
  /** The agent started for each review, kept in this host's memory: a restart forgets it. */
  const started = new Map<string, string>()
  /** Reviews being started now, so two asks at once start one agent. */
  const starting = new Map<string, Promise<{ hobkin: string; run: string | null; already: boolean }>>()

  const begin = async (id: string) => {
    const facts = await seat.facts(id)
    if (facts.merged) throw new Unavailable(MERGED)
    if (!facts.folder) throw new Unavailable(`hobkin needs the repository ${facts.repository} on this Mac to make a stack, and has no folder for it.`)
    const text = stackPrompt(facts)
    const hobkin = await seat.start({ cwd: facts.folder, title: stackTitle(facts.title), text })
    started.set(id, hobkin.id)
    return { hobkin: hobkin.id, run: hobkin.run, already: false }
  }

  return {
    'review.stack': async ({ id }) => {
      const pending = starting.get(id)
      if (pending) return { ...(await pending), run: null, already: true }
      const there = started.get(id)
      if (there && (await seat.exists(there))) return { hobkin: there, run: null, already: true }
      const starts = begin(id)
      starting.set(id, starts)
      try {
        return await starts
      } finally {
        starting.delete(id)
      }
    },
  }
}
