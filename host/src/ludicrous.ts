import type { LudicrousState } from '#shared/protocol/ludicrous.ts'
import { folderState } from 'hobkin/src/cli/ludicrous/run.mjs'
import { Unavailable, type HostHandlers } from './commands.ts'

/**
 * Ludicrous mode for the window (_specs/076-ludicrous-mode). hobkin's conductor owns the run and its agents; the host reads its view at
 * most once a second into the `ludicrous` slice, and passes the window's Let's plan this, Go Ludicrous and Stop to it. Only the window
 * sends those: the registry marks them `outside`, so hobkin's `client` tool refuses them.
 */

/** What the host uses of hobkin's conductor (`ludicrous/conductor.mjs`). */
export interface LudicrousConductor {
  view(): LudicrousState
  plan(asked: { slug: string; idea: string; tier: 30 | 50 | 100 }): Promise<unknown>
  go(asked: { answers?: Record<string, string> }): Promise<unknown>
  stop(): Promise<unknown>
}

/** The window gets at most one Ludicrous frame a second (076 S8). */
export const MIN_GAP_MS = 1000

export interface LudicrousKeeperOptions {
  conductor: () => LudicrousConductor | null
  onChange: () => void
  now?: () => number
  pollMs?: number
}

export class LudicrousKeeper {
  /** The run and the tiers as last read, or undefined before a running hobkin was read. */
  state: LudicrousState | undefined = undefined
  private json = ''
  private last = -Infinity
  private timer: NodeJS.Timeout | null = null
  private readonly poll: NodeJS.Timeout
  private readonly options: LudicrousKeeperOptions
  private closed = false

  constructor(options: LudicrousKeeperOptions) {
    this.options = options
    this.poll = setInterval(() => this.schedule(), options.pollMs ?? MIN_GAP_MS)
    this.poll.unref()
    this.schedule()
  }

  private now = () => (this.options.now ?? Date.now)()

  /** Reads soon, and never twice inside the gap. */
  schedule(): void {
    if (this.closed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.read()
    }, Math.max(0, this.last + MIN_GAP_MS - this.now()))
    this.timer.unref()
  }

  /** Reads the conductor's view now, and tells the host only when it changed. */
  read(): LudicrousState | undefined {
    const conductor = this.options.conductor()
    if (this.closed || !conductor) return this.state
    this.last = this.now()
    let view: LudicrousState
    try {
      view = conductor.view()
    } catch {
      return this.state
    }
    const json = JSON.stringify(view)
    if (json !== this.json) {
      this.json = json
      this.state = view
      this.options.onChange()
    }
    return this.state
  }

  close(): void {
    this.closed = true
    clearInterval(this.poll)
    if (this.timer) clearTimeout(this.timer)
  }
}

type LudicrousCommand = 'work.ludicrous.plan' | 'work.ludicrous.go' | 'work.ludicrous.stop' | 'work.ludicrous.folder'

/** The window's Ludicrous commands. Each answers the run as it stands once the conductor took it, and the window gets a frame at once. */
export function ludicrousHandlers({ conductor, root, keeper }: { conductor: () => LudicrousConductor | null; root: () => string; keeper: LudicrousKeeper }): Pick<HostHandlers, LudicrousCommand> {
  const seat = () => {
    const found = conductor()
    if (!found) throw new Unavailable('Ludicrous mode needs hobkin running.')
    return found
  }
  const after = (taken: LudicrousConductor) => keeper.read() ?? taken.view()
  return {
    'work.ludicrous.plan': async ({ slug, idea, tier }) => {
      const taken = seat()
      await taken.plan({ slug, idea, tier })
      return after(taken)
    },
    'work.ludicrous.go': async ({ answers }) => {
      const taken = seat()
      await taken.go({ answers: answers ?? {} })
      return after(taken)
    },
    'work.ludicrous.stop': async () => {
      const taken = seat()
      await taken.stop()
      return after(taken)
    },
    'work.ludicrous.folder': ({ slug }) => folderState(root(), slug),
  }
}
