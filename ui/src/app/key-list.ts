/**
 * The one list of keys the app shows: the hints under the chat, the Keys tile in Settings and the walkthrough that
 * `/navigate` prints. Each entry is a key that works today (see `key-map.ts` and the controls named in `where`).
 * `does` is a few plain words, since the tile is read at a glance. `hint` marks the few that fit the line under the
 * chat. `basic` marks keys nobody needs to be told, such as the arrows and esc: the walkthrough still names them, and
 * the tile leaves them out.
 */
export interface KeyEntry {
  keys: string
  does: string
  where: string
  hint?: string
  basic?: true
}

export const KEY_LIST: readonly KeyEntry[] = [
  { keys: '⌘1, ⌘2, …', does: 'Switch screens', where: 'anywhere', hint: 'screens' },
  { keys: '⌘K', does: 'Search', where: 'anywhere', hint: 'search' },
  { keys: '⌘N', does: 'New durable agent', where: 'when no dialog is open' },
  { keys: '⌘Y', does: 'History', where: 'anywhere', hint: 'history' },
  { keys: '⌘R', does: 'Reload the window', where: 'when no overlay owns the keyboard' },
  { keys: '⌘←  ⌘→', does: 'Back and forward', where: 'outside text fields, including the message input, when no overlay owns the keyboard' },
  { keys: '⌘,', does: 'Settings', where: 'anywhere', hint: 'settings' },
  { keys: '⌘I', does: 'Integrations', where: 'anywhere' },
  { keys: '⌘J', does: "hobkin's mind", where: 'anywhere' },
  { keys: '⌘G', does: 'Go to the agent waiting on you', where: 'while an agent asks' },
  { keys: '⌃O', does: 'Expand or collapse all steps', where: "an agent's screen and hobkin's mind" },
  { keys: '⌃⌥T', does: "Agent's task list", where: "an agent's screen, once the agent keeps tasks" },
  { keys: '⌃X', does: 'End or force stop an agent (press twice)', where: "an agent's page, or its row in the agents list" },
  { keys: 'esc', does: 'Close the canvas', where: 'the canvas' },
  { keys: '⌘S', does: 'Save the drawing', where: 'the canvas, on a drawing' },
  { keys: '⌘L  ⌘↵', does: 'Go to the message input', where: 'anywhere' },
  { keys: '↓', does: 'Go to the agents list', where: 'an empty message input', hint: 'agents', basic: true },
  { keys: '↑ ↓', does: 'Move through the agents, ↵ opens one', where: 'the agents list', basic: true },
  { keys: 'x', does: 'Stop the selected agent', where: 'the agents list' },
  { keys: '⌃⌥P', does: 'Full prompt editor', where: 'anywhere' },
  { keys: '⌃⌥S', does: 'Nerd stats', where: 'anywhere' },
  { keys: '⌘U', does: 'Attach an image', where: 'the message input' },
  { keys: '⌘V', does: 'Paste an image', where: 'the message input' },
  { keys: '↑', does: 'Bring back your last message', where: 'the message input', basic: true },
  { keys: '⌘↓', does: 'Jump to the newest message', where: 'the message input' },
  { keys: 'esc', does: 'Go back one place on the trail. Twice in the message input stops hobkin, and ⌃C stops it at once', where: 'anywhere', basic: true },
  { keys: 'tab', does: 'Move between controls', where: 'anywhere', basic: true },
]

/** The keys the Keys tile in Settings lists: all but the basic ones. */
export const TILE_KEYS = KEY_LIST.filter((entry) => !entry.basic)

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
