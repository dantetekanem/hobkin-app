/**
 * What hobkin says in the bubble by its face: what it is doing while it works, and a greeting and tips while it
 * waits. The words for what it is doing are hobkin's own (`src/cli/doing.mjs`). Pure, so the rules are tested without
 * a window.
 */

/** The greeting shows for the first 30 seconds after the window opens. */
export const GREETING_MS = 30000

/**
 * Tips are thoughts, not a schedule. Time is cut into 6-minute slots; a slot stays quiet about one time in four, and
 * otherwise has one brief thought at a moment of its own, never in the first minute. The same clock gives the same answer.
 */
export const TIP_SLOT_MS = 360000
export const TIP_QUIET_MS = 60000

const slotHash = (slot: number, salt: number) => (Math.imul(slot + 1 + salt * 7919, 2246822519) ^ Math.imul(slot + 3, 3266489917)) >>> 8

/** When the slot's thought starts and ends, or null when the slot is quiet. */
export function tipWindow(slot: number): { start: number; end: number } | null {
  if (slotHash(slot, 1) % 4 === 0) return null
  const length = 6000 + (slotHash(slot, 2) % 9000)
  const room = TIP_SLOT_MS - TIP_QUIET_MS - length
  const start = slot * TIP_SLOT_MS + TIP_QUIET_MS + (slotHash(slot, 3) % room)
  return { start, end: start + length }
}

/** hobkin's tips. Hex's is left out: a browser cannot tell whether Hex is installed, which is when the terminal says it. */
export const TIPS: readonly string[] = [
  'Cmd+K finds anything and takes you there.',
  'Cmd+1 opens Home; later numbers follow the top menu.',
  'Press Down in an empty input to walk the agents list.',
  'Ctrl+Option+P opens the full prompt editor.',
  'Cmd+L brings you back to the message input.',
  'Cmd+Y opens your chat history.',
  'Type /help to see what hobkin can do.',
  'Try another model or thinking effort? Just ask hobkin.',
  'Ask hobkin to run any check now, even a paused one.',
  'Ask why a check stopped. Every check keeps a run log.',
  'Tell hobkin what matters. It remembers across chats.',
  '/clear hides the chat. /reset starts a fresh conversation.',
  'Drag the edge of the chat to make it wider or narrower.',
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

/** The thought for this moment, or nothing between thoughts. */
export function tipAt(choices: readonly string[], clock: number): string {
  const slot = Math.floor(clock / TIP_SLOT_MS)
  const window = tipWindow(slot)
  if (!choices.length || !window || clock < window.start || clock >= window.end) return ''
  return pickFrom(choices, slot)
}

interface Attention {
  title: string
  read: number
  reports: number
  ignored?: boolean
}

const isAttention = (item: unknown): item is Attention =>
  typeof item === 'object' && item !== null && typeof (item as Attention).title === 'string' && Number.isFinite((item as Attention).read) && Number.isFinite((item as Attention).reports)

/** The usage tips for hobkin as it is now: its own, and the learning tip while learning is off. */
export function tipChoices(snapshot: { learning?: unknown }): string[] {
  return [...TIPS, ...(snapshot.learning ? [] : [LEARNING_TIP])]
}

/** One reminder for each report the user keeps leaving unread. They are not usage tips and show labelled as reminders. */
export function reminderChoices(snapshot: { reportAttention?: unknown }): string[] {
  const attention = Array.isArray(snapshot.reportAttention) ? snapshot.reportAttention.filter(isAttention) : []
  return attention.filter(({ ignored }) => ignored).map(({ title, read, reports }) => `${title}: ${read} of ${reports} reports opened. Revisit it?`)
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

export type Bubble = { kind: 'doing' | 'greeting' | 'tip' | 'reminder'; text: string }

export interface BubbleFacts {
  /** hobkin's word for what its turn is doing, or null when no turn runs. */
  doing: string | null
  /** The message input holds text. */
  typing: boolean
  /** The line the status row shows instead: a problem, what a command said, why nothing can be sent, or that a stop waits for its answer. */
  line: 'problem' | 'said' | 'reason' | 'stopping' | null
  userName: string | null
  /** When the window opened, for the greeting. */
  openedAt: number
  now: number
  tips?: readonly string[]
  reminders?: readonly string[]
}

/**
 * What the bubble says now, or null. A problem has the row to itself. A turn under way says what it is doing, even
 * while the user writes a follow-up. Greetings and tips wait for an empty input and a row with nothing else to say.
 */
export function bubbleNow({ doing, typing, line, userName, openedAt, now, tips = TIPS, reminders = [] }: BubbleFacts): Bubble | null {
  if (line === 'problem' || line === 'stopping') return null
  if (doing) return { kind: 'doing', text: doingWords(doing) }
  if (line || typing) return null
  if (userName && now - openedAt < GREETING_MS) return { kind: 'greeting', text: pickFrom(GREETINGS, Math.floor(openedAt / 1000))(userName) }
  // Every third thought, when a report waits, is a reminder about it. The rest teach.
  const slot = Math.floor(now / TIP_SLOT_MS)
  if (reminders.length && slot % 3 === 2) {
    const reminder = tipAt(reminders, now)
    if (reminder) return { kind: 'reminder', text: reminder }
  }
  const tip = tipAt(tips, now)
  return tip ? { kind: 'tip', text: tip } : null
}

/** The next moment the greeting ends or a thought starts or ends, when the bubble has to look again. */
export function nextBubbleChange(now: number, openedAt: number): number {
  const slot = Math.floor(now / TIP_SLOT_MS)
  let next = Infinity
  for (let at = slot; at <= slot + 2 && next === Infinity; at += 1) {
    const window = tipWindow(at)
    if (window && window.start > now) next = window.start
    if (window && window.end > now) next = Math.min(next, window.end)
  }
  return now < openedAt + GREETING_MS ? Math.min(openedAt + GREETING_MS, next) : next
}
