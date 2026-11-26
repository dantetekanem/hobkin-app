import type { Destination, Need, NeedKind, Reach } from './rules.ts'

/** Only current authoritative host facts: the home, its connection's generation, and what needs the user there now. */
export interface RequestFacts {
  home: string
  generation: number
  ready: boolean
  /** From `needsOf`, each by its own identity. */
  needs: readonly Need[]
}
interface Options {
  facts(): RequestFacts
  storage: Pick<Storage, 'getItem' | 'setItem'>
  adapter: {
    available(): boolean
    /** Whether hobkin may notify. It may show the Mac's own prompt, the first time there is something to tell. */
    permission(): Promise<boolean>
    listen(click: (id: string) => Promise<void>): Promise<() => void>
    /**
     * True means dispatch accepted, never confirmed OS delivery. Must not request permission. A `cue` is the sound alone:
     * it shows nothing, and is sent without asking the Mac.
     */
    send(notice: { id: string; title: string; body: string; reach: Reach }): Promise<boolean>
  }
  /** Whether the window is in front: shown, not minimized, and hobkin the active app. */
  front(): Promise<boolean>
  /** Opens where a need is answered, through the app's own navigation. The shell has brought the window up already. */
  reveal(opens: Destination): void
}

/** How many told ids a home keeps, newest last. Anything still waiting is far fewer than this. */
const KEPT = 500
const toldKey = (home: string) => `hobkin:told:${home}`

const KINDS: readonly NeedKind[] = ['question', 'item', 'hobkin', 'review', 'notice', 'digest']

/** A notification's id names the home, the need and its kind. A click hands it back, and nothing else in it is trusted. */
function parseKey(key: string): { home: string; id: string; kind: NeedKind } | null {
  try {
    const value: unknown = JSON.parse(key)
    if (!Array.isArray(value) || value.length !== 3 || !value.every((part) => typeof part === 'string')) return null
    const [home, id, kind] = value as [string, string, string]
    return KINDS.includes(kind as NeedKind) ? { home, id, kind: kind as NeedKind } : null
  } catch {
    return null
  }
}

/**
 * The Mac's notifications for what needs the user (_specs/037-notifications). Each need is told once in its home: what
 * was told, and what the user already saw with the window in front, is kept per home and survives reconnects and
 * reloads. A home this window never saw is taken as it is, so opening hobkin does not tell what was already waiting.
 * A refusal is respected: no notification is shown, then or later, and a cue, which shows nothing, still plays. A click
 * opens the need's place while it still waits.
 */
export function createRequestNotifications(options: Options) {
  const inflight = new Set<string>()
  const told = new Map<string, Set<string>>()
  let disposed = false, listener: Promise<() => void> | undefined

  /** What this home has told, read once. Unreadable storage counts as a home never seen, so nothing is told twice. */
  const toldIn = (home: string): Set<string> => {
    let known = told.get(home)
    if (known) return known
    let saved: unknown = null
    try {
      saved = JSON.parse(options.storage.getItem(toldKey(home)) ?? 'null')
    } catch {
      saved = null
    }
    known = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : [])
    told.set(home, known)
    if (!Array.isArray(saved)) mark(home, options.facts().home === home ? options.facts().needs.map(({ id }) => id) : [])
    return known
  }
  function mark(home: string, ids: readonly string[]) {
    const known = told.get(home)!
    for (const id of ids) {
      known.delete(id)
      known.add(id)
    }
    while (known.size > KEPT) known.delete(known.values().next().value!)
    try {
      options.storage.setItem(toldKey(home), JSON.stringify([...known]))
    } catch {
      // What was told stays known in memory when storage is unavailable.
    }
  }

  const current = (target: { home: string; generation: number; id: string }) => {
    const facts = options.facts()
    return !disposed && facts.ready && facts.home === target.home && facts.generation === target.generation && facts.needs.some(({ id }) => id === target.id)
  }
  const click = async (key: string) => {
    const named = parseKey(key)
    const facts = options.facts()
    if (!named || disposed || !facts.ready || facts.home !== named.home) return
    const need = facts.needs.find(({ id }) => id === named.id)
    // A question that left the sheet waits under Action Items.
    const opens: Destination | null = need?.opens ?? (named.kind === 'question' ? { to: 'actions' } : null)
    try {
      if (opens) options.reveal(opens)
    } catch {
      // A window that cannot navigate now stays where it is.
    }
  }
  const listen = () => {
    listener ??= options.adapter.listen(click).catch((error) => {
      listener = undefined
      throw error
    })
    return listener
  }

  async function tell(facts: RequestFacts, fresh: readonly Need[]) {
    const targets = fresh.map((need) => ({ need, target: { home: facts.home, generation: facts.generation, id: need.id } }))
    await listen()
    if (await options.front()) {
      const seen = targets.filter(({ target }) => current(target)).map(({ need }) => need.id)
      if (seen.length) mark(facts.home, seen)
      return
    }
    if (!targets.some(({ target }) => current(target))) return
    const shows = ({ need }: (typeof targets)[number]) => need.reach !== 'cue'
    // Only a notification asks the Mac. A cue is a sound in the window.
    const refused = targets.some(shows) && !(await options.adapter.permission())
    if (refused) mark(facts.home, targets.filter((each) => shows(each) && current(each.target)).map(({ need }) => need.id))
    for (const each of targets) {
      const { need, target } = each
      if (!current(target) || (refused && shows(each))) continue
      const key = JSON.stringify([facts.home, need.id, need.kind])
      if ((await options.adapter.send({ id: key, title: need.title, body: need.body, reach: need.reach })) && current(target)) mark(facts.home, [need.id])
    }
  }

  return {
    async refresh() {
      const facts = options.facts()
      if (!facts.ready || disposed) return
      const known = toldIn(facts.home)
      if (!options.adapter.available()) return
      const fresh = facts.needs.filter(({ id }) => !known.has(id) && !inflight.has(JSON.stringify([facts.home, id])))
      try {
        // Clicks on what an earlier window told still open their place.
        if (!fresh.length) return void (await listen())
      } catch {
        return
      }
      const keys = fresh.map(({ id }) => JSON.stringify([facts.home, id]))
      keys.forEach((key) => inflight.add(key))
      try {
        await tell(facts, fresh)
      } catch {
        // Nothing is marked, so the next refresh tries again.
      } finally {
        keys.forEach((key) => inflight.delete(key))
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (listener) void listener.then((remove) => remove()).catch(() => {})
    },
  }
}
