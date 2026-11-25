import assert from 'node:assert/strict'
import { test } from 'node:test'
import { floor } from '../src/floor.ts'
import { readReviewAnswer } from '../src/model.ts'
import { applyRiskEvents, compatibleInternalCallShape } from '../src/risk.ts'
import type { ReviewNode, RiskEvent } from '../src/types.ts'

const path = 'app/javascript/battle/ai/BasicEnemy.js'
const signature = '  async moveAway(destination, apCost) {'
const calls = ['        await this.moveAway(turn.destination, 10);', '        await this.moveAway(turn.destination, ActionCosts.Move);']

// Native #198, dc23e2d: matching quotes and exact consumers, but no conflicting call.
const recorded: RiskEvent = {
  node: 'n6', level: 'high', direction: 'up', aspect: 'behaviour', by: 'model', origin: 'introduced',
  evidence: '`nextTurnState` returns `flee` or `kite` only with a destination (lines 44–46 and 58–60). Both calls in `advanceTurn` satisfy the new contract. `BasicEnemy.test.js:266–275` checks the move from `B2` to `B4`, the AP charged before reset, and one turn completion. No broken caller is shown.',
  comparison: 'At base, `moveAway()` selects a spot, defaults the cost to 10 and returns a boolean. At head, selection happens before the call. Both callers supply the spot and cost, and neither reads the return value.',
  grounding: { kind: 'code-path', trigger: 'A flee or kite action has a selected retreat destination.', trace: [
    { role: 'consumer', path, line: 78, side: 'head', quote: calls[0]! },
    { role: 'consumer', path, line: 88, side: 'head', quote: calls[1]! },
    { role: 'change', path, line: 200, side: 'base', quote: '  async moveAway(apCost = 10) {' },
    { role: 'change', path, line: 229, side: 'head', quote: signature },
  ] },
  questions: [{ text: 'Is the no-argument form of `moveAway()` a supported interface for separately shipped battle extensions?', why: 'The two repository calls are accounted for; the review data does not describe an extension compatibility contract.', changes: 'A required old-form call makes this high and critical: it sets AP to `NaN` and then throws. Without that requirement the interface change stays high, with no demonstrated break.' }],
}

function fixture() {
  const base = Array<string>(240).fill('')
  const head = Array<string>(240).fill('')
  base[199] = recorded.grounding!.trace![2]!.quote
  head[228] = signature
  head[77] = calls[0]!
  head[87] = calls[1]!
  const node: ReviewNode = {
    id: 'n6', symbol: 'BasicEnemy.moveAway', kind: 'function', path, lines: [229, 238], changed_lines: [229, 231, 235, 237], change: 'modified', language: 'javascript', entries: [],
    facts: { effect: { value: 'interface', evidence: 'signature changed; also behaviour' }, proof: { value: 'none', evidence: 'no test names moveAway' }, exposure: { value: 'everyone', evidence: 'both callers run it' }, undo: { value: 'rollback', evidence: 'revert restores it' } },
    extras: {}, conditions: [], hosts_condition: false, runs: [], sensitive: [], level: null, critical: false, findings: [], watch: null, questions: [],
    callers: { total: 2, shown: 2, complete: true },
    callSites: [78, 88].map((line, index) => ({ id: 'n4', symbol: 'BasicEnemy.advanceTurn', path, line, text: calls[index]!.trim(), resolution: 'exact', guards: [] })),
  }
  const source = (file: string, side: 'base' | 'head') => file === path ? (side === 'base' ? base : head).join('\n') : null
  node.extras.compatibleInternalCallShape = compatibleInternalCallShape({ ...node, startLine: 229, endLine: 238, changedLines: node.changed_lines, tests: [] }, head.join('\n'), source)
  return { node, base, head, source, event: structuredClone(recorded) }
}

test('matching signatures and compatible consumers do not establish the native #198 high claim', () => {
  const { node, source, event } = fixture()
  const parsed = readReviewAnswer(JSON.stringify({ events: [event] }), { nodes: [node], units: [], claims: [] })
  assert.deepEqual(parsed.problems, [])
  const result = applyRiskEvents([node], parsed.events, source)
  assert.equal(result.rejected.length, 1)
  assert.equal(result.nodes[0]!.level!.current, 'mid')
  assert.match(result.rejected[0]!.reason, /signature.*consumer|consumer.*signature/)
  assert.equal(result.nodes[0]!.questions.length, 0, 'the hypothetical extension is not a demonstrated failure')
  // The same check is structural, not a list of phrases such as "No broken caller".
  event.evidence = 'The migration changes the movement call contract at the two cited call sites.'
  event.comparison = 'The base signature has a default cost; the head signature takes a destination and cost.'
  assert.equal(applyRiskEvents([node], [event], source).rejected.length, 1)
})

