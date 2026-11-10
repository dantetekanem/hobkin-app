import { CalendarClock, CircleDot, FileText, GitPullRequest, Inbox, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import type { Mood } from '@/avatar/moods.tsx'
import { useWaitingRows } from '@/features/actions/store.ts'
import type { WaitingRow } from '@/features/actions/items.ts'
import { openGitHubPage, openPullRequestReview } from '@/features/github/open.ts'
import { newestFirst } from '@/features/reports/inbox.ts'
import { sourceOf, type Report } from '@/features/reports/report.ts'
import { useReports } from '@/features/reports/store.ts'
import { timeOf, waited } from '@/features/reports/time.ts'
import { useRoutines } from '@/features/routines/store.ts'
import type { Routine } from '@/features/routines/types.ts'
import { howOften } from '@/features/routines/words.ts'
import { useSettings } from '@/features/settings/store.ts'
import { useGitHub, type GitHubState } from '@/lib/host/index.ts'
import { requestCanvasFocus } from './focus.ts'
import { useRunningAgents, type RunningAgent } from './running-agents.ts'
import { inMenu, SCREENS, type ScreenId } from './screens.ts'
import type { SpotlightEntry } from './spotlight-search.ts'
import { isStill } from './still-rule.ts'
import { useView } from './view-store.ts'

/**
 * What the spotlight searches, read from the same stores and hooks the screens use: the screens, the sections of
 * Settings, the agents working now, the reports, the routines, what waits on the user, and their GitHub. Each entry
 * says how its row is drawn and where Enter takes the user. See _specs/026-spotlight.
 */

/** What stands before a row's title: an icon, or the small hood of an agent. */
export type SpotlightMark = { icon: LucideIcon } | { hood: { hue: number; mood: Mood; asking: boolean } }

export interface SpotlightTarget extends SpotlightEntry {
  mark: SpotlightMark
  /** The keys that open it from anywhere, shown at the end of its row. */
  keys?: string
  /** Goes there. The spotlight has already closed. */
  go: () => void
}

/** Other names for the screens, so they are found by what they hold. */
const SCREEN_WORDS: Partial<Record<ScreenId, string[]>> = {
  reports: ['runs', 'results'],
  routines: ['schedules', 'jobs'],
  actions: ['decisions', 'questions', 'waiting'],
  work: ['projects', 'queue', 'changes'],
  github: ['pull requests', 'issues', 'reviews', 'gh'],
  settings: ['preferences', 'options'],
  integrations: ['services', 'connections', 'mcp'],
}

const SCREEN_LINE: Partial<Record<ScreenId, string>> = {
  reports: 'What finished runs brought back',
  routines: 'Every routine and when it runs next',
  actions: 'Everything waiting on you',
  work: 'Projects, the queue and finished changes',
  github: 'Pull requests and issues, through gh',
  settings: 'How hobkin looks and works',
  integrations: 'The services hobkin can reach',
}

/** The screens the spotlight goes to. A review and an agent need something to show, so they are found as what they show. */
const PLACES: readonly ScreenId[] = ['reports', 'routines', 'actions', 'work', 'github', 'settings', 'integrations']

/** The tiles of Settings, by the name each one shows, with the words that find them. */
const SETTINGS: readonly { name: string; words: string[] }[] = [
  { name: 'Day and night', words: ['theme', 'dark', 'light', 'appearance'] },
  { name: 'Agents at once', words: ['parallel', 'how many'] },
  { name: 'Models', words: ['tiers', 'fast', 'mid', 'high', 'max'] },
  { name: 'Type', words: ['font', 'typeface', 'text face'] },
  { name: 'Daily budget', words: ['tokens', 'cost', 'limit', 'spend'] },
  { name: 'Movement', words: ['motion', 'animation', 'reduce motion', 'still', 'lively'] },
  { name: 'What leaves this Mac', words: ['privacy', 'usage events', 'feedback', 'telemetry'] },
  { name: 'Keys', words: ['keyboard', 'shortcuts'] },
  { name: 'Setup', words: ['first run', 'walkthrough', 'set up again'] },
  { name: 'Nerd stats', words: ['numbers', 'stats'] },
]

/** How long the spotlight waits for a screen that loads on demand to draw what it goes to: about a second. */
const MOST_FRAMES = 60

function stillNow(): boolean {
  const macAsksForLess = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  return isStill(useSettings.getState().movement, macAsksForLess)
}

/** The keyboard goes into the screen, which puts it where its reading starts. */
function enter(): void {
  useView.getState().engageCanvas()
  requestCanvasFocus()
}

/**
 * Then, once the arriving screen has drawn it, onto one thing in it, brought into view. A screen that loads on
 * demand can take a few frames; if the thing never comes, the keyboard stays where the screen put it.
 */
function landOn(find: (screen: HTMLElement) => HTMLElement | null | undefined): void {
  const attempt = (left: number) => {
    const screen = [...document.querySelectorAll<HTMLElement>('[data-canvas-screen]')].at(-1)
    const target = screen ? find(screen) : null
    if (target) {
      target.focus({ preventScroll: true })
      target.scrollIntoView({ block: 'center', behavior: stillNow() ? 'auto' : 'smooth' })
    } else if (left > 0) requestAnimationFrame(() => attempt(left - 1))
  }
  requestAnimationFrame(() => attempt(MOST_FRAMES))
}

function goToScreen(id: ScreenId): void {
  const view = useView.getState()
  // Settings and Integrations open over what is showing. Asked for again, they stay.
  if (id === 'settings') {
    if (view.screen !== 'settings') view.toggleSettings()
  } else if (id === 'integrations') {
    if (view.screen !== 'integrations') view.toggleIntegrations()
  } else if (id === 'github') view.openGitHub()
  else view.openScreen(id)
  enter()
}

/** A tile of Settings: the keyboard lands on its first control, or on the next one when the tile has none. */
function goToSetting(name: string): void {
  goToScreen('settings')
  landOn((screen) => {
    const tile = screen.querySelector<HTMLElement>(`section[aria-label="${CSS.escape(name)}"]`)
    if (!tile) return null
    const stops = [...screen.querySelectorAll<HTMLElement>('[data-stop]')]
    return stops.find((stop) => tile.contains(stop) || tile.compareDocumentPosition(stop) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
}

function screenTargets(githubInMenu: boolean): SpotlightTarget[] {
  const menu = SCREENS.filter(({ id }) => inMenu(id, githubInMenu)).map(({ id }) => id)
  const KEYS: Partial<Record<ScreenId, string>> = { settings: '⌘,', integrations: '⌘I' }
  return PLACES.map((id) => {
    const screen = SCREENS.find((entry) => entry.id === id)!
    const at = menu.indexOf(id)
    return {
      id: `screen:${id}`,
      kind: 'screen',
      title: screen.label,
      detail: SCREEN_LINE[id],
      keywords: SCREEN_WORDS[id],
      mark: { icon: screen.icon },
      keys: at >= 0 && at < 9 ? `⌘${at + 1}` : KEYS[id],
      go: () => goToScreen(id),
    }
  })
}

const SETTING_TARGETS: SpotlightTarget[] = SETTINGS.map(({ name, words }) => ({
  id: `setting:${name}`,
  kind: 'setting',
  title: name,
  detail: 'Settings',
  keywords: words,
  mark: { icon: SlidersHorizontal },
  go: () => goToSetting(name),
}))

function agentTarget(agent: RunningAgent): SpotlightTarget {
  return {
    id: `agent:${agent.id}`,
    kind: 'agent',
    title: agent.title,
    detail: agent.asks ?? `${agent.project} · ${agent.doing}`,
    keywords: [agent.project, agent.tier],
    mark: { hood: { hue: agent.hue, mood: agent.mood, asking: Boolean(agent.asks) } },
    go: () => {
      useView.getState().openAgentCanvas(agent.id)
      enter()
    },
  }
}

function reportTarget(report: Report, now: number): SpotlightTarget {
  const at = timeOf(report.at)
  return {
    id: `report:${report.id}`,
    kind: 'report',
    title: report.title,
    detail: at === null ? sourceOf(report) : `${sourceOf(report)} · ${waited(at, now)} ago`,
    keywords: [report.outcome],
    mark: { icon: FileText },
    go: () => {
      // The screen opens on the report in its reader, and the keyboard lands there.
      useReports.getState().open(report.id)
      goToScreen('reports')
    },
  }
}

function routineTarget(routine: Routine): SpotlightTarget {
  return {
    id: `routine:${routine.id}`,
    kind: 'routine',
    title: routine.title,
    detail: routine.enabled ? howOften(routine) : `${howOften(routine)} · off`,
    keywords: [routine.id],
    mark: { icon: CalendarClock },
    go: () => {
      // Its detail opens as if from its row in the list of all routines, and takes the keyboard.
      useRoutines.getState().open(routine.id, `routine-${routine.id}`)
      goToScreen('routines')
      landOn((screen) => screen.querySelector<HTMLElement>('[role="dialog"] [data-stop]'))
    },
  }
}

function actionTarget(row: WaitingRow, now: number): SpotlightTarget {
  const at = timeOf(row.at)
  return {
    id: `action:${row.id}`,
    kind: 'action',
    title: row.summary,
    detail: at === null ? row.from : `${row.from} · ${waited(at, now)} ago`,
    keywords: [row.kind],
    mark: { icon: Inbox },
    go: () => {
      goToScreen('actions')
      landOn((screen) => screen.querySelector<HTMLElement>(`[data-item-row="${CSS.escape(row.id)}"]`))
    },
  }
}

function githubTargets(github: GitHubState): SpotlightTarget[] {
  if (!github.sample && github.connection !== 'connected') return []
  const pull = (waits: boolean) => (pull: GitHubState['pulls'][number]): SpotlightTarget => ({
    id: `${waits ? 'review' : 'pull'}:${pull.url}`,
    kind: 'pull',
    title: pull.title,
    detail: `${pull.repo}#${pull.number} · ${waits ? 'waits for your review' : 'yours'}`,
    keywords: [...pull.labels, ...(pull.author ? [pull.author] : [])],
    mark: { icon: GitPullRequest },
    go: () => openPullRequestReview(pull),
  })
  return [
    ...github.reviews.map(pull(true)),
    ...github.pulls.map(pull(false)),
    ...github.issues.map((issue) => ({
      id: `issue:${issue.url}`,
      kind: 'issue' as const,
      title: issue.title,
      detail: `${issue.repo}#${issue.number}`,
      keywords: issue.labels,
      mark: { icon: CircleDot },
      go: () => openGitHubPage(issue.url),
    })),
  ]
}

/** Everything the spotlight can find right now. It follows the stores, so a new report or agent is found at once. */
export function useSpotlightTargets(): SpotlightTarget[] {
  const githubInMenu = useSettings((settings) => settings.showGitHubInMenu)
  const agents = useRunningAgents()
  const reports = useReports((state) => state.inbox.reports)
  const routines = useRoutines((state) => state.data.routines)
  const rows = useWaitingRows()
  const github = useGitHub()

  return useMemo(() => {
    const now = Date.now()
    return [
      ...screenTargets(githubInMenu),
      ...SETTING_TARGETS,
      ...agents.map(agentTarget),
      ...newestFirst(reports).map((report) => reportTarget(report, now)),
      ...routines.map(routineTarget),
      ...rows.map((row) => actionTarget(row, now)),
      ...githubTargets(github),
    ]
  }, [githubInMenu, agents, reports, routines, rows, github])
}
