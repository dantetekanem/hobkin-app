import type { ScreenId, VeilSection } from './screens.ts'

/**
 * The frame's keyboard map, as a function with no knowledge of the page: a key and where the keyboard is
 * go in, and what the app should do comes out. `keys.ts` reads the page and carries the answer out.
 * See _specs/019-keyboard.
 */

/** Where the keyboard is. The message input is home. */
export type Zone = 'input' | 'agents' | 'veil' | 'canvas' | 'other'

export interface KeyPress {
  key: string
  meta?: boolean
  ctrl?: boolean
  alt?: boolean
  shift?: boolean
}

export interface KeyContext {
  zone: Zone
  /** True when the message input holds no text. Down enters the agents only then. */
  messageEmpty: boolean
  /** The screens in the menu right now, in order. */
  screens: readonly ScreenId[]
  screen: ScreenId
  /** A dialog, menu or list that owns its keys has the keyboard. The frame takes nothing. */
  inOverlay: boolean
  /** Projects or History is veiling the chat. Its list then has the arrows, Enter and Escape, wherever the keyboard is. */
  veilOpen: boolean
  /** The menu screen under an agent's canvas. Tab counts from it, because agents are not part of the menu's walk. */
  under?: ScreenId
  /** An agent is waiting for the user. */
  asking: boolean
}

export type KeyAction =
  | { do: 'open-screen'; screen: ScreenId; focusCanvas: boolean }
  | { do: 'focus-input' }
  | { do: 'focus-canvas' }
  | { do: 'focus-agents' }
  | { do: 'open-veil'; section: VeilSection }
  | { do: 'veil-move'; delta: 1 | -1 }
  | { do: 'veil-switch'; delta: 1 | -1 }
  | { do: 'veil-choose' }
  | { do: 'close-veil' }
  | { do: 'open-settings' }
  | { do: 'open-integrations' }
  | { do: 'answer-agent' }
  | { do: 'leave-screen' }
  | { do: 'reload' }
  /** The key is taken and nothing happens, so it cannot wander off as the browser's own Tab would. */
  | { do: 'hold' }

/** What the frame does for a key, or null when the key is not the frame's. */
export function resolveKey(press: KeyPress, context: KeyContext): KeyAction | null {
  // Command+R reloads the window, as it does in a browser, wherever the keyboard is. The app reopens where it was.
  if (press.meta && !press.ctrl && !press.alt && press.key.toLowerCase() === 'r') return { do: 'reload' }
  if (context.inOverlay) return null

  if (press.meta) {
    // Command with nothing else. Command with Shift, Option or Control belongs to something else.
    if (press.ctrl || press.alt || press.shift) return null
    return commandKey(press.key, context)
  }
  if (press.ctrl || press.alt) return null

  // Tab and Shift+Tab change the screen from anywhere. From inside the canvas the keyboard stays in the canvas.
  if (press.key === 'Tab') {
    // Among the agents only Up and Down move. Tab is the menu's again once the keyboard has left them.
    if (amongAgents(context)) return { do: 'hold' }
    return { do: 'open-screen', screen: neighbor(context, press.shift ? -1 : 1), focusCanvas: context.zone === 'canvas' }
  }
  if (press.shift) return null

  if (context.veilOpen) return veilKey(press.key)

  // Left and Right are never the frame's: only Tab and Shift+Tab change the screen.
  if (context.zone === 'input' && press.key === 'ArrowDown' && context.messageEmpty) return { do: 'focus-agents' }
  return null
}

function commandKey(key: string, context: KeyContext): KeyAction | null {
  if (/^[1-9]$/.test(key)) {
    const screen = context.screens[Number(key) - 1]
    return screen ? { do: 'open-screen', screen, focusCanvas: true } : null
  }
  if (key === 'l') return { do: 'focus-input' }
  if (key === 'j') return { do: 'focus-canvas' }
  if (key === 'p') return { do: 'open-veil', section: 'projects' }
  if (key === 'y') return { do: 'open-veil', section: 'history' }
  // Command+comma is where a Mac app keeps its settings.
  if (key === ',') return { do: 'open-settings' }
  if (key === 'i') return { do: 'open-integrations' }
  // G goes to the agent that needs you. Nothing to go to leaves the key alone. (Command+U attaches an image.)
  if (key === 'g') return context.asking ? { do: 'answer-agent' } : null
  return null
}

/** The keyboard is in the agents list, or in the input of the agent being talked to. */
function amongAgents({ zone, screen }: KeyContext): boolean {
  return zone === 'agents' || (zone === 'canvas' && screen === 'agent')
}

/** While a list veils the chat: Up and Down walk it, Left and Right change list, Enter chooses, Escape closes. */
function veilKey(key: string): KeyAction | null {
  if (key === 'ArrowDown') return { do: 'veil-move', delta: 1 }
  if (key === 'ArrowUp') return { do: 'veil-move', delta: -1 }
  if (key === 'ArrowRight') return { do: 'veil-switch', delta: 1 }
  if (key === 'ArrowLeft') return { do: 'veil-switch', delta: -1 }
  if (key === 'Enter') return { do: 'veil-choose' }
  if (key === 'Escape') return { do: 'close-veil' }
  return null
}

/** The screen one place along the menu, wrapping at both ends. */
function neighbor({ screens, screen, under }: KeyContext, delta: 1 | -1): ScreenId {
  const at = Math.max(0, screens.indexOf(under ?? screen))
  return screens[(at + delta + screens.length) % screens.length]!
}

const OPEN_FOR_NOW: readonly ScreenId[] = ['review', 'settings', 'integrations', 'github']

/**
 * Escape walks one step back toward the message input. Whatever had the keyboard gets the key first:
 * when it used the key (`prevented`), the frame leaves it alone.
 *
 * A screen that is open only for now is left: a review for Work, Integrations for Settings, the GitHub page
 * for Pages, Settings for the screen under it. A menu screen stays open and the keyboard goes home.
 */
export function resolveEscape(context: KeyContext, prevented: boolean): KeyAction | null {
  if (prevented || context.inOverlay || context.zone === 'input') return null
  if (OPEN_FOR_NOW.includes(context.screen)) return { do: 'leave-screen' }
  return { do: 'focus-input' }
}
