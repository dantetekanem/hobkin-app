import type { SlashCommand } from '#shared/protocol/slash.ts'

/**
 * The list of commands that opens above the input when a message starts with a slash: which commands it
 * shows, in which order, and what each key does while it is open. Pure, so the rules can be tested without a window.
 */

/** The list never shows more than this. */
export const MOST_ROWS = 5

/** What the list remembers between keys. */
export interface SlashState {
  /** The row the keyboard is on. */
  selected: number
  /** The text Escape closed the list for. It stays closed until the text changes. */
  closedFor: string | null
}

export const closedSlash: SlashState = { selected: 0, closedFor: null }

export interface SlashList {
  /** What is typed after the slash. */
  query: string
  /** The commands to show, best first. Empty when nothing matches. */
  rows: SlashCommand[]
  /** The row the keyboard is on, or null when there is none to be on. */
  selected: number | null
}

/**
 * What is typed after an opening slash, or null when the text is not a command being typed.
 * Only a slash that starts the message counts, and only until the command's name ends: after a space the
 * user is writing what follows the command.
 */
function queryOf(text: string): string | null {
  return /^\/\S*$/.test(text) ? text.slice(1).toLowerCase() : null
}

/** Most used first. Commands used equally often keep the order they came in: hobkin's own, then Pi's. */
const byUse = (left: SlashCommand, right: SlashCommand) => right.count - left.count

/** The commands for what is typed: all of them for a bare slash, else names that start with it, then names that contain it. */
function matching(commands: readonly SlashCommand[], query: string): SlashCommand[] {
  if (!query) return commands.toSorted(byUse)
  const names = commands.map((listed) => ({ listed, name: listed.name.slice(1).toLowerCase() }))
  const starts = names.filter(({ name }) => name.startsWith(query)).map(({ listed }) => listed)
  const contains = names.filter(({ name }) => !name.startsWith(query) && name.includes(query)).map(({ listed }) => listed)
  return [...starts.toSorted(byUse), ...contains.toSorted(byUse)]
}

/** The list to show for the text in the input, or null when there is none to show. */
export function slashList(text: string, commands: readonly SlashCommand[], state: SlashState): SlashList | null {
  const query = queryOf(text)
  if (query === null || !commands.length || state.closedFor === text) return null

  const rows = matching(commands, query).slice(0, MOST_ROWS)
  return { query, rows, selected: rows.length ? Math.min(state.selected, rows.length - 1) : null }
}

/** The text changed: the list opens again if Escape had closed it, and the keyboard is back on the best match. */
export function slashTyped(_state: SlashState, _text: string): SlashState {
  return closedSlash
}

export type SlashKey = 'ArrowDown' | 'ArrowUp' | 'Tab' | 'Enter' | 'Escape'

export interface SlashKeyResult {
  state: SlashState
  /** What the input holds now, when the key changed it. */
  text?: string
  /** The command to run. */
  run?: { name: string; args: string }
}

/**
 * What a key does while the list is open, or null when the key is not the list's: the list is closed, or
 * nothing matches and there is no row to act on. A key that is not the list's keeps its usual meaning, so
 * Enter then sends the text as a message and Tab is the frame's.
 */
export function slashKey({ text, commands, state }: { text: string; commands: readonly SlashCommand[]; state: SlashState }, key: SlashKey): SlashKeyResult | null {
  const list = slashList(text, commands, state)
  if (!list) return null
  if (key === 'Escape') return { state: { selected: 0, closedFor: text } }
  if (list.selected === null) return null

  const chosen = list.rows[list.selected]!
  switch (key) {
    case 'ArrowDown':
      return { state: { ...state, selected: Math.min(list.rows.length - 1, list.selected + 1) } }
    case 'ArrowUp':
      return { state: { ...state, selected: Math.max(0, list.selected - 1) } }
    case 'Tab':
      // The space after it ends the name, so the list closes and what follows the command can be typed.
      return { text: `${chosen.name} `, state: closedSlash }
    case 'Enter':
      return { run: { name: chosen.name, args: '' }, text: '', state: closedSlash }
  }
}

/** The command a finished message is, with what follows it, or null when the message is just a message. */
export function slashCommandIn(text: string, commands: readonly SlashCommand[]): { name: string; args: string } | null {
  const [, name, args = ''] = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(text) ?? []
  if (!name || !commands.some((listed) => listed.name === name)) return null
  return { name, args: args.trim() }
}
