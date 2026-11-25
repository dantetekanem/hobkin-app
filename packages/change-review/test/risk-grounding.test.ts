import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyRiskEvents } from '../src/risk.ts'
import { readReviewAnswer, reviewRequest } from '../src/model.ts'
import { capNeeds, needsFacts, rateNeeds } from '../src/needs.ts'
import type { Answered, ReviewNode, RiskEvent, TestRun } from '../src/types.ts'

const part = (): ReviewNode => ({
  id: 'move', symbol: 'move', path: 'src/move.js', kind: 'function', lines: [1, 5], changed_lines: [2, 3], change: 'modified',
  entries: ['turn'], callSites: [{ id: 'turn', symbol: 'turn', path: 'src/turn.js', line: 1, text: 'move(enemy, board)', resolution: 'exact', guards: [] }],
  facts: { effect: { value: 'behaviour', evidence: 'changes movement' }, proof: { value: 'lifecycle', evidence: 'full turn regression passes' }, exposure: { value: 'everyone', evidence: 'turn calls move' }, undo: { value: 'rollback', evidence: 'reverting restores movement' } },
  extras: { testChangedWithIt: true }, conditions: [], hosts_condition: false, runs: [], sensitive: [], level: null, critical: false, findings: [], watch: null, questions: [],
})
const base = 'function move(enemy, board) {\n  if (!board.move(enemy)) return false\n  enemy.ap -= 1\n  return true\n}'
const head = 'function move(enemy, board) {\n  board.move(enemy)\n  enemy.ap -= 1\n  return true\n}'
const source = (path: string, side: 'base' | 'head') => path === 'src/move.js' ? (side === 'base' ? base : head) : path === 'src/turn.js' ? 'move(enemy, board)' : null
const regression = (): RiskEvent => ({
  node: 'move', by: 'model', level: 'high', critical: true, direction: 'down', aspect: 'behaviour', origin: 'introduced', rule: 'rejected-move-spends-ap',
  comparison: 'For board.move returning false, base returns before spending AP; head spends AP and returns true.',
  evidence: 'turn calls move(enemy, board); when board.move rejects movement, move still spends one AP and reports success.',
  grounding: { kind: 'code-path', trigger: 'board.move(enemy) returns false', trace: [
    { role: 'consumer', path: 'src/turn.js', line: 1, side: 'head', quote: 'move(enemy, board)' },
    { role: 'change', path: 'src/move.js', line: 2, side: 'base', quote: 'if (!board.move(enemy)) return false' },
    { role: 'change', path: 'src/move.js', line: 2, side: 'head', quote: 'board.move(enemy)' },
  ] },
})
const apply = (events: RiskEvent[]) => applyRiskEvents([part()], events, source)
const factsOf = (nodes: ReviewNode[]) => needsFacts({ nodes, files: [{ path: 'src/move.js', status: 'modified', binary: false, added: 1, deleted: 1 }, { path: 'test/turn.test.js', status: 'added', binary: false, added: 3, deleted: 0 }], checks: [], monitoring: true })
const scores = (): Answered => ({ kind: 'bug-fix', scores: {
  coverage: { score: 9, evidence: 'full turn test covers move', facts: ['move:proof'] },
  proof: { score: 9, evidence: 'full turn test proves the change', facts: ['move:proof'] },
  safety: { score: 9, evidence: 'the move path has no established regression', facts: ['move:risk'] },
  visibility: { score: 6, evidence: 'monitoring records turn failures', facts: ['monitoring'] },
  rollback: { score: 9, evidence: 'revert restores the old path', facts: ['move:undo'] },
} })

