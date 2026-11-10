import { Bot, CalendarClock, FileText, GitPullRequest, Inbox, Plug, Settings2, Waypoints, Workflow, type LucideIcon } from 'lucide-react'

/** The screens, in menu order: the order of hobkin's terminal tabs, then GitHub. The order sets the direction a screen comes in from. */
export const SCREENS = [
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'routines', label: 'Routines', icon: CalendarClock },
  { id: 'actions', label: 'Action Items', icon: Inbox },
  { id: 'work', label: 'Work', icon: Workflow },
  // Issues and pull requests through the user's own gh (024-github). The user can take it out of the menu, in Integrations.
  { id: 'github', label: 'GitHub', icon: GitPullRequest },
  // These show in the menu only while something is open in them.
  { id: 'agent', label: 'Agent', icon: Bot, contextual: true },
  { id: 'review', label: 'Review', icon: Waypoints, contextual: true },
  { id: 'settings', label: 'Settings', icon: Settings2, contextual: true },
  { id: 'integrations', label: 'Integrations', icon: Plug, contextual: true },
] as const satisfies readonly ScreenDefinition[]

export type ScreenId = (typeof SCREENS)[number]['id']

interface ScreenDefinition {
  id: string
  label: string
  icon: LucideIcon
  contextual?: boolean
}

export function screenIndex(id: ScreenId): number {
  return SCREENS.findIndex((screen) => screen.id === id)
}

/** Whether a screen has a place in the menu's first row. GitHub has one unless the user took it out of the menu. */
export function inMenu(id: ScreenId, githubInMenu: boolean): boolean {
  const entry = SCREENS.find((screen) => screen.id === id)
  return entry !== undefined && !('contextual' in entry) && (githubInMenu || id !== 'github')
}

export interface WalkView {
  /** The screen showing. */
  screen: ScreenId
  reviewOpen: boolean
  githubInMenu: boolean
}

/**
 * The screens Tab walks and Command with a number opens, in menu order: the menu's own, then a review, Settings or
 * Integrations while one is open. A GitHub the menu leaves out is walked only while it is open. Agents are never
 * here: they are reached with Down and walked with Up and Down.
 */
export function walkScreens({ screen, reviewOpen, githubInMenu }: WalkView): ScreenId[] {
  const openNow: Partial<Record<ScreenId, boolean>> = {
    review: reviewOpen,
    settings: screen === 'settings',
    integrations: screen === 'integrations',
    github: screen === 'github',
  }
  return SCREENS.filter(({ id }) => inMenu(id, githubInMenu) || openNow[id]).map(({ id }) => id)
}

/**
 * The lists that open as a veil over the chat: earlier conversations. Projects live in Work, and running agents sit
 * at the bottom of the chat.
 */
export const VEIL_SECTIONS = ['history'] as const
export type VeilSection = (typeof VEIL_SECTIONS)[number]
