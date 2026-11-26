/**
 * Where the New hobkin sheet's keyboard goes (`NewHobkin.tsx`). Command+N and Enter start a hobkin, so the keyboard belongs
 * on Start. Start waits, disabled, until the sheet has read the model settings, and a disabled button cannot take the
 * keyboard: it would stay on the page behind the sheet, where Enter sends that page's message.
 */

/** Where the keyboard goes as the sheet opens: Start when it can be pressed, the sheet itself until then. */
export function openingFocus(start: HTMLButtonElement | null, popup: HTMLElement | null): HTMLElement | null {
  return start && !start.disabled ? start : popup
}

/**
 * Whether Start takes the keyboard once it can be pressed: when it is on the sheet itself or anywhere outside the form,
 * not when it is already in the form, on Start or on a control the user moved to.
 */
export function startTakesKeyboard(active: Element | null, form: Element | null): boolean {
  return !active || !form?.contains(active)
}