test('review input preserves named cases for baseline and targeted mutation receipts', () => {
  const node = part()
  node.runs = (['baseline', 'revert'] as const).map((kind): TestRun => ({
    kind, node: kind === 'revert' ? node.id : undefined, condition_state: 'default', tests: ['test/turn.test.js'], command: 'bun test test/turn.test.js', exit_code: kind === 'baseline' ? 0 : 1, seconds: 1, failed: kind === 'baseline' ? [] : ['test/turn.test.js'],
    cases: [{ path: 'test/turn.test.js', name: 'keeps move result false', status: kind === 'baseline' ? 'passed' : 'failed' }],
  }))
  const request = reviewRequest({ nodes: [node], units: [], code: {}, triage: { range: 'base..head', mode: 'unflagged-change', description_source: 'none', totals: { files: 1, added: 1, deleted: 1 }, claims: [], directives: [] } })
  const data = JSON.parse(request.prompt.slice(request.prompt.indexOf('\n') + 1))
  assert.match(data.nodes[0].runs[0], /test\/turn.test.js.*keeps move result false.*passed/)
  assert.match(data.nodes[0].runs[1], /test\/turn.test.js.*keeps move result false.*failed/)
})

test('an invented no-argument caller cannot override actual caller evidence and full-turn proof', () => {
  const invented = regression()
  invented.evidence = 'move() is called without enemy, so enemy.ap raises at head.'
  invented.grounding!.trace![0]!.quote = 'move()'
  const parsed = readReviewAnswer(JSON.stringify({ events: [invented] }), { nodes: [part()], units: [], claims: [] })
  const result = apply(parsed.events)
  assert.equal(result.nodes[0]!.level!.current, 'safe')
  assert.match(result.rejected[0]!.reason, /source witness/)
})

test('a reachable rejected-operation regression survives green happy-path tests, but head-only and model-only claims do not establish it', () => {
  const result = apply([regression()])
  assert.equal(result.nodes[0]!.level!.current, 'high')
  assert.equal(result.nodes[0]!.critical, true)
  assert.deepEqual(result.rejected, [])
  for (const event of [
    { ...regression(), origin: 'unknown' as const },
    { ...regression(), grounding: { kind: 'model-only' as const } },
    { ...regression(), grounding: undefined },
  ]) {
    const unproven = apply([event])
    assert.equal(unproven.nodes[0]!.level!.current, 'safe')
    assert.equal(unproven.rejected.length, 1)
  }
  const assurance: RiskEvent = { node: 'move', by: 'model', level: 'safe', direction: 'down', aspect: 'behaviour', evidence_kind: 'equivalent', evidence: 'All CI tests pass at head, so all movement paths are safe.' }
  assert.equal(apply([regression(), assurance]).nodes[0]!.level!.current, 'high')
})

test('an explicit uncovered branch limits coverage without denying a proven intended regression', () => {
  const gap: RiskEvent = { node: 'move', by: 'model', level: 'mid', direction: 'down', aspect: 'behaviour', rule: 'missing-rejected-move-test', evidence: 'The full-turn test only accepts moves; no assertion covers a rejected board.move result.', grounding: { kind: 'coverage-gap' }, suggest: { kind: 'add-test', text: 'Assert a rejected move leaves AP unchanged.', to: 'safe' } }
  const result = apply([gap])
  assert.equal(result.nodes[0]!.level!.current, 'mid')
  assert.equal(result.nodes[0]!.findings.at(-1)!.rule, 'coverage-gap')
  const needs = capNeeds(scores(), factsOf(result.nodes), 'head')
  assert.ok(!needs.scores.coverage || needs.scores.coverage.score < 9)
  assert.equal(needs.scores.proof!.score, 9, 'an added regression can prove its intended behavior without covering every branch')
  assert.equal(needs.scores.safety!.score, 9, 'missing proof is not evidence of breakage')
})

test('valid source text at an unrelated or unresolved consumer cannot establish binding identity', () => {
  for (const resolution of ['static_candidate', 'ambiguous', 'unresolved']) {
    const node = part()
    node.callSites![0]!.resolution = resolution
    assert.equal(applyRiskEvents([node], [regression()], source).rejected.length, 1)
  }
  const incompleteCall = regression()
  incompleteCall.grounding!.trace![0]!.quote = 'enemy'
  assert.equal(apply([incompleteCall]).rejected.length, 1, 'a token on the caller line is not its call expression')
  const unrelated = regression()
  unrelated.grounding!.trace![0] = { role: 'consumer', path: 'src/move.js', line: 2, side: 'head', quote: 'board.move(enemy)' }
  assert.equal(apply([unrelated]).rejected.length, 1)
})

