/**
 * The one list of keys the app shows: the hints under the chat, the Keys tile in Settings and the walkthrough that
 * `/navigate` prints. Each entry is a key that works today (see `key-map.ts` and the controls named in `where`).
 * `hint` marks the few that fit the line under the chat.
 */
export interface KeyEntry {
  keys: string
  does: string
  where: string
  hint?: string
}

export const KEY_LIST: readonly KeyEntry[] = [
  {
    keys: '⌘1, ⌘2, …',
    does: 'Open the screen at that position in the visible navigation; Home is first.',
    where: 'anywhere',
    hint: 'screens',
  },
  { keys: '⌘K', does: 'Search everything and go there. Again to close', where: 'anywhere', hint: 'search' },
  { keys: '⌘N', does: 'Open and close the sheet for a new hobkin to talk to directly, which keeps its conversation until you end it', where: 'when no dialog is open' },
  { keys: '⌘Y', does: 'History. Again to close', where: 'anywhere', hint: 'history' },
  {
    keys: '⌘R',
    does: 'Reload the window and return to this place',
    where: 'when no overlay owns the keyboard',
  },
  {
    keys: '⌘←  ⌘→',
    does: 'Go back or forward through places in this window',
    where: 'outside text fields, including the message input, when no overlay owns the keyboard',
  },
  { keys: '⌘,', does: 'Settings', where: 'anywhere', hint: 'settings' },
  { keys: '⌘I', does: 'Integrations', where: 'anywhere' },
  { keys: '⌘J', does: "Hobkin's mind, its main agent at work. Again to close", where: 'anywhere' },
  { keys: '⌘G', does: 'Go to the agent waiting on you', where: 'while an agent asks' },
  {
    keys: '⌃O',
    does: 'Open every block of the steps (file text, command output, diffs, tool output), and close them again',
    where: "an agent's screen and Hobkin's mind",
  },
  { keys: '⌃⌥T', does: "Open the agent's task list, and close it again", where: "an agent's screen, once the agent keeps tasks" },
  {
    keys: '⌃X',
    does: "End a durable hobkin, or Force Stop any other agent's run: once asks, twice does it",
    where: "an agent's page, or its row in the agents list",
  },
  { keys: '⌘L  ⌘↵', does: 'Back to the message input', where: 'anywhere' },
  { keys: '↓', does: 'Enter the agents', where: 'an empty message input', hint: 'agents' },
  { keys: '↑ ↓', does: 'Walk the agents. ↵ steps into one, ↑ from the first goes back', where: 'the agents list' },
  { keys: 'x  i', does: 'x stops the agent. i would interrupt it, and says it is not supported yet', where: 'the agents list' },
  { keys: '⌃⌥P', does: 'Open the full prompt editor, and close it again with the draft kept', where: 'anywhere' },
  { keys: '⌃⌥S', does: 'Nerd stats. Again to close', where: 'anywhere' },
  { keys: '⌘U', does: 'Attach an image', where: 'the message input' },
  { keys: '↑', does: 'Bring back the last message you sent', where: 'the message input' },
  { keys: '⌘↓', does: 'Jump to the newest message', where: 'the message input' },
  { keys: 'esc', does: 'One step back toward the message input. Pressed twice in the message input, it stops hobkin while it works; Control+C stops at once', where: 'anywhere' },
  { keys: 'tab', does: 'Move between controls. It never switches screens', where: 'anywhere' },
]

/** The keys for the line under the chat. */
export const HINT_KEYS = KEY_LIST.filter((entry) => entry.hint)

/** What `/navigate` shows in the chat: a short walkthrough from the list, no model involved. */
export function navigationGuide(): string {
  return [
    'Everything here works from the keyboard. Start in the message input, where you are now.',
    '',
    ...KEY_LIST.map(({ keys, does, where }) => `- \`${keys}\` ${does} (${where})`),
    '',
    'Try ⌘1 to open Home, first in the visible navigation, then esc to come back to the message.',
  ].join('\n')
}
