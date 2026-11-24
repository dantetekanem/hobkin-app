/**
 * Which parts of the panel are drawn, by what is on screen. The story's opening says what the change does and the
 * notes on the review, so the panel says them only where no story is on screen: in Free Roam. A part with nothing to
 * show takes no room. Pure.
 */
import type { ReviewMode } from '../story/mode.ts'

export interface PanelSections {
  /** What the change does, in the panel. */
  does: boolean
  /** The notes on how the review was built, in the panel's foot. */
  notices: boolean
  /** The comments and questions written on the review. */
  comments: boolean
}

export function panelSections({ mode, does, notices, notes }: { mode: ReviewMode; does: string | null; notices: number; notes: number }): PanelSections {
  const roam = mode === 'roam'
  return { does: roam && does != null, notices: roam && notices > 0, comments: notes > 0 }
}
