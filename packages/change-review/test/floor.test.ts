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
  it('row 3: an effect nothing undoes is high, unless nobody runs it yet', () => {
    assert.deepEqual([run({ undo: 'none' }).level, run({ undo: 'none' }).rule], ['high', 3])
    assert.notEqual(run({ undo: 'none', exposure: 'nobody-yet' }).rule, 3)
  })
  it('row 4: data or an interface for everyone or at load is high while no test goes through a request to it, and mid once one does', () => {
    for (const proof of ['none', 'mocked', 'unknown', 'isolated', 'not-applicable'] as const) {
      assert.deepEqual([run({ effect: 'data', proof }).level, run({ effect: 'data', proof }).rule], ['high', 4])
    }
    assert.equal(run({ effect: 'interface', proof: 'none', exposure: 'at-load' }).why, 'It changes an interface other code uses, it takes effect at load, and no test goes through a request to it.')
    const shown = run({ effect: 'data', proof: 'lifecycle' })
    assert.deepEqual([shown.level, shown.rule], ['mid', 4])
    assert.equal(shown.why, 'It changes data it writes, sends or keeps, and a test goes through a request to it.')
    assert.equal(run({ effect: 'data', proof: 'not-applicable', exposure: 'at-load', additiveSchema: true }).rule, 8)
  })
  it('row 5: what no test showed is said at mid, never high: not having checked is no sign that it breaks', () => {
    for (const proof of ['none', 'mocked', 'unknown'] as const) assert.deepEqual([run({ proof }).level, run({ proof }).rule], ['mid', 5])
    assert.equal(run({ proof: 'none' }).why, 'No test that ran shows these lines work.')
    assert.deepEqual(run({ proof: 'unknown' }).finding, { rule: 'not-shown-by-a-test', text: 'no test that ran shows the change', by: 'floor' })
    assert.equal(run({ proof: 'none', exposure: 'nobody-yet', undo: 'flag' }).rule, 5, 'a flag does not stand in for a test')
    assert.notEqual(run({ proof: 'none', runsInRequest: false }).rule, 5)
  })
  it('row 6: direct tests alone are mid, and say what they leave unshown', () => {
    const f = run({ proof: 'isolated' })
    assert.deepEqual([f.level, f.rule, f.critical], ['mid', 6, false])
    assert.equal(f.why, 'Tests that call it directly fail without the change. No test goes through a request to it.')
    assert.deepEqual(f.finding, { rule: 'direct-tests-only', text: 'direct tests fail without the change; no request test goes through it', by: 'floor' })
    assert.equal(run({ proof: 'isolated', exposure: 'subset' }).level, 'mid')
  })
  it('code that runs outside a request is entered by calling it, so its direct tests go on to the rows below, and never reach safe', () => {
    const script = run({ proof: 'isolated', runsInRequest: false })
    assert.deepEqual([script.level, script.rule], ['mid', 11])
    assert.equal(run({ proof: 'isolated', runsInRequest: false, effect: 'data' }).rule, 4)
    assert.equal(run({ proof: 'isolated', runsInRequest: false, undo: 'none' }).rule, 3)
    const flagged = run({ proof: 'isolated', runsInRequest: false, exposure: 'nobody-yet', undo: 'flag', conditionOnProven: true, offPathProven: true })
    assert.notEqual(flagged.level, 'safe', 'safe needs a test that goes through the life cycle')
  })
  it('row 7: residue is mid', () => {
    assert.equal(run({ exposure: 'nobody-yet', undo: 'flag-with-residue', effect: 'data', proof: 'lifecycle-observed' }).rule, 7)
    assert.equal(run({ undo: 'flag-with-residue', proof: 'lifecycle-observed' }).level, 'mid', 'shown through a request, and still leaving something behind')
  })
  it('row 8: load or additive schema is mid', () => {
    assert.equal(run({ effect: 'load', exposure: 'at-load', proof: 'not-applicable' }).rule, 8)
  })
  it('row 9: a change of behaviour that tests show through a request is safe: that code changes what it does is no risk in itself', () => {
    const observed = run({ proof: 'lifecycle-observed' })
    assert.deepEqual([observed.level, observed.rule, observed.finding], ['safe', 9, undefined])
    assert.equal(observed.why, 'Tests fail without the change, and a test goes through a request to it.')
    const old = run({ proof: 'lifecycle' })
    assert.deepEqual([old.level, old.rule], ['safe', 9])
    assert.deepEqual(old.finding, { rule: 'behaviour-changed-no-test-changed', text: 'behaviour changed, no test changed with it', by: 'floor' })
    assert.equal(run({ proof: 'lifecycle', testChangedWithIt: true }).finding, undefined, 'a test changed with it shows the change, while an older one goes through the request')
    assert.deepEqual([run({ proof: 'lifecycle', exposure: 'subset', undo: 'flag' }).level, run({ proof: 'lifecycle', exposure: 'subset', undo: 'flag' }).rule], ['safe', 9])
  })
  it('row 10: flagged, proven on and off is safe; either missing falls to 11', () => {
    const flagged = { exposure: 'nobody-yet', undo: 'flag', proof: 'lifecycle-observed' } as const
    assert.equal(run({ ...flagged, conditionOnProven: true, offPathProven: true }).rule, 10)
    assert.equal(run({ ...flagged, conditionOnProven: true }).rule, 11)
    assert.equal(run({ ...flagged, offPathProven: true }).level, 'mid')
  })
  it('row 11: anything else is mid', () => {
    const f = run({ exposure: 'nobody-yet', undo: 'rollback', proof: 'not-applicable' })
    assert.deepEqual([f.level, f.rule, f.critical], ['mid', 11, false])
  })
  it('a TLA+ model TLC checked at this commit: holding is safe, a head-only broken rule needs attribution, and anything else is said beside the row that decides', () => {
    const holds = run({ proof: 'unknown', model: { result: 'holds', said: 'TLC checked Sale.tla at this commit: it holds in 15 states' } })
    assert.deepEqual([holds.level, holds.rule, holds.why], ['safe', 2, 'TLC checked Sale.tla at this commit: it holds in 15 states.'])
    const broke = run({ proof: 'unknown', model: { result: 'violated', said: 'TLC checked Sale.tla at this commit: StockInBounds breaks in 4 steps' } })
    assert.deepEqual([broke.level, broke.rule, broke.critical], ['mid', 5, false])
    assert.match(broke.why, /merge impact is unknown/)
    // A hold with an action that never ran checked nothing that action guards: no evidence, so the rows below decide.
    const unproven = run({ proof: 'unknown', model: { result: 'unproven', said: 'TLC checked Sale.tla at this commit: it held, but Restock never ran' } })
    assert.deepEqual([unproven.level, unproven.rule, unproven.why], ['mid', 5, 'TLC checked Sale.tla at this commit: it held, but Restock never ran. It needs to pass before merging.'])
  })
  it('what a model of a file says is told beside the row that decides, and never decides', () => {
    const modeledBy = 'Sale.tla models this file and holds in 15 states at this commit'
    assert.deepEqual([run({ proof: 'unknown', modeledBy }).level, run({ proof: 'unknown', modeledBy }).why], ['mid', `No test that ran shows these lines work. ${modeledBy}.`])
    const data = run({ effect: 'data', proof: 'unknown', modeledBy })
    assert.deepEqual([data.level, data.rule], ['high', 4], 'a model that holds lowers no break')
  })
})

