/** How long the first Escape waits for the second, in milliseconds. */
export const STOP_ARMED_MS = 3_000

/**
 * What an Escape does while hobkin is working. One press never stops a run: Escape is also how the keyboard leaves a
 * field or closes what is open, so a single press is too easy to make by mistake. The first press arms the stop and
 * the window says so; a second within `STOP_ARMED_MS` stops. `armedAt` is when the stop was armed, or null.
 */
export function stopKey(armedAt: number | null, now: number): { stop: boolean; armedAt: number | null } {
  if (armedAt !== null && now - armedAt <= STOP_ARMED_MS) return { stop: true, armedAt: null }
  return { stop: false, armedAt: now }
}