test('a real newly missing argument at an exact consumer remains high', () => {
  for (const call of ['await this.moveAway();', 'await this.moveAway(turn.destination);', 'await this.moveAway(turn.destination, undefined);']) {
    const { node, source, head, event } = fixture()
    head[77] = call
    node.callSites![0]!.text = call
    event.grounding!.trace![0]!.quote = call
    event.evidence = 'This exact call omits the required AP cost; head subtracts undefined and makes AP NaN.'
    const result = applyRiskEvents([node], [event], source)
    assert.deepEqual(result.rejected, [])
    assert.equal(result.nodes[0]!.level!.current, 'high')
  }
})

test('correct-arity consumers still establish a failure inside the changed body (#199 control)', () => {
  const { node, source, base, head, event } = fixture()
  base[200] = '    if (!await this.board.movePiece(this.enemy.position, best.id)) return false;'
  head[236] = '    await this.board.movePiece(this.enemy.position, destination.id);'
  event.grounding!.trace!.push(
    { role: 'change', path, line: 201, side: 'base', quote: base[200]! },
    { role: 'change', path, line: 237, side: 'head', quote: head[236]! },
  )
  event.evidence = 'Both calls pass destination and cost, but a rejected move now reports completion instead of returning false.'
  event.comparison = 'For the same rejected move result, base returns false and head falls through as successful.'
  event.grounding!.trigger = 'movePiece returns false for a blocked destination'
  const result = applyRiskEvents([node], [event], source)
  assert.deepEqual(result.rejected, [])
  assert.equal(result.nodes[0]!.level!.current, 'high')
})

test('call-shape evidence stays unknown for unsupported expressions, missing parameters and stale source', () => {
  for (const call of ['await this.moveAway(...args);', 'await this.moveAway(selectDestination(), 10);', 'await this.moveAway(turn.destination);', 'await this.moveAway(turn.destination, undefined);']) {
    const { node, head, source } = fixture()
    head[77] = call
    node.callSites![0]!.text = call
    const anchor = { ...node, startLine: 229, endLine: 238, changedLines: node.changed_lines, tests: [] }
    assert.equal(compatibleInternalCallShape(anchor, head.join('\n'), source), undefined, call)
  }
  const { node, head, source } = fixture()
  const anchor = { ...node, startLine: 229, endLine: 238, changedLines: node.changed_lines, tests: [] }
  head[77] = 'await this.moveAway();'
  assert.equal(compatibleInternalCallShape(anchor, head.join('\n'), source), undefined, 'scan text must match the actual source line')
  head[77] = calls[0]!
  head[228] = '  async moveAway({ destination, apCost }) {'
  assert.equal(compatibleInternalCallShape(anchor, head.join('\n'), source), undefined, 'destructuring is not positional arity')
})

test('optional options parameter accepts the demonstrated ordinary, return, and conditional-return callers', () => {
  const signature = '  nextTurnState(actionsLeft = MAX_TURN_ACTIONS, { allowRetreat = true } = {}) {'
  const lines = [
    '    let turn = this.nextTurnState();',
    '    return this.nextTurnState(turn.actionsLeft - 1);',
    '    if (!moved) return this.nextTurnState(turn.actionsLeft - 1, { allowRetreat: false });',
  ]
  const sourceText = [signature, ...lines].join('\n')
  const node: ReviewNode = {
    ...fixture().node,
    symbol: 'BasicEnemy.nextTurnState',
    lines: [1, 1],
    callers: { total: lines.length, shown: lines.length, complete: true },
    callSites: lines.map((text, index) => ({ id: 'n1', symbol: 'BasicEnemy.advanceTurn', path, line: index + 2, text: text.trim(), resolution: 'exact' as const, guards: [] })),
  }
  const source = (file: string, side: 'base' | 'head') => file === path && side === 'head' ? sourceText : null
  const anchor = { ...node, startLine: 1, endLine: 1, changedLines: [1], tests: [] }
  assert.match(compatibleInternalCallShape(anchor, sourceText, source) ?? '', /All 3 exact internal calls/)

  for (const call of ['return this.nextTurnState(null);', 'return this.nextTurnState(turn.actionsLeft - 1, null);', 'return this.nextTurnState(1, runtimeOptions);']) {
    const changed = sourceText.replace(lines[1]!, call)
    const sites = node.callSites!.map((site, index) => index === 1 ? { ...site, text: call } : site)
    assert.equal(compatibleInternalCallShape({ ...anchor, callSites: sites }, changed, () => changed), undefined, call)
  }
})

test('compatible internal argument shape is not a high floor, nor proof that behavior works', () => {
  const input = { effect: 'interface', proof: 'none', exposure: 'everyone', undo: 'rollback', compatibleInternalCallShape: 'Both exact internal callers supply destination and cost.' } as const
  assert.equal(floor(input).level, 'mid')
  assert.equal(floor(input).rule, 5)
  assert.equal(floor({ ...input, proof: 'lifecycle' }).level, 'mid')
  assert.equal(floor({ ...input, effect: 'data' }).level, 'high')
  assert.equal(floor({ ...input, undo: 'none' }).level, 'high')
  assert.equal(floor({ ...input, broken: 'An exact remaining consumer calls a removed definition.' }).critical, true)
  assert.equal(floor({ ...input, compatibleInternalCallShape: undefined }).level, 'high', 'unresolved/exported contracts retain their warning')
})
