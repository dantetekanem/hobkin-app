import type { FinishedGroup } from '#shared/protocol/work.ts'

/** The finished changes' order on the Work page, and their cards' lines. Pure, so it is tested without a window. Spec: 011-work. */

/** The group that needs the user comes first, so it is never a long scroll away. The others keep hobkin's order. */
export function needsFirst(groups: readonly FinishedGroup[]): FinishedGroup[] {
  return [...groups.filter(({ name }) => name === 'needs'), ...groups.filter(({ name }) => name !== 'needs')]
}

/**
 * How much of a proof hobkin sends a card (`LONGEST_PROOF` in its `src/cli/work/reads.mjs`). It cuts the proof there,
 * inside a word, and says nothing, so a line this long that does not end a sentence was cut.
 */
const HOBKIN_PROOF_MOST = 260
const ENDS_A_SENTENCE = /[.!?)\]"'`]$/

/**
 * A card's line as it should read when it arrived cut inside a word: ended at its last whole word, with an ellipsis.
 * The host's own cut ends in "…", and hobkin's cuts a proof at 260 characters without one. A line that was not cut
 * stays as it is.
 */
export function endAtWord(text: string): string {
  const flagged = text.endsWith('…')
  const cut = flagged || (text.length >= HOBKIN_PROOF_MOST && !ENDS_A_SENTENCE.test(text))
  if (!cut) return text
  const kept = (flagged ? text.slice(0, -1) : text).replace(/\s*\S*$/, '').replace(/[\s,;:/–-]+$/, '')
  return `${kept}…`
}
