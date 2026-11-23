/**
 * A working run's pulse, as the snapshot carries it under `pulses` (`054-working-line`): when the run began, when a token
 * last moved, whether it thinks, which way tokens last went and about how many. The window writes it as one line, the
 * way the user's Pi extension `pi-thinking-messaging` does in the terminal: `Working… (7m 7s · ↓ 30.0k tokens)`, with a
 * notice once no token has moved for over one, three or five minutes. A host from before sends no pulses.
 */

/** One working run's pulse. Times are in milliseconds on the host's clock. */
export interface RunPulse {
  startedAt: number
  lastTokenAt: number
  phase: 'working' | 'thinking'
  /** `up` once a request goes to the model, `down` once an answer's tokens arrive. */
  direction: 'up' | 'down'
  /** An estimate for the whole run, which never goes down. */
  tokens: number
}

/** The key of the main turn's pulse in `pulses`. Every other pulse is under its run's id. */
export const MAIN_PULSE = '#main'

/** How loud the line is: plain while tokens move, a warning once it goes quiet, trouble once it seems idle. */
export type PulseTone = 'plain' | 'warn' | 'bad'

/** The line's parts: its words, the quiet notice when there is one, and the notice's tone. */
export interface PulseLine {
  words: string
  notice: string | null
  tone: PulseTone
}

const PHASE_WORD: Record<RunPulse['phase'], string> = { working: 'Working', thinking: 'Thinking' }
const ARROW: Record<RunPulse['direction'], string> = { up: '↑', down: '↓' }

/** Loudest first: the first stage the quiet is over is the one that shows. */
const QUIET_STAGES: readonly { overMs: number; notice: string; tone: PulseTone }[] = [
  { overMs: 300_000, notice: 'agent is idle', tone: 'bad' },
  { overMs: 180_000, notice: 'agent is probably idle...', tone: 'warn' },
  { overMs: 60_000, notice: 'agent is taking a while...', tone: 'warn' },
]

/** `7s`, `7m 7s`, `1h 2m 3s`. */
function elapsedWords(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** `812 tokens`, `30.0k tokens`, `1.2m tokens`. */
function tokenWords(tokens: number): string {
  const rounded = Math.max(0, Math.round(tokens))
  if (rounded < 1000) return `${rounded} tokens`
  if (rounded < 1_000_000) return `${(rounded / 1000).toFixed(1)}k tokens`
  return `${(rounded / 1_000_000).toFixed(1)}m tokens`
}

/** The line for `pulse` at `now`, with the extension's numbers and thresholds. */
export function pulseLine(pulse: RunPulse, now: number): PulseLine {
  const words = `${PHASE_WORD[pulse.phase]}… (${elapsedWords(now - pulse.startedAt)} · ${ARROW[pulse.direction]} ${tokenWords(pulse.tokens)})`
  const quietMs = now - pulse.lastTokenAt
  const stage = QUIET_STAGES.find(({ overMs }) => quietMs > overMs)
  return stage ? { words, notice: stage.notice, tone: stage.tone } : { words, notice: null, tone: 'plain' }
}

const NO_PULSES: Readonly<Record<string, RunPulse>> = Object.freeze({})

/** The pulses of a snapshot by run id, as it carries them, or one empty object when it carries none. */
export function pulsesOf(snapshot: { readonly [key: string]: unknown }): Readonly<Record<string, RunPulse>> {
  const { pulses } = snapshot
  if (typeof pulses !== 'object' || pulses === null || Array.isArray(pulses)) return NO_PULSES
  return pulses as Record<string, RunPulse>
}
