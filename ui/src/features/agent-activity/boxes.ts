/**
 * The boxes of a transcript (a command's output, a file read, a diff) have a fixed most height and scroll inside. A
 * wheel over one that can still scroll that way moves the box, not the transcript, so it is not the user reading up.
 */

/** Marks a box that scrolls inside. */
export const BOX = 'data-aa-box'

interface Scrolling {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}

/** Whether the wheel over `target` scrolls a box rather than the transcript: the box still has lines that way. */
export function scrollsInside(target: { closest(selector: string): unknown } | null, deltaY: number): boolean {
  const box = target?.closest(`[${BOX}]`) as Scrolling | null | undefined
  if (!box) return false
  if (deltaY < 0) return box.scrollTop > 0
  return box.scrollTop + box.clientHeight < box.scrollHeight - 1
}
