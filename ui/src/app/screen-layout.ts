/**
 * The frame every one-column screen shares (Routines, Action Items, Work, GitHub, Settings and the pages under it), so
 * they all start at the same height below the screen menu and run to the same width.
 *
 * The column spans the canvas and is centered by its padding, not by auto margins, so a screen that slides aside as a
 * whole (Routines, Action Items) takes all of its width out of view.
 */

/**
 * Where a page's content starts: right under the screen menu and the trail under it (053), so the trail never covers
 * its first line. The menu ends 56px from the canvas's top with one row and 96px while it shows its second (the agents,
 * or the main canvas's pill or group), and the trail is 20px tall, 2px under it, with 4px of air before the page. The
 * menu sets `--page-top` on the canvas to the one that shows (ScreenMenu.tsx).
 */
export const PAGE_TOP = { oneRow: 82, twoRows: 122 } as const

/** The scroller that fills the canvas. Each screen adds its own bottom padding. */
export const SCREEN_SCROLLER = 'scroll-quiet h-full overflow-y-auto px-6 pt-[var(--page-top,82px)]'

/** The column inside it: 1040px of content, centered. */
export const SCREEN_COLUMN = 'px-[max(0px,calc((100%_-_1040px)_/_2))]'

/** The same frame for a screen's two-pane layer (list and detail, as in Reports and an open routine or action item). */
export const SCREEN_PANES =
  'grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] grid-rows-1 gap-3 px-[max(24px,calc((100%_-_1040px)_/_2))] pt-[var(--page-top,82px)] pb-3 @max-[800px]:grid-cols-1'
