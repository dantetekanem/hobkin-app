/**
 * Where each piece of the agents dock's list sits, and which rows are drawn. The list shows about four rows and
 * scrolls through the rest, so with a hundred agents it mounts only the rows nearest the middle of its view, six at
 * most, and always the selected one, which the list names to a screen reader and the keyboard walks from. Pure, so the
 * rule is tested without a window.
 */

/** Four rows of the list, in pixels: how tall it grows. Each group's header and the line between the groups add their own height. */
export const FOUR_ROWS = 188
export const GROUP_HEAD = 24
export const GROUP_LINE = 13
/**
 * One agent's row until the dock measures one: its padding (12 px), the name's line (13 px at 1.25) and the line of
 * words under it (11 px at the page's 1.5).
 */
export const ROW = 44.75
/** The most rows the list mounts at once. */
export const MOST_ROWS = 6

/** The list's two groups and the height of a row: the durable hobkins first, then the agents that come and go under their header. */
export interface DockShape {
  durable: number
  others: number
  row: number
}

/** Where the agents that come and go start: past the durable hobkins, the line and their header, when those show. */
const othersFrom = ({ durable, others, row }: DockShape) => durable * row + (others ? GROUP_HEAD + (durable ? GROUP_LINE : 0) : 0)

/** The tops of the line between the groups and of the others' header. Null for what does not show. */
export function headsOf(shape: DockShape): { line: number | null; head: number | null } {
  if (!shape.others) return { line: null, head: null }
  const line = shape.durable ? shape.durable * shape.row : null
  return { line, head: shape.durable * shape.row + (line === null ? 0 : GROUP_LINE) }
}

/** The top of row `index`, counting the durable hobkins and then the others as one walk. */
export function rowTop(shape: DockShape, index: number): number {
  return index < shape.durable ? index * shape.row : othersFrom(shape) + (index - shape.durable) * shape.row
}

/** The height of the whole list, drawn or not. */
export function listHeight(shape: DockShape): number {
  return othersFrom(shape) + shape.others * shape.row
}

/** The most the list shows: four rows, with room for the headers and the line between the groups. */
export function dockHeight(shape: DockShape): number {
  return FOUR_ROWS + (shape.others ? GROUP_HEAD : 0) + (shape.durable && shape.others ? GROUP_LINE : 0)
}

/** How tall the list is on screen: as tall as it grows, or less when fewer rows fill it. */
export function viewHeight(shape: DockShape): number {
  return Math.min(listHeight(shape), dockHeight(shape))
}

/** The scroll that puts row `index` in the middle of the view, within the list's ends. */
export function centeredOn(shape: DockShape, index: number): number {
  const view = viewHeight(shape)
  return Math.max(0, Math.min(rowTop(shape, index) + shape.row / 2 - view / 2, listHeight(shape) - view))
}

/**
 * The rows to mount, in order: the selected one wherever it is, then the ones nearest the middle of the view, which
 * are the ones in it and then the next ones past its edges, up to six in all.
 */
export function rowsInView(shape: DockShape, scrollTop: number, selected: number | null): number[] {
  const count = shape.durable + shape.others
  const middle = scrollTop + viewHeight(shape) / 2
  const away = (index: number) => Math.abs(rowTop(shape, index) + shape.row / 2 - middle)
  const nearest = Array.from({ length: count }, (_, index) => index).sort((left, right) => away(left) - away(right))
  const rows = selected !== null && selected >= 0 && selected < count ? [selected] : []
  for (const index of nearest) {
    if (rows.length >= MOST_ROWS) break
    if (index !== selected) rows.push(index)
  }
  return rows.sort((left, right) => left - right)
}

/** Where Up or Down moves the selection: to the next agent, no further than the last, and from the first back to the input. */
export function stepped(current: number, key: 'ArrowUp' | 'ArrowDown', count: number): number | 'input' {
  if (key === 'ArrowDown') return Math.min(current + 1, count - 1)
  return current === 0 ? 'input' : current - 1
}

/**
 * The agent the list brings to the middle: the one on the canvas, once the list has it. An agent opened at once, as a
 * new hobkin is, reaches the list a moment later, and is followed then. Its place changing is no reason to follow it again.
 */
export function followedAgent(onAgent: boolean, openAgent: string | null, agents: readonly { id: string }[]): string | null {
  return onAgent && openAgent !== null && agents.some((agent) => agent.id === openAgent) ? openAgent : null
}