describe('floor cases', () => {
  it('the twenty-two cases of FOUNDATION section 14', () => {
    const flagged = { conditionOnProven: true, offPathProven: true }
    const cases: [string, Partial<FloorInput>, Level, number, boolean?][] = [
      ['1', { exposure: 'nobody-yet', undo: 'flag', proof: 'lifecycle-observed', ...flagged }, 'safe', 10],
      ['2', { exposure: 'nobody-yet', undo: 'flag', proof: 'isolated' }, 'mid', 6],
      ['3', { effect: 'data', exposure: 'nobody-yet', undo: 'flag-with-residue', proof: 'lifecycle-observed' }, 'mid', 7],
      ['4', { proof: 'lifecycle' }, 'safe', 9],
      ['5', { proof: 'none' }, 'mid', 5],
      ['6', { effect: 'interface', proof: 'not-applicable', broken: 'one caller remains' }, 'high', 1, true],
      ['7', { effect: 'data', proof: 'not-applicable', exposure: 'at-load', undo: 'none' }, 'high', 3],
      ['8', { effect: 'data', proof: 'not-applicable', exposure: 'at-load', additiveSchema: true }, 'mid', 8],
      ['9', { effect: 'load', proof: 'not-applicable', exposure: 'at-load' }, 'mid', 8],
      ['10', { effect: 'text', proof: 'not-applicable', broken: 'two keys missing in one locale' }, 'high', 1, true],
      ['11', { effect: 'text', proof: 'not-applicable', bucketChecksPassed: true }, 'safe', 2],
      ['12', { effect: 'interface', proof: 'not-applicable', unreferencedRemoval: true }, 'safe', 2],
      ['13', { effect: 'interface', proof: 'not-applicable', broken: 'a route names a removed controller' }, 'high', 1, true],
      ['14', { proof: 'lifecycle' }, 'safe', 9],
      ['15', { proof: 'mocked' }, 'mid', 5],
      ['16', { effect: 'text', proof: 'not-applicable' }, 'safe', 2],
      ['17', { proof: 'isolated' }, 'mid', 6],
      ['18', { proof: 'isolated', effect: 'data' }, 'high', 4],
      ['19', { proof: 'isolated', runsInRequest: false }, 'mid', 11],
      ['20', { proof: 'lifecycle', testChangedWithIt: true }, 'safe', 9],
      ['21', { proof: 'unknown' }, 'mid', 5],
      ['22', { proof: 'unknown', broken: 'It breaks `test/a_test.rb`: that test passes without this change and fails with it' }, 'high', 1, true],
    ]
    assert.equal(cases.length, 22)
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

it('a test is safe by rule 2 whatever it holds: it is proof for the code it runs, not a change to rate', () => {
  const result = floor({ effect: 'data', proof: 'not-applicable', exposure: 'everyone', undo: 'rollback', runsInRequest: false, isTest: true })
  assert.deepEqual([result.level, result.rule], ['safe', 2])
  assert.equal(result.why, 'A test: it is proof for the code it runs, and is read with that code.')
})

it('a type and nothing else is safe by rule 2: the compiler checks it, not a test', () => {
  const result = floor({ effect: 'interface', proof: 'not-applicable', exposure: 'everyone', undo: 'rollback', typeOnly: true })
  assert.equal(result.level, 'safe')
  assert.equal(result.rule, 2)
  assert.match(result.why, /^Only a type: the compiler checks it/)
})
