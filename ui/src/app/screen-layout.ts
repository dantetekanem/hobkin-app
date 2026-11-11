/**
 * The frame every one-column screen shares (Routines, Action Items, Work, GitHub, Integrations, Settings), so they all
 * start at the same height below the screen menu and run to the same width.
 *
 * The column spans the canvas and is centered by its padding, not by auto margins, so a screen that slides aside as a
 * whole (Routines, Action Items) takes all of its width out of view.
 */

/** The scroller that fills the canvas. Each screen adds its own bottom padding. */
export const SCREEN_SCROLLER = 'scroll-quiet h-full overflow-y-auto px-6 pt-[78px]'

/**
 * The same, for a screen the menu shows with a second row under it (Settings, Integrations, and GitHub when the user took
 * it out of the menu): the row is taller, so the content starts below it.
 */
export const SCREEN_SCROLLER_UNDER_SECOND_ROW = 'scroll-quiet h-full overflow-y-auto px-6 pt-[116px]'

/** The column inside it: 1040px of content, centered. */
export const SCREEN_COLUMN = 'px-[max(0px,calc((100%_-_1040px)_/_2))]'

/** The same frame for a screen's two-pane layer (list and detail, as in Reports and an open routine or action item). */
export const SCREEN_PANES =
  'grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] grid-rows-1 gap-3 px-[max(24px,calc((100%_-_1040px)_/_2))] pt-[78px] pb-3 @max-[800px]:grid-cols-1'
