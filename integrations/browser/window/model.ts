import { agoWords } from '../../../ui/src/features/schedules/schedules.ts'
import type { BrowserSession, BrowserState } from '../protocol.ts'

/**
 * Everything the Browser card and Home say, read from the state the host sent and the time now. Pure, so every word
 * is tested without a window; `BrowserCard.tsx` and `home.ts` draw what this says.
 */

export type EngineState = BrowserState['engine']['state']

/** How the engine stands, as the card's pill. A busy one shows a spinner where its dot would be. */
export interface EnginePill {
  label: string
  tone: 'ok' | 'warn' | 'bad' | 'quiet'
  busy: boolean
}

const PILL: Record<EngineState, EnginePill> = {
  unknown: { label: 'Looking', tone: 'quiet', busy: true },
  missing: { label: 'Not installed', tone: 'warn', busy: false },
  installing: { label: 'Installing', tone: 'quiet', busy: true },
  ready: { label: 'Ready', tone: 'ok', busy: false },
  failed: { label: 'Install failed', tone: 'bad', busy: false },
}

const LINE: Record<EngineState, string> = {
  unknown: 'Looking for the browser',
  missing: 'The browser for agents is not installed',
  installing: 'Installing the browser for agents',
  ready: 'Agents open and test pages in a Chrome of their own',
  failed: 'The browser for agents did not install',
}

/** What installing does, said where the user decides to. */
export const INSTALL_SAYS =
  "Installing downloads agent-browser and a Chrome for Testing build, about 400 MB on disk, into hobkin's folder and ~/.agent-browser. Agents then test pages in a clean Chrome of their own, with no sign-ins."

/** What Close answers with no host, which has no browser to close. */
export const SAMPLE_CLOSE = 'This is sample data, so nothing was closed.'

/** The line under an agent's name when its browser has no page yet. */
export const NO_PAGE = 'No page yet'

/** The quiet line when the engine is ready and nothing is open. */
export const NONE_OPEN = 'No agent has a browser open.'

export const enginePill = (state: EngineState): EnginePill => PILL[state]

/** How the engine stands, in a few words, under the card's name. */
export const engineLine = (state: EngineState): string => LINE[state]

/** The versions that are there: "Engine 0.45.0 · Chrome 131.0.6778.85". Null while neither is known. */
export function versionsLine({ version, chrome }: Pick<BrowserState['engine'], 'version' | 'chrome'>): string | null {
  const known: string[] = []
  if (version) known.push(`Engine ${version}`)
  if (chrome) known.push(`Chrome ${chrome}`)

  return known.length > 0 ? known.join(' · ') : null
}

/** What the card's button says: Install while the engine is missing, Try again after a failure. Null when it has none. */
export function installButton(state: EngineState): string | null {
  if (state === 'missing') return 'Install'
  if (state === 'failed') return 'Try again'
  return null
}

/** "2 open", for the list's heading and Home's tile. */
export const openWords = (count: number): string => `${count} open`

/** What closing answered: how many browsers were closed. */
export function closedWords(closed: number): string {
  if (closed === 0) return 'No browser was open.'
  return closed === 1 ? 'Closed 1 browser.' : `Closed ${closed} browsers.`
}

/** Why a command was refused, in the host's own words. */
export const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** What came of a press, said on the card where the user pressed: what was done, or why it was refused. */
export interface Said {
  tone: 'done' | 'refused'
  text: string
}

/** The host's command that closes one agent's browser, or all of them (`browser.close`). */
export type CloseCommand = (args: { agent?: string }) => Promise<{ closed: number }>

/** Closes one agent's browser, or every one when no agent is named, and says what came of it. With no host there is nothing to close. */
export async function closeBrowsers({ live, command, agent }: { live: boolean; command: CloseCommand; agent?: string }): Promise<Said> {
  if (!live) return { tone: 'done', text: SAMPLE_CLOSE }

  const whose = agent === undefined ? {} : { agent }
  try {
    const { closed } = await command(whose)
    return { tone: 'done', text: closedWords(closed) }
  } catch (error) {
    return { tone: 'refused', text: reasonOf(error) }
  }
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host || null
  } catch {
    return null
  }
}

/** One open browser, as its row says it. */
export interface SessionLine {
  /** The agent as the host names it, for `browser.close`. */
  agent: string
  /** Whose browser it is: "Main chat". */
  label: string
  /** The page it is on: its title, or its address's host, or that it has none yet. */
  page: string
  /** How long ago it was last used: "2 min ago". */
  used: string
  /** The whole address, for the row's tooltip. */
  address: string | null
  /** What its Close button is called for a screen reader. */
  closeLabel: string
}

export function sessionLine(session: BrowserSession, now: number): SessionLine {
  const sinceLastUse = Math.max(0, now - session.lastAt)

  return {
    agent: session.agent,
    label: session.label,
    page: session.title?.trim() || hostOf(session.url) || NO_PAGE,
    used: agoWords(sinceLastUse),
    address: session.url,
    closeLabel: `Close the browser of ${session.label}`,
  }
}

/** The card, whole. */
export interface BrowserCardModel {
  pill: EnginePill
  line: string
  versions: string | null
  /** The button's words, or null when the card has no button: while it installs, once it is ready, before the first look. */
  button: string | null
  /** What installing does, beside the button. */
  explains: string | null
  /** What the install is doing now. */
  progress: string | null
  /** Why the last install failed. */
  failure: string | null
  /** The open browsers, in the host's order: newest use first. */
  sessions: SessionLine[]
  /** "2 open", over the list. Null with none open. */
  open: string | null
  /** The quiet line in place of the list, once the engine is ready and nothing is open. */
  empty: string | null
}

export function browserCard({ engine, sessions }: BrowserState, now: number): BrowserCardModel {
  const button = installButton(engine.state)
  const anyOpen = sessions.length > 0
  const readyWithNoneOpen = engine.state === 'ready' && !anyOpen

  return {
    pill: enginePill(engine.state),
    line: engineLine(engine.state),
    versions: versionsLine(engine),
    button,
    explains: button ? INSTALL_SAYS : null,
    progress: engine.state === 'installing' ? engine.note : null,
    failure: engine.state === 'failed' ? engine.note : null,
    sessions: sessions.map((session) => sessionLine(session, now)),
    open: anyOpen ? openWords(sessions.length) : null,
    empty: readyWithNoneOpen ? NONE_OPEN : null,
  }
}
