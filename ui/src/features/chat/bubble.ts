/**
 * What hobkin says in the bubble by its face: what it is doing while it works, and the terminal app's greeting and
 * tips while it waits. The words, the tips and the clock they follow are hobkin's own (`src/cli/ui.mjs:155-228`,
 * `src/cli/doing.mjs`). Pure, so the rules are tested without a window.
 */

/** A tip shows for the first 30 seconds of every 3 minutes, by the clock, so each one holds still for its turn. */
export const TIP_EVERY_MS = 180000
export const TIP_SHOW_MS = 30000

/** hobkin's tips. Hex's is left out: a browser cannot tell whether Hex is installed, which is when the terminal says it. */
export const TIPS: readonly string[] = [
  'Type /help to see what hobkin can do.',
  'Try another model or thinking effort? Just ask hobkin.',
  'Each routine can have its own model and thinking effort.',
  'Ask hobkin to run any check now, even a paused one.',
  'Ask why a check stopped. Every check keeps a run log.',
  'Tell hobkin what matters. It remembers across chats.',
  '/clear hides the chat. /reset starts a fresh conversation.',
]

/** Joins the tips while learning is off. */
export const LEARNING_TIP = 'Type /learning so hobkin learns from how its work turns out.'

/** hobkin's greetings for someone it knows by name, shown as the window opens. */
export const GREETINGS: readonly ((name: string) => string)[] = [
  (name) => `Welcome ${name}! Nice to see you again.`,
  (name) => `Welcome back, ${name}. Good to see you.`,
  (name) => `Hey ${name}, glad you're back.`,
  (name) => `Good to see you again, ${name}.`,
  (name) => `There you are, ${name}. Nice to have you back.`,
  (name) => `Hello again, ${name}!`,
  (name) => `${name}! You're back. Let's get going.`,
]

/** hobkin's pick: the same choice for the same turn, spread over the choices. */
export function pickFrom<Choice>(choices: readonly Choice[], turn: number): Choice {
  return choices[(Math.imul(turn + 1, 2654435761) >>> 16) % choices.length]!
}

/** The tip for this moment, or nothing between tip windows. */
export function tipAt(choices: readonly string[], clock: number): string {
  if (!choices.length || clock % TIP_EVERY_MS >= TIP_SHOW_MS) return ''
  return pickFrom(choices, Math.floor(clock / TIP_EVERY_MS))
}

interface Attention {
  title: string
  read: number
  reports: number
  ignored?: boolean
}

const isAttention = (item: unknown): item is Attention =>
  typeof item === 'object' && item !== null && typeof (item as Attention).title === 'string' && Number.isFinite((item as Attention).read) && Number.isFinite((item as Attention).reports)

/** The tips for hobkin as it is now: its own, the learning tip while learning is off, and one for each report left unread. */
export function tipChoices(snapshot: { learning?: unknown; reportAttention?: unknown }): string[] {
  const attention = Array.isArray(snapshot.reportAttention) ? snapshot.reportAttention.filter(isAttention) : []
  return [
    ...TIPS,
    ...(snapshot.learning ? [] : [LEARNING_TIP]),
    ...attention.filter(({ ignored }) => ignored).map(({ title, read, reports }) => `${title}: ${read} of ${reports} reports opened. Revisit it?`),
  ]
}

/** hobkin's one word for what its turn is doing, said by hobkin. */
const DOING: Record<string, string> = {
  delegating: 'handing this to a session',
  retrying: 'trying again',
  compacting: 'compacting our conversation',
}

export function doingWords(doing: string): string {
  return `I'm ${DOING[doing] ?? doing}…`
}

export type Bubble = { kind: 'doing' | 'greeting' | 'tip'; text: string }

export interface BubbleFacts {
  /** hobkin's word for what its turn is doing, or null when no turn runs. */
  doing: string | null
  /** The message input holds text. */
  typing: boolean
  /** The line the status row shows instead: a problem, what a command said, or why nothing can be sent. */
  line: 'problem' | 'said' | 'reason' | null
  userName: string | null
  /** When the window opened, for the greeting. */
  openedAt: number
  now: number
  tips?: readonly string[]
}

/**
 * What the bubble says now, or null. A problem has the row to itself. A turn under way says what it is doing, even
 * while the user writes a follow-up. Greetings and tips wait for an empty input and a row with nothing else to say.
 */
export function bubbleNow({ doing, typing, line, userName, openedAt, now, tips = TIPS }: BubbleFacts): Bubble | null {
  if (line === 'problem') return null
  if (doing) return { kind: 'doing', text: doingWords(doing) }
  if (line || typing) return null
  if (userName && now - openedAt < TIP_SHOW_MS) return { kind: 'greeting', text: pickFrom(GREETINGS, Math.floor(openedAt / 1000))(userName) }
  const tip = tipAt(tips, now)
  return tip ? { kind: 'tip', text: tip } : null
}

/** The next moment the greeting ends or a tip window starts or ends, when the bubble has to look again. */
export function nextBubbleChange(now: number, openedAt: number): number {
  const windowStart = now - (now % TIP_EVERY_MS)
  const tipChange = now % TIP_EVERY_MS < TIP_SHOW_MS ? windowStart + TIP_SHOW_MS : windowStart + TIP_EVERY_MS
  return now < openedAt + TIP_SHOW_MS ? Math.min(openedAt + TIP_SHOW_MS, tipChange) : tipChange
}
