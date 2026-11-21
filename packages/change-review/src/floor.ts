import type { Floor, FloorInput, Level } from './types.ts'

const MISSING_PROOF = new Set(['none', 'mocked', 'unknown'])
const THROUGH_A_REQUEST = new Set(['lifecycle', 'lifecycle-observed'])

/** A row of the table: its number is data, and its reason is a plain sentence for the person deciding, with no rule name. */
const row = (rule: number, level: Level, why: string, extra: Partial<Floor> = {}): Floor => ({ level, rule, critical: false, why, ...extra })
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`

/**
 * The floor table of FOUNDATION section 5.1: the first row that matches decides. It reads only its input, so the same
 * four facts and extras always give the same level, and no model is involved.
 *
 * A level is the risk that the change breaks something. `high` is for a break that is shown, an effect nothing undoes,
 * or a changed contract nothing shows working. What no test showed is said, at `mid`: it is never `high` on its own,
 * because not having checked is not a sign that it breaks.
 *
 * A TLA+ model's check (050-tla-proofs) decides only for the model itself. What TLC said of a model that names the
 * file, or of a model that is no evidence, is said after the row's reason, and never moves the level.
 */
export function floor(input: FloorInput): Floor {
  const decided = rowOf(input)
  const told = [input.model && !['holds', 'violated'].includes(input.model.result) ? input.model.said : null, input.modeledBy].filter((said): said is string => Boolean(said))
  return told.length ? { ...decided, why: [decided.why, ...told.map(sentence)].join(' ') } : decided
}

function rowOf(input: FloorInput): Floor {
  const { effect, proof, exposure, undo } = input
  const shown = THROUGH_A_REQUEST.has(proof)

  if (input.broken) return row(1, 'high', sentence(input.broken), { critical: true })
  if (input.model?.result === 'violated') return row(1, 'high', sentence(input.model.said), { critical: true })
  if (input.context) return row(2, 'safe', 'Nothing in it changed: it is shown for context.')
  if (input.model?.result === 'holds') return row(2, 'safe', sentence(input.model.said))
  if (effect === 'text') return row(2, 'safe', 'Only comments, whitespace or translations changed.')
  if (input.unreferencedRemoval) return row(2, 'safe', 'Nothing that remains refers to what was removed.')
  if (input.bucketChecksPassed) return row(2, 'safe', 'The checks for this kind of change all passed.')
  if (input.isTest) return row(2, 'safe', 'A test: it is proof for the code it runs, and is read with that code.')
  if (input.typeOnly) return row(2, 'safe', 'Only a type: the compiler checks it, and it is gone before the code runs.')
  if (undo === 'none' && exposure !== 'nobody-yet') return row(3, 'high', 'Nothing undoes it, and no condition holds it back.')
  // Row 4: what other code or stored data relies on changed. High while nothing shows a request still working with it.
  if ((effect === 'data' || effect === 'interface') && (exposure === 'everyone' || exposure === 'at-load') && !input.additiveSchema) {
    const what = effect === 'data' ? 'data it writes, sends or keeps' : 'an interface other code uses'
    if (shown) return row(4, 'mid', `It changes ${what}, and a test goes through a request to it.`)
    return row(4, 'high', `It changes ${what}, ${exposure === 'everyone' ? 'everyone runs it' : 'it takes effect at load'}, and no test goes through a request to it.`)
  }
  // Rows 5 and 6: what the tests did not show. Said, and worth a look; never high, since nothing here says it breaks.
  // Code outside a request is entered by calling it, so the rows below decide for it.
  if (MISSING_PROOF.has(proof) && input.runsInRequest !== false) {
    return row(5, 'mid', 'No test that ran shows these lines work.', { finding: { rule: 'not-shown-by-a-test', text: 'no test that ran shows the change', by: 'floor' } })
  }
  if (proof === 'isolated' && input.runsInRequest !== false) {
    return row(6, 'mid', 'Tests that call it directly fail without the change. No test goes through a request to it.', {
      finding: { rule: 'direct-tests-only', text: 'direct tests fail without the change; no request test goes through it', by: 'floor' },
    })
  }
  if (undo === 'flag-with-residue') return row(7, 'mid', 'Turning the condition off leaves behind what it wrote.')
  if (effect === 'load' || input.additiveSchema) return row(8, 'mid', 'It takes effect at load, or adds to the schema.')
  if (effect === 'behaviour' && shown && (exposure === 'everyone' || exposure === 'subset')) {
    const why = 'Tests fail without the change, and a test goes through a request to it.'
    if (proof === 'lifecycle-observed' || input.testChangedWithIt) return row(9, 'safe', why)
    return row(9, 'safe', why, { finding: { rule: 'behaviour-changed-no-test-changed', text: 'behaviour changed, no test changed with it', by: 'floor' } })
  }
  // Direct tests alone never reach safe, in a request or outside one.
  if (exposure === 'nobody-yet' && undo === 'flag' && input.conditionOnProven && input.offPathProven && proof !== 'isolated') {
    return row(10, 'safe', 'It is behind a condition that is off, and tests run it both on and off.')
  }
  return row(11, 'mid', 'Nothing settles it either way, so it gets a look.')
}
