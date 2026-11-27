import type { Mood } from '@/avatar/moods.tsx'

/**
 * The stops of the tour of the Home screen, as plain data so the words are easy to change.
 * A stop with no `target` shows its card in the middle, with nothing lit.
 */
export interface TourStep {
  id: string
  /** A CSS selector for the part of the app this stop is about. */
  target: string | null
  title: string
  text: string
  /** A key the app binds, shown as a small chip. Checked against the app's key list in the tests. */
  kbd?: string
  /** The face hobkin wears while it says this. */
  mood: Mood
}

const MENU = 'nav[aria-label="Screens"]'

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'chat',
    target: '[data-chat-side]',
    title: 'This is where we talk',
    text: 'Ask me anything or hand me work. I answer here, and I stay on the left of every screen.',
    mood: 'hello',
  },
  {
    id: 'memory',
    target: '[data-hob-home]',
    title: 'Why I know things',
    text: 'I keep our conversation, what you told me in setup, and notes from every run. So the next answer starts from what I already learned.',
    mood: 'thinking',
  },
  {
    id: 'mind',
    target: '[data-hob-home]',
    title: 'My mind',
    text: 'Press it to watch my main agent think beside the chat. Press it again to close.',
    kbd: '⌘J',
    mood: 'focused',
  },
  {
    id: 'home',
    target: `${MENU} button[aria-label="Home"]`,
    title: 'Home is your dashboard',
    text: 'What is coming up, what waits on you, and what I did while you were away. Everything on it opens the thing itself.',
    mood: 'happy',
  },
  {
    id: 'reports',
    target: `${MENU} button[aria-label="Reports"]`,
    title: 'Reports',
    text: 'Every check and every agent leaves a report here. I only speak up when something changed.',
    mood: 'idle',
  },
  {
    id: 'routines',
    target: `${MENU} button[aria-label="Routines"]`,
    title: 'Routines',
    text: "Each routine watches one thing on its own schedule and remembers what it already told you, so you only hear what's new.",
    mood: 'wink',
  },
  {
    id: 'actions',
    target: `${MENU} button[aria-label="Action Items"]`,
    title: 'Action Items',
    text: 'Decisions only you can make wait here until you answer.',
    mood: 'listening',
  },
  {
    id: 'work',
    target: `${MENU} button[aria-label="Work"]`,
    title: 'Work mode',
    text: 'Point me at a folder of projects and my agents take work on their own branches. Nothing lands without your yes.',
    mood: 'working',
  },
  {
    id: 'settings',
    target: MENU,
    title: 'Settings',
    text: 'Models, theme, movement and more. The defaults are good, and you can change them any time.',
    kbd: '⌘,',
    mood: 'idle',
  },
  {
    id: 'end',
    target: null,
    title: "That's the tour",
    text: "Search finds any screen, report, routine or agent. I'm by the message box when you need me.",
    kbd: '⌘K',
    mood: 'celebrating',
  },
]

/** The routine the setup ran, for the stop about its first report: its id, its name, and when the run started, in milliseconds. */
export interface FirstRunStop {
  routineId: string
  title: string
  startedAt: number
}

export interface TourOptions {
  /** Code was picked in the setup, or work mode has a folder: the Work stop shows. */
  work: boolean
  /** The routine the setup ran, when it ran one: a stop on Reports comes before the last. */
  firstRun: FirstRunStop | null
}

/** The stop about the first run's report: on its way while the run goes, then named once it lands. The tour never waits for it. */
export function firstReportStep({ title }: Pick<FirstRunStop, 'title'>, landed: boolean): TourStep {
  return {
    id: 'first-report',
    target: `${MENU} button[aria-label="Reports"]`,
    title: 'Your first report',
    text: landed ? `${title} just reported. Its report is here.` : `${title} is still looking. Its report lands here.`,
    mood: landed ? 'celebrating' : 'searching',
  }
}

/** Whether a report of the first run is in hobkin's reports: one of that routine's, from after the run started. */
export function reportLanded(reports: unknown, { routineId, startedAt }: FirstRunStop): boolean {
  if (!Array.isArray(reports)) return false
  return reports.some((row: unknown) => {
    const { scheduleId, at } = (row ?? {}) as { scheduleId?: unknown; at?: unknown }
    return scheduleId === routineId && typeof at === 'string' && Date.parse(at) >= startedAt
  })
}

/** The stops of this tour: Work only for code, and the first report's stop before the last after a first run. */
export function tourSteps({ work, firstRun }: TourOptions): TourStep[] {
  const steps = TOUR_STEPS.filter((step) => work || step.id !== 'work')
  if (!firstRun) return steps
  return [...steps.slice(0, -1), firstReportStep(firstRun, false), ...steps.slice(-1)]
}
