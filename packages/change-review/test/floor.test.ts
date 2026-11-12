import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { floor } from '../src/floor.ts'
import type { FloorInput, Level } from '../src/types.ts'

const base: FloorInput = { effect: 'behaviour', proof: 'lifecycle', exposure: 'everyone', undo: 'rollback' }
const run = (patch: Partial<FloorInput>) => floor({ ...base, ...patch })

describe('floor table rows', () => {
  it('row 1: broken is high and critical', () => {
    const f = run({ broken: 'Billing#charge is removed but app/a.rb:4 still calls it', effect: 'text' })
    assert.deepEqual([f.level, f.rule, f.critical], ['high', 1, true])
    assert.equal(f.why, 'Billing#charge is removed but app/a.rb:4 still calls it.', 'what is broken, said plainly')
  })
  it('row 2: text, unreferenced removal or passed bucket checks are safe', () => {
    assert.equal(run({ effect: 'text', proof: 'none' }).rule, 2)
    assert.equal(run({ effect: 'interface', proof: 'not-applicable', unreferencedRemoval: true }).rule, 2)
    assert.equal(run({ effect: 'text', proof: 'not-applicable', bucketChecksPassed: true }).level, 'safe')
  })
  it('row 3: missing proof in a request is high, unless the code does not run in one', () => {
    for (const proof of ['none', 'mocked', 'unknown'] as const) assert.equal(run({ proof }).rule, 3)
    assert.equal(run({ proof: 'none' }).why, 'No test that runs reaches these lines.')
    assert.notEqual(run({ proof: 'none', runsInRequest: false }).rule, 3)
  })
  it('row 4: isolated proof is high', () => {
    assert.deepEqual([run({ proof: 'isolated' }).level, run({ proof: 'isolated' }).rule], ['high', 4])
  })
  it('row 5: undo none outside nobody-yet is high', () => {
    assert.equal(run({ undo: 'none' }).rule, 5)
    assert.notEqual(run({ undo: 'none', exposure: 'nobody-yet' }).rule, 5)
  })
  it('row 6: data or interface for everyone or at load is high unless additive', () => {
    assert.equal(run({ effect: 'data' }).rule, 6)
    assert.equal(run({ effect: 'interface', exposure: 'at-load' }).rule, 6)
    assert.equal(run({ effect: 'data', exposure: 'at-load', additiveSchema: true }).rule, 9)
  })
  it('row 7: behaviour for everyone with life cycle proof is mid; lifecycle alone adds a finding', () => {
    const observed = run({ proof: 'lifecycle-observed' })
    assert.deepEqual([observed.level, observed.rule, observed.finding], ['mid', 7, undefined])
    const old = run({ proof: 'lifecycle' })
    assert.equal(old.rule, 7)
    assert.deepEqual(old.finding, { rule: 'behaviour-changed-no-test-changed', text: 'behaviour changed, no test changed with it', by: 'floor' })
  })
  it('row 8: residue is mid', () => {
    assert.equal(run({ exposure: 'nobody-yet', undo: 'flag-with-residue', effect: 'data', proof: 'lifecycle-observed' }).rule, 8)
  })
  it('row 9: load or additive schema is mid', () => {
    assert.equal(run({ effect: 'load', exposure: 'at-load', proof: 'not-applicable' }).rule, 9)
  })
  it('row 10: subset is mid', () => {
    assert.equal(run({ exposure: 'subset', undo: 'flag' }).rule, 10)
  })
  it('row 11: flagged, proven on and off is safe; either missing falls to 12', () => {
    const flagged = { exposure: 'nobody-yet', undo: 'flag', proof: 'lifecycle-observed' } as const
    assert.equal(run({ ...flagged, conditionOnProven: true, offPathProven: true }).rule, 11)
    assert.equal(run({ ...flagged, conditionOnProven: true }).rule, 12)
    assert.equal(run({ ...flagged, offPathProven: true }).level, 'mid')
  })
  it('row 12: anything else is mid', () => {
    const f = run({ exposure: 'nobody-yet', undo: 'rollback', proof: 'not-applicable' })
    assert.deepEqual([f.level, f.rule, f.critical], ['mid', 12, false])
  })
})

describe('floor cases', () => {
  it('the sixteen cases of FOUNDATION section 14', () => {
    const flagged = { conditionOnProven: true, offPathProven: true }
    const cases: [string, Partial<FloorInput>, Level, number, boolean?][] = [
      ['1', { exposure: 'nobody-yet', undo: 'flag', proof: 'lifecycle-observed', ...flagged }, 'safe', 11],
      ['2', { exposure: 'nobody-yet', undo: 'flag', proof: 'isolated' }, 'high', 4],
      ['3', { effect: 'data', exposure: 'nobody-yet', undo: 'flag-with-residue', proof: 'lifecycle-observed' }, 'mid', 8],
      ['4', { proof: 'lifecycle' }, 'mid', 7],
      ['5', { proof: 'none' }, 'high', 3],
      ['6', { effect: 'interface', proof: 'not-applicable', broken: 'one caller remains' }, 'high', 1, true],
      ['7', { effect: 'data', proof: 'not-applicable', exposure: 'at-load', undo: 'none' }, 'high', 5],
      ['8', { effect: 'data', proof: 'not-applicable', exposure: 'at-load', additiveSchema: true }, 'mid', 9],
      ['9', { effect: 'load', proof: 'not-applicable', exposure: 'at-load' }, 'mid', 9],
      ['10', { effect: 'text', proof: 'not-applicable', broken: 'two keys missing in one locale' }, 'high', 1, true],
      ['11', { effect: 'text', proof: 'not-applicable', bucketChecksPassed: true }, 'safe', 2],
      ['12', { effect: 'interface', proof: 'not-applicable', unreferencedRemoval: true }, 'safe', 2],
      ['13', { effect: 'interface', proof: 'not-applicable', broken: 'a route names a removed controller' }, 'high', 1, true],
      ['14', { proof: 'lifecycle' }, 'mid', 7],
      ['15', { proof: 'mocked' }, 'high', 3],
      ['16', { effect: 'text', proof: 'not-applicable' }, 'safe', 2],
    ]
    assert.equal(cases.length, 16)
    for (const [name, patch, level, rule, critical = false] of cases) {
      const f = run(patch)
      assert.deepEqual([name, f.level, f.rule, f.critical], [name, level, rule, critical])
    }
  })

  it('is pure: the same input gives the same answer and the input is untouched', () => {
    const input: FloorInput = { ...base, proof: 'lifecycle' }
    const copy = structuredClone(input)
    assert.deepEqual(floor(input), floor(input))
    assert.deepEqual(input, copy)
  })
})

it('a type and nothing else is safe by rule 2: the compiler checks it, not a test', () => {
  const result = floor({ effect: 'interface', proof: 'not-applicable', exposure: 'everyone', undo: 'rollback', typeOnly: true })
  assert.equal(result.level, 'safe')
  assert.equal(result.rule, 2)
  assert.match(result.why, /^Only a type: the compiler checks it/)
})
