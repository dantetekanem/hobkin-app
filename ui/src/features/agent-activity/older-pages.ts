import { createStore, type StoreApi } from 'zustand/vanilla'
import type { CommandArgs, CommandResults } from '#shared/commands/registry.ts'
import type { ActivityEntry } from '#shared/protocol/activity.ts'

/** What one job's page holds of the steps its feed let go. */
export interface OlderPages {
  /** The steps fetched so far, oldest first, ending right before the feed's oldest step. */
  steps: readonly ActivityEntry[]
  /** Older steps remain to fetch. Null until the host first answers; false from a host from before them. */
  more: boolean | null
  loading: boolean
}

/** How the window asks the host for them (`activity.before`, `activity.output`). Rejects as `runCommand` does. */
export interface AskOlder {
  before(args: CommandArgs<'activity.before'>): Promise<CommandResults['activity.before']>
  output(args: CommandArgs<'activity.output'>): Promise<CommandResults['activity.output']>
}

interface Held extends OlderPages {
  /** The feed's step the pages end right before. */
  joins: string | null
  /** Goes up with each question, so the answer to one asked before it is dropped. */
  asked: number
}

const NOTHING: OlderPages = { steps: [], more: null, loading: false }
type Page = CommandResults['activity.before']

/**
 * The steps each watched job's feed let go, read a page at a time from its run's saved session: oldest first, and
 * joined to the feed's oldest step, again after the feed lets more go. A job's pages go when it is no longer watched.
 */
export class OlderSteps {
  readonly store: StoreApi<Record<string, Held>> = createStore<Record<string, Held>>(() => ({}))
  private readonly ask: AskOlder

  constructor(ask: AskOlder) {
    this.ask = ask
  }

  pagesOf(job: string): OlderPages {
    const held = this.store.getState()[job]
    return held ? { steps: held.steps, more: held.more, loading: held.loading } : NOTHING
  }

  /** Reads the page right before the oldest step held: the pages' first, or the feed's. */
  async loadMore(job: string, feed: readonly ActivityEntry[]): Promise<void> {
    const held = this.store.getState()[job]
    if (held?.loading || held?.more === false) return
    const oldest = held?.steps[0] ?? feed[0]
    if (!oldest) return

    const asked = this.begin(job)
    const page = await this.before(job, oldest)
    const now = this.store.getState()[job]
    if (!now || now.asked !== asked) return
    if (!page) return this.put(job, { ...now, loading: false })
    this.put(job, { steps: [...page.steps, ...now.steps], more: page.more, loading: false, joins: now.joins ?? feed[0]?.id ?? null, asked })
  }

  /**
   * After the feed changed. When its oldest step is no longer the one the pages end before, the feed let steps go, and
   * the page right before its oldest joins the pages to it again. Pages that page does not reach start over from it.
   */
  async follow(job: string, feed: readonly ActivityEntry[]): Promise<void> {
    const held = this.store.getState()[job]
    const oldest = feed[0]
    if (!held?.steps.length || !oldest || held.joins === oldest.id || held.loading) return

    const asked = this.begin(job)
    const page = await this.before(job, oldest)
    const now = this.store.getState()[job]
    if (!now || now.asked !== asked) return
    if (!page) return this.put(job, { ...now, loading: false })
    const fetched = new Set(page.steps.map(({ id }) => id))
    const meets = fetched.has(now.steps.at(-1)!.id)
    const steps = meets ? [...now.steps.filter(({ id }) => !fetched.has(id)), ...page.steps] : page.steps
    this.put(job, { steps, more: meets ? now.more : page.more, loading: false, joins: oldest.id, asked })
  }

  /** Lets go of the pages of every job not in `jobs`. */
  keepOnly(jobs: readonly string[]): void {
    const kept = new Set(jobs)
    const held = this.store.getState()
    if (Object.keys(held).every((job) => kept.has(job))) return
    this.store.setState(Object.fromEntries(Object.entries(held).filter(([job]) => kept.has(job))), true)
  }

  /** A tool step's whole output, or null when the host has none for it, as a host from before has none. */
  async wholeOutput(job: string, id: string): Promise<string | null> {
    try {
      return (await this.ask.output({ job, id }))?.output ?? null
    } catch {
      return null
    }
  }

  private begin(job: string): number {
    const held = this.store.getState()[job] ?? { ...NOTHING, joins: null, asked: 0 }
    const asked = held.asked + 1
    this.put(job, { ...held, loading: true, asked })
    return asked
  }

  /**
   * The page right before `step`. None at all, so nothing more to ask, when the host cannot say: a host from before
   * these steps, or a run with no saved Pi session. Null when the connection went, to ask again later.
   */
  private async before(job: string, step: ActivityEntry): Promise<Page | null> {
    try {
      return await this.ask.before({ job, before: step.id, ...(step.at !== undefined ? { at: step.at } : {}) })
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'disconnected') return null
      return { steps: [], more: false, found: false }
    }
  }

  private put(job: string, held: Held): void {
    this.store.setState((jobs) => ({ ...jobs, [job]: held }), true)
  }
}
