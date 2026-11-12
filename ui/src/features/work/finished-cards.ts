import type { FinishedGroup } from '#shared/protocol/work.ts'

/** The finished changes' order on the Work page, and their cards' lines. Pure, so it is tested without a window. Spec: 011-work. */

/** The group that needs the user comes first, so it is never a long scroll away. The others keep hobkin's order. */
export function needsFirst(groups: readonly FinishedGroup[]): FinishedGroup[] {
  return [...groups.filter(({ name }) => name === 'needs'), ...groups.filter(({ name }) => name !== 'needs')]
}

/**
 * Where a hobkin from before 2026-11-12 cut a proof: at 260 characters, inside a word, saying nothing, so a proof
 * exactly this long that does not end a sentence was cut. hobkin now sends a proof whole up to 2000 characters, and
 * hobkin and the host cut a longer line at a word themselves and end it with "…".
 */
const OLDER_HOBKIN_PROOF_CUT = 260
const ENDS_A_SENTENCE = /[.!?)\]"'`…]$/

/** A card's line as it should read: one an older hobkin cut inside a word ends at its last whole word, with an ellipsis. Any other stays as it came. */
export function endAtWord(text: string): string {
  if (text.length !== OLDER_HOBKIN_PROOF_CUT || ENDS_A_SENTENCE.test(text)) return text
  return `${text.replace(/\s*\S*$/, '').replace(/[\s,;:/–-]+$/, '')}…`
}
