import type { HostState } from '@/lib/host/state.ts'
import { SHOWN_MAX_MS, shownFacts, type ShownFacts } from '#shared/protocol/timings.ts'

/**
 * How soon the first words of a reply reach the window and show in it, for a message the user sent to the main chat,
 * timed from when they sent it. Only a message that starts its own turn is measured, and each turn at most once.
 * Pure: the clock, the frame and the report are handed in, so the rule is tested without a window.
 */

/** What the measure reads of the host's state after each change. */
export type FirstWordState = Pick<HostState, 'link' | 'epoch' | 'timings' | 'snapshot' | 'live' | 'messages'>

export interface FirstWordOptions {
  /** The window's clock in milliseconds since the epoch: the one `sentAt` is read on. */
  now: () => number
  /** Runs `then` once what React just committed is on screen, one animation frame later. */
  afterPaint: (then: () => void) => void
  /** Hands the times to the host. */
  report: (facts: ShownFacts) => void
}

/** The message being measured. `sent` hands it out, and `accepted` and `refused` name it by it. */
export interface Measure {
  sentAt: number
  epoch: number
  /** The replies stored when the message went. Words of these are an earlier turn's. */
  earlier: ReadonlySet<string>
  /** The turn's run id, once the host took the message as a turn of its own. */
  id: string | null
  /** hobkin was seen answering since the message went. */
  answered: boolean
  arrivedAt: number | null
  /** A frame was asked for, for the words first drawn. */
  painting: boolean
  shownAt: number | null
}

export interface FirstWord {
  /** The user sent a message at `sentAt`, with the host's state as it was then. Null when it is not measured. */
  sent(sentAt: number, state: FirstWordState): Measure | null
  /** The host's answer to the send. A message queued into a running turn is not measured. */
  accepted(measure: Measure | null, said: { id?: unknown; queued?: unknown } | undefined): void
  refused(measure: Measure | null): void
  /** The host's state changed. */
  observe(state: FirstWordState): void
  /** React committed words of the row `key` of the conversation. */
  drawn(key: string): void
}

const hasWords = (text: string | undefined) => text !== undefined && /\S/.test(text)

export function createFirstWord({ now, afterPaint, report }: FirstWordOptions): FirstWord {
  let measure: Measure | null = null
  let latest: FirstWordState | null = null

  const end = () => void (measure = null)

  /** Reports once the host's answer, the words' arrival and their frame are all in. */
  const finish = () => {
    const done = measure
    if (!done || done.id === null || done.arrivedAt === null || done.shownAt === null) return
    end()
    // A clock that went back, or a reply slower than the host keeps, is not sent.
    const facts = shownFacts({ id: done.id, arrivedMs: done.arrivedAt - done.sentAt, shownMs: done.shownAt - done.sentAt })
    if (facts) report(facts)
  }

  /** A stored reply that is not an earlier one. */
  const newReply = (state: FirstWordState, key: string, earlier: ReadonlySet<string>) =>
    !earlier.has(key) && state.messages.some((message) => message.id === key && message.role === 'assistant')

  /** hobkin's words of a reply being written, or of one stored since the message went. */
  const arrived = (state: FirstWordState, earlier: ReadonlySet<string>) =>
    (state.live?.replies.some((reply) => reply.blocks.some(hasWords)) ?? false) ||
    state.messages.some((message) => message.role === 'assistant' && !earlier.has(message.id) && hasWords(message.content))

  return {
    sent(sentAt, state) {
      latest = state
      // With hobkin answering, or a reply still on its way, the message steers that turn or waits behind it.
      if (state.timings !== true || state.link !== 'open' || state.snapshot.busy === true || state.live !== null) return null
      const earlier = new Set(state.messages.filter(({ role }) => role === 'assistant').map(({ id }) => id))
      measure = { sentAt, epoch: state.epoch, earlier, id: null, answered: false, arrivedAt: null, painting: false, shownAt: null }
      return measure
    },

    accepted(sent, said) {
      if (!sent || sent !== measure) return
      if (said?.queued !== false || typeof said.id !== 'string') return end()
      sent.id = said.id
      finish()
    },

    refused(sent) {
      if (sent && sent === measure) end()
    },

    observe(state) {
      latest = state
      const current = measure
      if (!current) return
      // Another host or a reconnect replaced what was measured, or it took longer than any time kept.
      if (state.epoch !== current.epoch || state.link !== 'open' || now() - current.sentAt > SHOWN_MAX_MS) return end()
      if (state.snapshot.busy === true) current.answered = true
      if (current.arrivedAt !== null) return
      if (arrived(state, current.earlier)) current.arrivedAt = now()
      // The turn ended with nothing said: stopped, failed or only tools. A later turn's words are not its.
      else if (current.answered && state.snapshot.busy !== true) end()
    },

    drawn(key) {
      const current = measure
      if (!current || current.arrivedAt === null || current.painting) return
      if (!key.startsWith('live:') && !(latest && newReply(latest, key, current.earlier))) return
      current.painting = true
      afterPaint(() => {
        if (measure !== current) return
        current.shownAt = now()
        finish()
      })
    },
  }
}
