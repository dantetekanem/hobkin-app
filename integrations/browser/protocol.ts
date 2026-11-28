/**
 * What the browser integration says to the window, and what its commands answer. The host part keeps a real Chrome
 * for each of hobkin's agents, driven through the agent-browser engine; the window shows whether that engine is
 * installed and which agents have a browser open now.
 */

export interface CanvasRequest { id: string; owner: string; revision: number }
export type CanvasAction =
  | { do: 'read'; what?: 'elements' | 'text' | 'all'; within?: string }
  | { do: 'back' | 'forward' | 'reload' }
  | { do: 'click' | 'hover' | 'upload'; on: string }
  | { do: 'fill' | 'type'; on: string; text: string }
  | { do: 'press'; key: string }
  | { do: 'select'; on: string; option: string }
  | { do: 'scroll'; by?: number; to?: string }
  | { do: 'drag'; on: string; to: string }
  | { do: 'wait'; on?: string; text?: string; url?: string }

/** What the window is told. Nothing secret. */
export interface BrowserState {
  navigation?: CanvasRequest[]
  engine: {
    /** unknown before the first look; missing; installing; ready; failed (the last install or look went wrong). */
    state: 'unknown' | 'missing' | 'installing' | 'ready' | 'failed'
    /** agent-browser's version once it is there, such as 0.45.0. */
    version: string | null
    /** Chrome for Testing's version once it is there. */
    chrome: string | null
    /** What the install is doing now, or why it failed, in plain words. Null otherwise. */
    note: string | null
  }
  /** The browsers open now, one per agent, newest use first. */
  sessions: BrowserSession[]
}

export interface BrowserSession {
  /** The agent as the host names it: #main, or a run's id. */
  agent: string
  /** Words for a person: "Main chat", "hobkin 1dd62269", or the run's id shortened. */
  label: string
  url: string | null
  title: string | null
  /** Epoch ms of its first and its latest call. */
  since: number
  lastAt: number
}

export interface BrowserResults {
  'browser.canvas.claim': CanvasAction | null
  'browser.canvas.finish': null
  'browser.status': BrowserState
  'browser.install': BrowserState
  'browser.close': { closed: number }
}
