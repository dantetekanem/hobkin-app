import type { Floor, FloorInput, Level } from './types.ts'

const MISSING_PROOF = new Set(['none', 'mocked', 'unknown'])

const row = (rule: number, level: Level, why: string, extra: Partial<Floor> = {}): Floor => ({ level, rule, critical: false, why: `Floor rule ${rule}: ${why}`, ...extra })

/**
 * The floor table of FOUNDATION section 5.1: the first row that matches decides. It reads only its input, so the same
 * four facts and extras always give the same level, and no model is involved.
 */
export function floor(input: FloorInput): Floor {
  const { effect, proof, exposure, undo } = input

  if (input.broken) return row(1, 'high', input.broken, { critical: true })
  if (effect === 'text') return row(2, 'safe', 'only comments, whitespace or translations changed.')
  if (input.unreferencedRemoval) return row(2, 'safe', 'the removal is not referred to by anything that remains.')
  if (input.bucketChecksPassed) return row(2, 'safe', 'the checks for this kind of change all passed.')
  if (MISSING_PROOF.has(proof) && input.runsInRequest !== false) return row(3, 'high', 'no test that runs shows the changed lines work.')
  if (proof === 'isolated') return row(4, 'high', 'only tests that call it directly run the changed lines; no life cycle test reaches the change.')
  if (undo === 'none' && exposure !== 'nobody-yet') return row(5, 'high', 'nothing undoes it and it is not hidden behind a condition.')
  if ((effect === 'data' || effect === 'interface') && (exposure === 'everyone' || exposure === 'at-load') && !input.additiveSchema) {
    return row(6, 'high', `a ${effect} change that ${exposure === 'everyone' ? 'everyone runs' : 'takes effect at load'}.`)
  }
  if (exposure === 'everyone' && effect === 'behaviour' && (proof === 'lifecycle' || proof === 'lifecycle-observed')) {
    const why = 'behaviour changed for everyone, and a life cycle test runs it.'
    if (proof === 'lifecycle-observed') return row(7, 'mid', why)
    return row(7, 'mid', why, { finding: { rule: 'behaviour-changed-no-test-changed', text: 'behaviour changed, no test changed with it', by: 'floor' } })
  }
  if (undo === 'flag-with-residue') return row(8, 'mid', 'turning the condition off leaves what was written while it was on.')
  if (effect === 'load' || input.additiveSchema) return row(9, 'mid', 'takes effect at load, or adds to the schema.')
  if (exposure === 'subset') return row(10, 'mid', 'only some people run it.')
  if (exposure === 'nobody-yet' && undo === 'flag' && input.conditionOnProven && input.offPathProven) {
    return row(11, 'safe', 'behind a condition that is off, a test runs it with the condition on, and an unchanged test proves the off path.')
  }
  return row(12, 'mid', 'none of the rows above settles it.')
}
