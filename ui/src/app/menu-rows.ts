import type { ScreenId } from './screens.ts'

/**
 * What the screen menu holds under its first row, as a rule with no window. A second row belongs only to a page that
 * keeps it for as long as it shows: an agent's page has the agents, and the canvas place its canvas's controls. On every
 * other page the menu keeps one row, and the main canvas's pill sits at the end of the trail's line (Trail.tsx), so
 * nothing on the page moves when the canvas opens or closes.
 */
export type SecondRow = 'agents' | 'canvas'

export interface MenuLayout {
  second: SecondRow | null
  /** Where the main canvas's pill goes: at the end of the second row, at the end of the trail's line, or nowhere. */
  pillOn: 'second' | 'trail' | null
}

export function menuLayout({ screen, canvasOpen, pill }: {
  screen: ScreenId
  /** The main canvas is open. */
  canvasOpen: boolean
  /** The menu shows the main canvas's pill here (`mainPill`). */
  pill: boolean
}): MenuLayout {
  const second: SecondRow | null = screen === 'agent' ? 'agents' : screen === 'canvas' && canvasOpen ? 'canvas' : null
  return { second, pillOn: !pill ? null : second === 'agents' ? 'second' : 'trail' }
}
