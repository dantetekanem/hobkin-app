import { BookOpen, Bot, Brain, CalendarClock, FileText, GitPullRequest, House, Inbox, Plug, Presentation, Puzzle, Settings2, Waypoints, Workflow, Zap, type LucideIcon } from 'lucide-react'

/** The screens in menu order. The order sets the direction a screen comes in from. */
export const SCREENS = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'routines', label: 'Routines', icon: CalendarClock },
  { id: 'actions', label: 'Action Items', icon: Inbox },
  { id: 'work', label: 'Work', icon: Workflow },
  // Issues and pull requests through the user's own gh (024-github). The user can take it out of the menu, in Integrations.
  { id: 'github', label: 'GitHub', icon: GitPullRequest },
  // These show in the menu only while something is open in them.
  { id: 'world', label: 'World', icon: Workflow, contextual: true },
  // YOLO mode's switch and each project's readiness, a page of Work's own as World is (049-yolo-mode).
  { id: 'yolo', label: 'YOLO mode', icon: Zap, contextual: true },
  { id: 'agent', label: 'Agent', icon: Bot, contextual: true },
  { id: 'mind', label: "Hobkin's mind", icon: Brain, contextual: true },
  { id: 'review', label: 'Review', icon: Waypoints, contextual: true },
  { id: 'settings', label: 'Settings', icon: Settings2, contextual: true },
  { id: 'integrations', label: 'Integrations', icon: Plug, contextual: true },
  // Pi's skills and extensions, under Settings beside Integrations (039-skills-and-extensions).
  { id: 'skills', label: 'Skills', icon: BookOpen, contextual: true },
  { id: 'extensions', label: 'Pi extensions', icon: Puzzle, contextual: true },
  // The main hobkin's canvas, a place on the right side while it is open (040-canvas-board). Last, so it comes in from
  // the right and every other screen comes back from the left.
  { id: 'canvas', label: 'Canvas', icon: Presentation, contextual: true },
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
  /** The main hobkin's canvas is open, and the menu shows it: its group on the canvas, its pill anywhere else. */
  canvasOpen?: boolean
}

/** Numbered shortcuts follow the top menu and the contextual row the screen menu currently shows. */
export function walkScreens({ screen, githubInMenu, canvasOpen = false }: WalkView): ScreenId[] {
  const openNow: Partial<Record<ScreenId, boolean>> = {
    review: screen === 'review',
    settings: screen === 'settings' || screen === 'integrations' || screen === 'skills' || screen === 'extensions',
    integrations: screen === 'integrations',
    skills: screen === 'skills',
    extensions: screen === 'extensions',
    github: screen === 'github',
    canvas: canvasOpen,
  }
  return SCREENS.filter(({ id }) => inMenu(id, githubInMenu) || openNow[id]).map(({ id }) => id)
}

/**
 * The lists that open as a veil over the chat: earlier conversations. Projects live in Work, and running agents sit
 * at the bottom of the chat.
 */
export const VEIL_SECTIONS = ['history'] as const
export type VeilSection = (typeof VEIL_SECTIONS)[number]
