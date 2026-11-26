import type { BrowserState } from '../protocol.ts'
import type { HomeAction, HomeCardFields, HomeContribution, HomeRow, HomeTarget, HomeTone } from '@/features/home/types.ts'
import { installButton, openWords, versionsLine, type EngineState } from './model.ts'

/**
 * What the browser adds to Home: its tile among the connections, saying whether agents have a browser and how many
 * are open, and one thing among what needs the user while the engine is not installed or its install failed.
 */

/** Where the card with the Install button is. */
const INTEGRATIONS_SCREEN: HomeTarget = { to: 'screen', screen: 'integrations' }

interface Standing {
  status: string
  tone: HomeTone
}

/** `unknown` has no tile: the host has not looked yet. Home's summary reads `ok` as connected and `bad` as failing. */
const STANDING: Partial<Record<EngineState, Standing>> = {
  missing: { status: 'Not installed', tone: 'quiet' },
  installing: { status: 'Installing…', tone: 'info' },
  ready: { status: 'Ready', tone: 'ok' },
  failed: { status: 'Install failed', tone: 'bad' },
}

interface NeedWords {
  id: string
  title: string
  reason: string
  tone: HomeTone
  /** What the row says when the host gave no reason of its own. */
  detail: string
}

/** What waits on the user, by the state that asks for it. Each has its own id, so setting one aside keeps the other. */
const NEED: Partial<Record<EngineState, NeedWords>> = {
  missing: {
    id: 'browser:install',
    title: 'The browser for agents is not installed',
    reason: 'Not installed',
    tone: 'warn',
    detail: 'Agents need it to open and test pages.',
  },
  failed: {
    id: 'browser:install-failed',
    title: 'The browser for agents did not install',
    reason: 'Install failed',
    tone: 'bad',
    detail: 'Agents cannot open pages until it does.',
  },
}

/** "Ready", or "Ready · 2 open" once the engine is ready and agents have browsers open. */
function tileStatus(standing: Standing, { engine, sessions }: BrowserState): string {
  const countsOpen = engine.state === 'ready' && sessions.length > 0
  return countsOpen ? `${standing.status} · ${openWords(sessions.length)}` : standing.status
}

/** The tile's second line: the versions once it is ready, else what the install is doing or why it failed. */
function tileNote(engine: BrowserState['engine']): string | null {
  if (engine.state === 'ready') return versionsLine(engine)
  if (engine.state === 'missing') return null
  return engine.note
}

function installNeed({ engine }: BrowserState): { row: HomeRow; card: HomeCardFields } | null {
  const words = NEED[engine.state]
  const label = installButton(engine.state)
  if (!words || !label) return null

  const action: HomeAction = { label, target: INTEGRATIONS_SCREEN }
  const whyItFailed = engine.state === 'failed' ? engine.note : null
  const detail = whyItFailed || words.detail

  const row: HomeRow = {
    id: words.id,
    title: words.title,
    detail,
    tone: words.tone,
    aside: null,
    action,
  }
  const card: HomeCardFields = {
    id: row.id,
    label: 'Browser',
    reason: words.reason,
    tone: row.tone,
    title: row.title,
    detail,
    primary: action,
  }
  return { row, card }
}

export function browserHome(browser: BrowserState, _now: number): HomeContribution {
  const standing = STANDING[browser.engine.state]
  if (!standing) return { known: false }

  const contribution: HomeContribution = {
    known: true,
    tile: {
      key: 'browser',
      name: 'Browser',
      status: tileStatus(standing, browser),
      tone: standing.tone,
      note: tileNote(browser.engine),
      target: INTEGRATIONS_SCREEN,
    },
  }

  const need = installNeed(browser)
  return need ? { ...contribution, needs: [need] } : contribution
}
