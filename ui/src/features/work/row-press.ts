/**
 * Whether a click on a row of Work is a press of the row itself (_specs/053-work-control-room, "Work"): a finished
 * change's card opens its review, a project's row its page, a queue row takes the keyboard. A click on one of the
 * row's own controls is the control's, and a click that ends a selection of its words is the user reading.
 */

/** What on a row acts by itself. A press there is not the row's. */
export const OWN_CONTROLS =
  'a[href], button, input, textarea, select, label, summary, [contenteditable="true"], [data-row-control], [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"], [role="radiogroup"], [role="tab"], [role="menuitem"]'

/** A piece of the page, as an Element is one, or a test's fake. */
interface Piece<Self> {
  closest(selectors: string): Self | null
  contains(other: Self | null): boolean
}

/** `selected` is the text selected on the page as the click ends. */
export function pressesRow<Self extends Piece<Self>>(target: Self | null, row: Self, selected: string): boolean {
  if (!target || !row.contains(target) || selected.trim()) return false
  const control = target.closest(OWN_CONTROLS)
  return control === null || control === row || !row.contains(control)
}

/** The same, read from a click. */
export function clickPressesRow(event: { target: EventTarget | null; currentTarget: Element }): boolean {
  const target = event.target instanceof Element ? event.target : null
  return pressesRow(target, event.currentTarget, globalThis.getSelection?.()?.toString() ?? '')
}
