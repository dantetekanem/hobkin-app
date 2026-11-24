import { BookOpen, Bot, Brain, CalendarClock, FileText, FolderGit2, House, Inbox, NotebookPen, Plug, Presentation, Puzzle, Settings2, Sigma, Waypoints, Workflow, Zap, type LucideIcon } from 'lucide-react'
import { isPartScreen, partScreens } from '../integration/screens.ts'

/** The screens the app has in itself, in menu order. An integration's screens come after Work (`screens`). */
const BEFORE_INTEGRATIONS = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'reports', label: 'Reports', icon: FileText },
  { id: 'routines', label: 'Routines', icon: CalendarClock },
  { id: 'actions', label: 'Action Items', icon: Inbox },
  { id: 'work', label: 'Work', icon: Workflow },
] as const satisfies readonly ScreenDefinition[]

const AFTER_INTEGRATIONS = [
  // These show in the menu only while something is open in them.
  { id: 'world', label: 'World', icon: Workflow, contextual: true },
  // YOLO mode's switch and each project's readiness, a page of Work's own as World is (049-yolo-mode).
  { id: 'yolo', label: 'YOLO mode', icon: Zap, contextual: true },
  // One project's page under Work, by its slug (053).
  { id: 'project', label: 'Project', icon: FolderGit2, contextual: true },
  // A TLA+ proof run, a page of its own opened from a card, an agent's step or the YOLO page (050-tla-proofs).
  { id: 'proof', label: 'Proof run', icon: Sigma, contextual: true },
  { id: 'agent', label: 'Agent', icon: Bot, contextual: true },
  { id: 'mind', label: "Hobkin's mind", icon: Brain, contextual: true },
  { id: 'review', label: 'Review', icon: Waypoints, contextual: true },
  { id: 'settings', label: 'Settings', icon: Settings2, contextual: true },
  { id: 'integrations', label: 'Integrations', icon: Plug, contextual: true },
  // Pi's skills and extensions, under Settings beside Integrations (039-skills-and-extensions).
  { id: 'skills', label: 'Skills', icon: BookOpen, contextual: true },
  { id: 'extensions', label: 'Pi extensions', icon: Puzzle, contextual: true },
  // What hobkin remembers for every agent it runs, under Settings beside them (057-shared-memory).
  { id: 'memory', label: 'Memory', icon: NotebookPen, contextual: true },
  // The main hobkin's canvas, a place on the right side while it is open (040-canvas-board). Last, so it comes in from
  // the right and every other screen comes back from the left.
  { id: 'canvas', label: 'Canvas', icon: Presentation, contextual: true },
] as const satisfies readonly ScreenDefinition[]

export type CoreScreenId = (typeof BEFORE_INTEGRATIONS)[number]['id'] | (typeof AFTER_INTEGRATIONS)[number]['id']

/** A core screen's id, or one of an integration's screens (its manifest's `screens`). */
export type ScreenId = CoreScreenId | (string & {})

export interface ScreenDefinition {
  id: string
  label: string
  icon: LucideIcon
  contextual?: boolean
}

let held: { parts: readonly unknown[]; list: readonly ScreenDefinition[] } | null = null

/**
 * The screens in menu order. The order sets the direction a screen comes in from: the app's own first, then each
 * integration's screens in folder order, then the contextual ones (_specs/064-integration-drops).
 */
export function screens(): readonly ScreenDefinition[] {
  const own = partScreens()
  if (held?.parts === own) return held.list
  const list = [...BEFORE_INTEGRATIONS, ...own.map(({ id, label, icon }) => ({ id, label, icon })), ...AFTER_INTEGRATIONS] as const
  held = { parts: own, list }
  return list
}

export function screenIndex(id: ScreenId): number {
  return screens().findIndex((screen) => screen.id === id)
}

/** Whether a screen has a place in the menu's first row. An integration's screens have one unless the user took them out of the menu. */
export function inMenu(id: ScreenId, outOfMenu: readonly string[] = []): boolean {
  const entry = screens().find((screen) => screen.id === id)
  return entry !== undefined && !('contextual' in entry) && !outOfMenu.includes(id)
}

export interface WalkView {
  /** The screen showing. */
  screen: ScreenId
  reviewOpen: boolean
  /** The screens the user took out of the menu. */
  outOfMenu?: readonly string[]
  /** The main hobkin's canvas is open, and the menu shows it: its group on the canvas, its pill anywhere else. */
  canvasOpen?: boolean
}

/** Numbered shortcuts follow the top menu and the contextual row the screen menu currently shows. */
export function walkScreens({ screen, outOfMenu = [], canvasOpen = false }: WalkView): ScreenId[] {
  const openNow: Partial<Record<ScreenId, boolean>> = {
    review: screen === 'review',
    settings: screen === 'settings' || screen === 'integrations' || screen === 'skills' || screen === 'extensions' || screen === 'memory',
    integrations: screen === 'integrations',
    skills: screen === 'skills',
    extensions: screen === 'extensions',
    memory: screen === 'memory',
    canvas: canvasOpen,
  }
  // An integration's screen the menu leaves out is in the walk while it is open.
  return screens().filter(({ id }) => inMenu(id, outOfMenu) || openNow[id] || (id === screen && isPartScreen(id))).map(({ id }) => id)
}

/**
 * The lists that open as a veil over the chat: earlier conversations. Projects live in Work, and running agents sit
 * at the bottom of the chat.
 */
export const VEIL_SECTIONS = ['history'] as const
export type VeilSection = (typeof VEIL_SECTIONS)[number]
