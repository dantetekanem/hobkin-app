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
  /** Where the key sits on the keyboard. Option changes the character a key types on a Mac, but not this. */
  code?: string
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
  /** A dialog, menu or list that owns its keys has the keyboard, the spotlight among them. The frame takes nothing. */
  inOverlay: boolean
  /** History is veiling the chat. Its list then has Up, Down, Enter and Escape, wherever the keyboard is. */
  veilOpen: boolean
  /** An agent is waiting for the user. */
  asking: boolean
  /** GitHub is in the menu. The user can take it out, in Integrations, and a GitHub opened then is open only for now. */
  githubInMenu: boolean
  /** The keyboard is in a text field: an input, a textarea, the prompt editor, anything editable. */
  typing?: boolean
}

export type KeyAction =
  | { do: 'open-screen'; screen: ScreenId; focusCanvas: boolean }
  | { do: 'focus-input' }
  | { do: 'focus-agents' }
  | { do: 'open-veil'; section: VeilSection }
  | { do: 'veil-move'; delta: 1 | -1 }
  | { do: 'veil-choose' }
  | { do: 'close-veil' }
  | { do: 'open-spotlight' }
  | { do: 'open-settings' }
  | { do: 'open-integrations' }
  | { do: 'answer-agent' }
  | { do: 'leave-screen' }
  | { do: 'reload' }
  | { do: 'open-prompt' }
  | { do: 'toggle-mind' }
  | { do: 'go-back' }
  | { do: 'go-forward' }

/**
 * What the frame does for a key, or null when the key is not the frame's. Tab is never the frame's: it moves the
 * keyboard between controls as it does anywhere, and Command with a number changes the screen.
 */
export function resolveKey(press: KeyPress, context: KeyContext): KeyAction | null {
  // Command+R reloads the window, as it does in a browser, and the app reopens where it was (location.ts). A screen's own
  // panels included; a dialog over the window keeps it.
  if (press.meta && !press.ctrl && !press.alt && press.key.toLowerCase() === 'r') {
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'reload' }
  }
  // Command+Left and Right go back and forward through the places the window has been, a screen's panels included.
  // In any text field they keep their Mac meaning: the start and end of the line.
  if (press.meta && !press.ctrl && !press.alt && !press.shift && (press.key === 'ArrowLeft' || press.key === 'ArrowRight')) {
    if (context.typing || context.zone === 'input' || (context.inOverlay && context.zone !== 'canvas')) return null
    return { do: press.key === 'ArrowLeft' ? 'go-back' : 'go-forward' }
  }
  // Control+Option+P opens the full prompt from every screen, as in pi-prompt, a screen's own panels included.
  // A dialog over the window keeps it: the editor closes itself with it, and the message input opens it while completing.
  if (press.ctrl && press.alt && !press.meta && !press.shift && press.code === 'KeyP') {
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'open-prompt' }
  }
  // Command+J opens hobkin's mind, its main agent at work, beside the chat, and closes it again. Matched by where J sits.
  if (press.meta && !press.ctrl && !press.alt && !press.shift && press.code === 'KeyJ') {
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'toggle-mind' }
  }
  if (context.inOverlay) return null

  if (press.meta) {
    // Command with nothing else. Command with Shift, Option or Control belongs to something else.
    if (press.ctrl || press.alt || press.shift) return null
    return commandKey(press.key, context)
  }
  if (press.ctrl || press.alt || press.shift) return null

  if (context.veilOpen) return veilKey(press.key)

  // Left and Right are never the frame's: they move the caret.
  if (context.zone === 'input' && press.key === 'ArrowDown' && context.messageEmpty) return { do: 'focus-agents' }
  return null
}

function commandKey(key: string, context: KeyContext): KeyAction | null {
  if (/^[1-9]$/.test(key)) {
    const screen = context.screens[Number(key) - 1]
    return screen ? { do: 'open-screen', screen, focusCanvas: true } : null
  }
  // Command+K finds anything and goes there, as Spotlight does (026-spotlight).
  if (key === 'k') return { do: 'open-spotlight' }
  if (key === 'l') return { do: 'focus-input' }
  // Command+Enter goes to the message input from anywhere. In the input it is the composer's.
  if (key === 'Enter') return context.zone === 'input' ? null : { do: 'focus-input' }
  if (key === 'y') return { do: 'open-veil', section: 'history' }
  // Command+comma is where a Mac app keeps its settings.
  if (key === ',') return { do: 'open-settings' }
  if (key === 'i') return { do: 'open-integrations' }
  // G goes to the agent that needs you. Nothing to go to leaves the key alone. (Command+U attaches an image.)
  if (key === 'g') return context.asking ? { do: 'answer-agent' } : null
  return null
}

/** While History veils the chat: Up and Down walk it, Enter chooses, Escape closes. */
function veilKey(key: string): KeyAction | null {
  if (key === 'ArrowDown') return { do: 'veil-move', delta: 1 }
  if (key === 'ArrowUp') return { do: 'veil-move', delta: -1 }
  if (key === 'Enter') return { do: 'veil-choose' }
  if (key === 'Escape') return { do: 'close-veil' }
  return null
}

const OPEN_FOR_NOW: readonly ScreenId[] = ['review', 'settings', 'integrations']

/** A review, Settings and Integrations are open only for now, and so is a GitHub opened while the menu leaves it out. */
function openForNow({ screen, githubInMenu }: KeyContext): boolean {
  return OPEN_FOR_NOW.includes(screen) || (screen === 'github' && !githubInMenu)
}

/**
 * Escape walks one step back toward the message input. Whatever had the keyboard gets the key first:
 * when it used the key (`prevented`), the frame leaves it alone.
 *
 * A screen that is open only for now is left: a review for its opener, Integrations for Settings, Settings for the screen
 * under it, a GitHub the menu leaves out for the screen it was opened over. A menu screen stays open and the
 * keyboard goes home.
 */
export function resolveEscape(context: KeyContext, prevented: boolean): KeyAction | null {
  if (prevented || context.inOverlay) return null
  // The mind is open only for now too: leaving it goes back to where the user was.
  if (context.screen === 'mind') return { do: 'toggle-mind' }
  if (openForNow(context)) return { do: 'leave-screen' }
  return context.zone === 'input' ? null : { do: 'focus-input' }
}
