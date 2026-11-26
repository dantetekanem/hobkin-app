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
  { keys: '⌃⌥W', does: 'Schedules agents keep', where: "the main chat, an agent's page or hobkin's mind, once one exists" },
  { keys: '⌃X', does: 'End an agent (press twice)', where: "an agent's page, or its row in the agents list" },
  { keys: '⌃⇥  ⌃⇧⇥', does: 'Next or previous agent', where: "an agent's page" },
  { keys: 'esc', does: 'Close the canvas', where: 'the canvas' },
  { keys: '⌘S', does: 'Save the drawing', where: 'the canvas, on a drawing' },
  { keys: 'T  ⇧T', does: 'Open, close or expand the proof', where: 'a review' },
  { keys: '⇧S', does: 'Put the keyboard on Make it a stack; Enter starts the agent', where: 'a change above 300 lines' },
  { keys: '{  }', does: 'Go to the layer under or over this one', where: 'a review that is a layer of a stack' },
  { keys: 'J  K', does: 'Next and previous zone', where: 'a review, outside the proof' },
  { keys: 'I', does: 'The code view, or back to the graph', where: 'a review' },
  { keys: 'J  K', does: 'Next and previous group of changes', where: "a review's code view" },
  { keys: 'Z  R', does: 'Mark the file seen', where: "a review's code view" },
  { keys: 'J  K', does: 'Next and previous model', where: 'a proof run' },
  { keys: 'F  ⇧F', does: 'Next and previous thing that failed', where: 'a proof run' },
  { keys: '1  2  3', does: 'Run, State graph, Math', where: 'a proof run' },
  { keys: '/', does: 'Search the state graph', where: 'a proof run' },
  { keys: 'R', does: 'Run the check again', where: 'a proof run that ended' },
  { keys: '⌘L  ⌘↵', does: 'Go to the message input', where: 'anywhere' },
  { keys: '↓', does: 'Go to the agents list', where: 'an empty message input', hint: 'agents', basic: true },
  { keys: 'Fn + E', does: 'Open the emoji picker', where: 'a text field on macOS', hint: 'emoji' },
  { keys: '↑ ↓', does: 'Move through the agents, ↵ opens one', where: 'the agents list', basic: true },
  { keys: 'x', does: 'Stop the selected agent', where: 'the agents list' },
  { keys: 'w', does: 'Set the workload', where: 'Work, outside text fields' },
  { keys: 'q', does: 'List the whole queue', where: 'Work, outside text fields' },
  { keys: 'n', does: 'Add a new project', where: 'Work and YOLO mode, outside text fields' },
  { keys: 'space', does: 'Open or close a finished change', where: 'Work, on a finished change' },
  { keys: '⌃⌥P', does: 'Full prompt editor', where: 'anywhere' },
  { keys: '⌃⇧↵', does: 'Send the prompt to a new durable agent', where: 'the full prompt editor' },
  { keys: '⌃⌥S', does: 'Nerd stats', where: 'anywhere' },
  { keys: '↵', does: 'Send. During a turn it steers the turn', where: "the message input, or an agent's message box" },
  { keys: '⌥↵', does: 'Send after the turn ends', where: "the message input, or an agent's message box, during a turn" },
  { keys: '⌃↵', does: 'Stop the turn and send now', where: "the message input, or an agent's message box, during a turn" },
  { keys: '⌥↑', does: 'Bring waiting messages back to edit', where: "the message input, or an agent's message box, while messages wait for the turn" },
  { keys: '↵', does: 'Continue a turn you stopped', where: "an empty message input, or a durable agent's empty message box, right after you stop it" },
  { keys: '⌘U', does: 'Attach an image', where: 'the message input' },
  { keys: '⌘V', does: 'Paste an image', where: 'the message input' },
  { keys: '↑', does: 'Bring back your last message', where: 'the message input', basic: true },
  { keys: '⌘↓', does: 'Jump to the newest message', where: 'the message input' },
  { keys: 'esc', does: "Go back one place on the trail. Twice in the message input, or an agent's message box, stops the turn, and ⌃C stops it at once", where: 'anywhere', basic: true },
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
