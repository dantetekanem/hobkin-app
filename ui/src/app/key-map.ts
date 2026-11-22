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
  /** The section the veil shows, when it is open. Command+Y closes History and switches Projects to it. */
  veilSection?: VeilSection | null
  /** A dialog the frame's own key opened is open now. Its key closes it, as the one place a reader looks; the spotlight closes itself on Command+K. */
  dialog?: 'new-hobkin' | 'nerd-stats' | 'prompt'
  /** An agent is waiting for the user. */
  asking: boolean
  /** GitHub is in the menu. The user can take it out, in Integrations, and a GitHub opened then is open only for now. */
  githubInMenu: boolean
  /** The keyboard is in a text field: an input, a textarea, the prompt editor, anything editable. */
  typing?: boolean
  /** The agent screen shows a durable hobkin's page (`034-durable-hobkins`). */
  hobkinPage?: boolean
  /** The canvas that has the keyboard (its area, its drawing or its controls in the menu): whose it is and what it shows. */
  board?: { owner: string; kind: 'page' | 'drawing' } | null
  /**
   * The canvas on screen, if any (`040-canvas-board`), and where its agent takes the keyboard: the message input for the
   * main canvas, the page's talk box for a durable hobkin's split. A canvas showing only as a pill is not on screen.
   */
  canvasShowing?: { owner: string; agent: 'input' | 'talk' } | null
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
  | { do: 'new-hobkin' }
  | { do: 'close-new-hobkin' }
  | { do: 'open-settings' }
  | { do: 'open-integrations' }
  | { do: 'answer-agent' }
  | { do: 'leave-screen' }
  | { do: 'reload' }
  | { do: 'open-prompt' }
  | { do: 'toggle-nerd-stats' }
  | { do: 'toggle-mind' }
  | { do: 'toggle-blocks' }
  | { do: 'end-hobkin' }
  | { do: 'force-stop' }
  | { do: 'go-back' }
  | { do: 'go-forward' }
  | { do: 'close-canvas'; owner: string }
  | { do: 'save-canvas'; owner: string }

/** Work's own pages sit under its tab, so moving along the tabs from one starts at Work. */
const UNDER_WORK: readonly ScreenId[] = ['world', 'yolo', 'project', 'proof']

/**
 * The tab beside the screen showing, in the order Command with a number walks: `step` 1 is right, -1 left, wrapping
 * round. From a page with no tab, such as an agent's, right is the first tab and left the last.
 */
function besideTab(tabs: readonly ScreenId[], screen: ScreenId, step: 1 | -1): ScreenId | null {
  if (!tabs.length) return null
  const at = tabs.indexOf(UNDER_WORK.includes(screen) ? 'work' : screen)
  if (at === -1) return step === 1 ? tabs[0]! : tabs.at(-1)!
  return tabs[(at + step + tabs.length) % tabs.length]!
}

/**
 * What the frame does for a key, or null when the key is not the frame's. Tab is never the frame's: it moves the
 * keyboard between controls as it does anywhere, and Command with a number changes the screen. Control+Tab moves
 * along the menu's tabs.
 */
