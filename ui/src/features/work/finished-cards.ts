import type { FinishedGroup } from '#shared/protocol/work.ts'

/** The finished changes' order on the Work page, and their cards' lines. Pure, so it is tested without a window. Spec: 011-work. */

/**
 * The group that needs the user comes first, so it is never a long scroll away, and what runs left for the user comes
 * next, since no yes carries it. The others keep hobkin's order.
 */
export function needsFirst(groups: readonly FinishedGroup[]): FinishedGroup[] {
  const first = ['needs', 'left']
  return [...first.flatMap((name) => groups.filter((group) => group.name === name)), ...groups.filter(({ name }) => !first.includes(name))]
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
