/**
 * The frame every one-column screen shares (Routines, Action Items, Work, GitHub, Settings and the pages under it), so
 * they all start at the same height below the screen menu and run to the same width.
 *
 * The column spans the canvas and is centered by its padding, not by auto margins, so a screen that slides aside as a
 * whole (Routines, Action Items) takes all of its width out of view.
 */

/**
 * Where a page's content starts: right under the screen menu's one row and the trail under it (053), with 4px of air,
 * so the trail never covers its first line. The menu ends 56px from the canvas's top and the trail is 20px tall, 2px
 * under it. A page never starts anywhere else: the menu grows a second row only on pages with layouts of their own (an
 * agent's page, the canvas place, `menu-rows.ts`), and the main canvas's pill ends the trail's line instead. The canvas
 * sets it as `--page-top` (Canvas.tsx), which a page that places its first line itself reads too.
 */
export const PAGE_TOP = 82

/** The scroller that fills the canvas. Each screen adds its own bottom padding. */
export const SCREEN_SCROLLER = 'scroll-quiet h-full overflow-y-auto px-6 pt-(--page-top)'

/** The column inside it: 1040px of content, centered. */
export const SCREEN_COLUMN = 'px-[max(0px,calc((100%_-_1040px)_/_2))]'

/** The same frame for a screen's two-pane layer (list and detail, as in Reports and an open routine or action item). */
export const SCREEN_PANES =
  'grid grid-cols-[minmax(0,1fr)_minmax(300px,380px)] grid-rows-1 gap-3 px-[max(24px,calc((100%_-_1040px)_/_2))] pt-(--page-top) pb-3 @max-[800px]:grid-cols-1'