test('test-only ratings use the actual file run even without a mapped definition; a failed batch cannot fail a green sibling', () => {
  const path = 'test/turn.test.js'
  const other = 'test/failing.test.js'
  const file = { path, status: 'modified' as const, binary: false, added: 1, deleted: 1 }
  const batch: TestRun = { kind: 'baseline', command: 'bun test', tests: [path, other], failed: [other], exit_code: 1, seconds: 1, condition_state: 'default' }
  const singleton = { ...batch, tests: [path], failed: [], exit_code: 0 }
  const evidence = (runs: TestRun[]) => needsFacts({ nodes: [], files: [file], checks: [], monitoring: false, runs }).evidence![path]!
  assert.match(evidence([batch, singleton]).text, /passed at head/)
  assert.match(evidence([batch, { ...singleton, not_run: 'no test ran' }]).text, /not run at head/)
  assert.match(evidence([batch]).text, /no individual file result/)
})

test('test-only and unchecked model changes have rateable evidence, and uncertainty can justify low safety', () => {
  for (const path of ['test/move.test.js', '_specs/tla/Move.tla']) {
    const facts = needsFacts({ nodes: [], files: [{ path, status: 'modified', binary: false, added: 1, deleted: 1 }], checks: [], monitoring: false })
    const answered: Answered = { kind: 'small-change', scores: Object.fromEntries(['coverage', 'proof', 'safety', 'rollback'].map((criterion) => [criterion, { score: 3, evidence: 'The changed check was not run at head; its result is unknown.', facts: [path] }])) }
    assert.equal(Object.keys(capNeeds(answered, facts, 'head').scores).length, 5)
    if (path.startsWith('test/')) {
      answered.scores.proof!.score = 8
      assert.equal(capNeeds(answered, facts, 'head').scores.proof!.score, 8, 'test-only proof is not capped because no runtime definition changed')
    }
  }
  const node = part()
  node.facts.proof = { value: 'unknown', evidence: 'The test command could not start.' }
  const facts = factsOf(applyRiskEvents([node], []).nodes)
  const answered = scores()
  answered.scores.safety = { score: 4, evidence: 'Runtime impact is unknown because no test could run.', facts: ['move:uncertainty'] }
  assert.equal(capNeeds(answered, facts, 'head').scores.safety!.score, 4)
})

test('all component ratings require criterion-specific measured evidence, not nonexistent findings or blanket CI', async () => {
  const nodes = apply([]).nodes
  const facts = factsOf(nodes)
  const unsupported = scores()
  for (const value of Object.values(unsupported.scores)) value!.facts = ['green-ci']
  const first = capNeeds(unsupported, facts, 'head')
  assert.deepEqual(first.scores, {})
  const low = scores()
  low.scores.safety = { score: 2, evidence: 'move() crashes with no arguments', facts: ['move:risk'] }
  assert.equal(capNeeds(low, facts, 'head').scores.safety, undefined)
  // A different part's high must not validate this node's ungrounded score.
  const other = { ...part(), id: 'elsewhere', symbol: 'anotherAction', extras: { broken: 'Another action no longer exists at head.' } }
  const independent = factsOf(applyRiskEvents([part(), other], []).nodes)
  assert.equal(capNeeds(low, independent, 'head').scores.safety, undefined)
  low.scores.safety!.facts = ['elsewhere:risk']
  assert.equal(capNeeds(low, independent, 'head').scores.safety?.score, 2)
  low.scores.safety!.facts = ['constructor']
  assert.equal(capNeeds(low, independent, 'head').scores.safety, undefined)
  let called = 0
  const rated = await rateNeeds({ answered: unsupported, facts, head: 'head', review: 'No established regression.', tries: 1, ask: async ({ prompt }) => {
    called++
    assert.match(prompt, /rating_evidence/)
    return { text: JSON.stringify({ needs: scores() }) }
  } })
  assert.equal(called, 1)
  assert.deepEqual(Object.keys(rated.needs!.scores), ['coverage', 'proof', 'safety', 'visibility', 'rollback'])
  assert.equal(rated.notRated, undefined)
})