export function resolveKey(press: KeyPress, context: KeyContext): KeyAction | null {
  // Command+R reloads the window, as it does in a browser, and the app reopens where it was (location.ts). A screen's own
  // panels included; a dialog over the window keeps it.
  if (press.meta && !press.ctrl && !press.alt && press.key.toLowerCase() === 'r') {
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'reload' }
  }
  // A key that opens a dialog closes it again. The frame takes no key from a dialog, so these are answered first, and
  // only for the one key that opened it. The editor's close keeps the draft (editor-toggled), so no words are lost.
  const bare = !press.shift && !press.alt && !press.ctrl
  if (press.meta && bare && press.key === 'n' && context.dialog === 'new-hobkin') return { do: 'close-new-hobkin' }
  if (press.ctrl && press.alt && !press.meta && !press.shift) {
    if (press.code === 'KeyS' && context.dialog === 'nerd-stats') return { do: 'toggle-nerd-stats' }
    if (press.code === 'KeyP' && context.dialog === 'prompt') return { do: 'open-prompt' }
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
  // Control+Option+S opens Nerd stats from every screen, matched by where S sits and guarded as Control+Option+P is.
  // The panel is a dialog, so while it is open it closes itself on the same key.
  if (press.ctrl && press.alt && !press.meta && !press.shift && press.code === 'KeyS') {
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'toggle-nerd-stats' }
  }
  // Command+J opens hobkin's mind, its main agent at work, beside the chat, and closes it again. Matched by where J sits.
  if (press.meta && !press.ctrl && !press.alt && !press.shift && press.code === 'KeyJ') {
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'toggle-mind' }
  }
  // Control+O opens every block of the steps on an agent's screen and in the mind, and closes them again, as in Claude
  // Code. It is taken from a text field too, where a Mac would otherwise open a new line. Elsewhere it keeps that meaning.
  if (press.ctrl && !press.meta && !press.alt && !press.shift && press.code === 'KeyO') {
    if (context.screen !== 'agent' && context.screen !== 'mind') return null
    return context.inOverlay && context.zone !== 'canvas' ? null : { do: 'toggle-blocks' }
  }
  // Control+X presses End on a durable hobkin's page: once it asks, twice it ends the hobkin. On any other agent's page it
  // presses Force Stop: once it asks, twice it force stops the run. From the page, its talk box or the agents list; never
  // from the main message input or while a dialog has the keyboard.
  if (press.ctrl && !press.meta && !press.alt && !press.shift && press.code === 'KeyX') {
    if (context.screen !== 'agent' || context.inOverlay || context.zone === 'input') return null
    return context.hobkinPage ? { do: 'end-hobkin' } : { do: 'force-stop' }
  }
  if (context.inOverlay) return null

  // Control+Tab and Control+Shift+Tab move right and left through the menu's tabs, as in a browser, from anywhere.
  if (press.ctrl && !press.meta && !press.alt && press.key === 'Tab') {
    const screen = besideTab(context.screens, context.screen, press.shift ? -1 : 1)
    return screen ? { do: 'open-screen', screen, focusCanvas: true } : null
  }

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
  // Command+N starts a durable hobkin the user drives themselves (034-durable-hobkins).
  if (key === 'n') return { do: 'new-hobkin' }
  if (key === 'l') return { do: 'focus-input' }
  // Command+Enter goes to the message input from anywhere. In the input it is the composer's.
  if (key === 'Enter') return context.zone === 'input' ? null : { do: 'focus-input' }
  // Command+Y closes History when it is showing, and switches Projects to it.
  if (key === 'y') return context.veilSection === 'history' ? { do: 'close-veil' } : { do: 'open-veil', section: 'history' }
  // Command+comma is where a Mac app keeps its settings.
  if (key === ',') return { do: 'open-settings' }
  if (key === 'i') return { do: 'open-integrations' }
  // G goes to the agent that needs you. Nothing to go to leaves the key alone. (Command+U attaches an image.)
  if (key === 'g') return context.asking ? { do: 'answer-agent' } : null
  // Command+S saves the drawing that has the keyboard, as its Save button does. Anywhere else the key is not the frame's.
  if (key === 's') return context.board?.kind === 'drawing' ? { do: 'save-canvas', owner: context.board.owner } : null
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

const OPEN_FOR_NOW: readonly ScreenId[] = ['agent', 'review', 'settings', 'integrations', 'skills', 'extensions', 'world', 'yolo', 'project', 'proof']

/**
 * A review, Settings, Integrations, Work's World, YOLO mode, a project's page and a proof run are open only for now,
 * and so is a GitHub opened while the menu leaves it out.
 */
function openForNow({ screen, githubInMenu }: KeyContext): boolean {
  return OPEN_FOR_NOW.includes(screen) || (screen === 'github' && !githubInMenu)
}

/**
 * Escape walks one step back toward the message input. Whatever had the keyboard gets the key first:
 * when it used the key (`prevented`), the frame leaves it alone.
 *
 * A screen that is open only for now is left for the place before it on the trail (053): a review, an agent, World, YOLO
 * mode, a project or a proof run for the page it was opened from, Integrations for Settings, Settings for the screen
 * under it. With nothing on the trail, a GitHub the menu leaves out goes to the screen it was opened over and the rest
 * to Work. A menu screen stays open and the keyboard goes home.
 *
 * A canvas with the keyboard in it closes (`040-canvas-board`). The main canvas is not a place open only for now: Escape
 * anywhere else leaves it open.
 */
export function resolveEscape(context: KeyContext, prevented: boolean): KeyAction | null {
  if (prevented || context.inOverlay) return null
  if (context.board) return { do: 'close-canvas', owner: context.board.owner }
  // The mind is open only for now too: leaving it goes back to where the user was.
  if (context.screen === 'mind') return { do: 'toggle-mind' }
  if (openForNow(context)) return { do: 'leave-screen' }
  return context.zone === 'input' ? null : { do: 'focus-input' }
}
