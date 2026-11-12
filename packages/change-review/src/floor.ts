import type { Floor, FloorInput, Level } from './types.ts'

const MISSING_PROOF = new Set(['none', 'mocked', 'unknown'])

/** A row of the table: its number is data, and its reason is a plain sentence for the person deciding, with no rule name. */
const row = (rule: number, level: Level, why: string, extra: Partial<Floor> = {}): Floor => ({ level, rule, critical: false, why, ...extra })
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`

/**
 * The floor table of FOUNDATION section 5.1: the first row that matches decides. It reads only its input, so the same
 * four facts and extras always give the same level, and no model is involved.
 */
export function floor(input: FloorInput): Floor {
  const { effect, proof, exposure, undo } = input

  if (input.broken) return row(1, 'high', sentence(input.broken), { critical: true })
  if (effect === 'text') return row(2, 'safe', 'Only comments, whitespace or translations changed.')
  if (input.unreferencedRemoval) return row(2, 'safe', 'Nothing that remains refers to what was removed.')
  if (input.bucketChecksPassed) return row(2, 'safe', 'The checks for this kind of change all passed.')
  if (input.typeOnly) return row(2, 'safe', 'Only a type: the compiler checks it, and it is gone before the code runs.')
  if (MISSING_PROOF.has(proof) && input.runsInRequest !== false) return row(3, 'high', 'No test that runs reaches these lines.')
  if (proof === 'isolated') return row(4, 'high', 'Only tests that call it directly run it. No test goes through a request to it.')
  if (undo === 'none' && exposure !== 'nobody-yet') return row(5, 'high', 'Nothing undoes it, and no condition holds it back.')
  if ((effect === 'data' || effect === 'interface') && (exposure === 'everyone' || exposure === 'at-load') && !input.additiveSchema) {
    return row(6, 'high', `It changes ${effect === 'data' ? 'data' : 'an interface'}, and ${exposure === 'everyone' ? 'everyone runs it' : 'it takes effect at load'}.`)
  }
  if (exposure === 'everyone' && effect === 'behaviour' && (proof === 'lifecycle' || proof === 'lifecycle-observed')) {
    const why = 'It changes what everyone gets, and a test runs it through a request.'
    if (proof === 'lifecycle-observed') return row(7, 'mid', why)
    return row(7, 'mid', why, { finding: { rule: 'behaviour-changed-no-test-changed', text: 'behaviour changed, no test changed with it', by: 'floor' } })
  }
  if (undo === 'flag-with-residue') return row(8, 'mid', 'Turning the condition off leaves behind what it wrote.')
  if (effect === 'load' || input.additiveSchema) return row(9, 'mid', 'It takes effect at load, or adds to the schema.')
  if (exposure === 'subset') return row(10, 'mid', 'Only some people run it.')
  if (exposure === 'nobody-yet' && undo === 'flag' && input.conditionOnProven && input.offPathProven) {
    return row(11, 'safe', 'It is behind a condition that is off, and tests run it both on and off.')
  }
  return row(12, 'mid', 'Nothing settles it either way, so it gets a look.')
}
