import { Bot, CalendarClock, FileText, GitPullRequest, Inbox, LayoutDashboard, Plug, Settings2, Waypoints, Workflow, type LucideIcon } from 'lucide-react'

/** The canvas screens, in menu order: the order of hobkin's terminal tabs, then Pages. The order sets the direction a screen comes in from. */
export const SCREENS = [
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'routines', label: 'Routines', icon: CalendarClock },
  { id: 'actions', label: 'Action Items', icon: Inbox },
  { id: 'work', label: 'Work', icon: Workflow },
  { id: 'pages', label: 'Pages', icon: LayoutDashboard },
  // These show in the menu only while something is open in them.
  { id: 'agent', label: 'Agent', icon: Bot, contextual: true },
  { id: 'review', label: 'Review', icon: Waypoints, contextual: true },
  { id: 'settings', label: 'Settings', icon: Settings2, contextual: true },
  { id: 'integrations', label: 'Integrations', icon: Plug, contextual: true },
  // A page under Pages: issues and pull requests through the user's own gh (024-github).
  { id: 'github', label: 'GitHub', icon: GitPullRequest, contextual: true },
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

/** The lists that open as a veil over the chat. Running agents are not here: they sit at the bottom of the chat. */
export const VEIL_SECTIONS = ['projects', 'history'] as const
export type VeilSection = (typeof VEIL_SECTIONS)[number]
