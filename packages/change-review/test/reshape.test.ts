import assert from 'node:assert/strict'
import { test } from 'node:test'
import { curate, standsAloneIn } from '../src/curate.ts'
import { readReviewAnswer } from '../src/model.ts'
import { addedParts, carryWords, reshapeMap, type MapOp } from '../src/reshape.ts'
import { applyRiskEvents } from '../src/risk.ts'
import type { Bucket, Claim, FileDiff, Graph, Level, ReviewNode, TestRun, Triage, Unit } from '../src/types.ts'

/** A changed definition at `level`, in a file of its own; tests say only what differs. */
function node(id: string, level: Level, over: Partial<ReviewNode> = {}): ReviewNode {
  return {
    id,
    kind: 'function',
    symbol: id,
    path: `app/${id}.rb`,
    lines: [1, 10],
    change: 'modified',
    changed_lines: [3],
    entries: [],
    facts: {
      effect: { value: 'behaviour', evidence: 'one line changed' },
      proof: { value: level === 'safe' ? 'lifecycle-observed' : 'none', evidence: 'as the tests ran' },
      exposure: { value: 'everyone', evidence: 'no condition' },
      undo: { value: 'rollback', evidence: 'a rollback undoes it' },
    },
    extras: {},
    conditions: [],
    hosts_condition: false,
    runs: [],
    sensitive: [],
    level: { floor: level, rule: level === 'safe' ? 9 : 5, current: level, why: [`It is ${level}.`], if: [] },
    critical: false,
    findings: [],
    watch: null,
    questions: [],
    ...over,
  }
}

const graph = (nodes: ReviewNode[]): Graph => ({ schema: 'review-graph/1', range: 'main...x', base: 'a', head: 'b', nodes, edges: [], coverage: { truncated: false, notes: [] } })

function triageOf(nodes: readonly ReviewNode[], buckets: Bucket[] = []): Triage {
  const claimed = new Set(buckets.flatMap((bucket) => bucket.paths))
  const paths = [...new Set(nodes.map((item) => item.path))].filter((path) => !claimed.has(path))
  const code: Bucket = { id: 'b1', folder: 'app', kind: 'code', change: 'modified', paths, files: paths.length, added: 0, deleted: 0, treatment: 'scan', why: 'code' }
  return { schema: 'review-triage/1', range: 'main...x', mode: 'mixed', description_source: 'none', totals: { files: paths.length, added: 0, deleted: 0 }, buckets: [code, ...buckets], claims: [], plan: { steps: [], estimate_seconds: 0 } }
}

/** One hunk replacing line `line` of `path`, with a line of context each side. */
const hunkAt = (line: number, old: string, next: string) => ({ oldStart: line - 1, oldLines: 3, newStart: line - 1, newLines: 3, lines: [' # before', `-${old}`, `+${next}`, ' # after'] })
/** A different edit in each node's file, so no two of them fold into one unit of identical sites. */
const diffsOf = (nodes: readonly ReviewNode[]): FileDiff[] => nodes.map((item, index) => ({ path: item.path, hunks: [hunkAt(3, `old ${index}`, `new ${index * 7}`)] }))

/** What curate builds of these nodes, before the Reviewer reads them. */
function shaped(nodes: ReviewNode[], extra: { diffs?: FileDiff[]; triage?: Triage; layout?: Parameters<typeof curate>[0]['layout']; source?: (path: string, side: 'head' | 'base') => string | null } = {}) {
  const triage = extra.triage ?? triageOf(nodes)
  return curate({ graph: graph(nodes), triage, diffs: extra.diffs ?? diffsOf(nodes), scannedFiles: triage.buckets[0]!.paths, ...(extra.source ? { source: extra.source } : {}), ...(extra.layout ? { layout: extra.layout } : {}) })
}

const unitWith = (units: readonly Pick<Unit, 'id' | 'nodes'>[], id: string) => units.find((unit) => unit.nodes.includes(id))!.id
const levelsAndProofs = (nodes: readonly ReviewNode[]) => nodes.map(({ id, level, critical, facts }) => ({ id, level, critical, facts }))

// ───────────────────────── Reading the answer ─────────────────────────

test('the answer’s map is read without trust: well-formed operations are kept, and each other one is dropped with why', () => {
  const map = [
    { op: 'describe', node: 'n1', title: 'The rounded total', what: 'It now rounds the sum.​' },
    { op: 'move', node: 'n2', unit: 'u1' },
    { op: 'unit', id: 'g1', nodes: ['n1', 'n2'], title: 'Totals and their rounding' },
    { op: 'merge', units: ['u1', 'u2'] },
    { op: 'order', units: ['u2', 'u1'] },
    { op: 'order', unit: 'u1', nodes: ['n2', 'n1'] },
    { op: 'add', id: 'a1', path: 'app/a.rb', lines: [2, 4], why: 'the map missed this changed line' },
    { op: 'remove', node: 'n3', why: 'it only renames a local variable' },
    { op: 'rename', node: 'n1' },
    { op: 'move', node: 'n2' },
    { op: 'add', id: 'a 2', path: 'app/a.rb', lines: [3, 1], why: 'a second part' },
    { op: 'remove', node: 'n4' },
  ]
  const text = JSON.stringify({
    events: [{ node: 'a1', level: 'mid', direction: 'up', aspect: 'behaviour', evidence: 'The added part is read on every request to the cart.' }],
    words: { units: { g1: { title: 'Totals and their rounding' }, zz: { title: 'No such unit' } } },
    map,
  })
  const answer = readReviewAnswer(text, { nodes: ['n1', 'n2', 'n3', 'n4'].map((id) => ({ id })), units: [{ id: 'u1' }, { id: 'u2' }], claims: [] })

  assert.deepEqual(answer.map.map((op) => op.op), ['describe', 'move', 'unit', 'merge', 'order', 'order', 'add', 'remove'])
  assert.deepEqual(answer.map[0], { op: 'describe', node: 'n1', title: 'The rounded total', what: 'It now rounds the sum.' }, 'hidden characters are gone')
  assert.deepEqual(answer.map[6], { op: 'add', id: 'a1', path: 'app/a.rb', lines: [2, 4], side: 'head', why: 'the map missed this changed line' }, 'an added part is at head unless it says base')
  assert.deepEqual(answer.events.map((event) => event.node), ['a1'], 'an event may name a part the same answer adds')
  assert.deepEqual(Object.keys(answer.words.units ?? {}), ['g1'], 'words may name a unit the same answer makes, never one nobody made')
  for (const index of [8, 9, 10, 11]) assert.ok(answer.problems.some((problem) => problem.startsWith(`map[${index}]`)), `map[${index}] is said to be dropped: ${answer.problems.join(' | ')}`)
})

test('an answer with no map, or an empty one, asks for no reshaping', () => {
  const known = { nodes: [{ id: 'n1' }], units: [{ id: 'u1' }], claims: [] }
  assert.deepEqual(readReviewAnswer(JSON.stringify({ events: [] }), known).map, [])
  assert.deepEqual(readReviewAnswer(JSON.stringify({ events: [], map: [] }), known), readReviewAnswer(JSON.stringify({ events: [] }), known))

  const nodes = [node('a', 'mid'), node('b', 'safe')]
  const before = shaped(nodes)
  const reshaped = reshapeMap({ nodes, units: before.units, ops: [], added: new Set(), claims: [], alone: () => false })
  assert.equal(reshaped.layout, null)
  assert.deepEqual(reshaped.nodes, nodes)
  assert.deepEqual(reshaped.problems, [])
  assert.deepEqual(shaped(reshaped.nodes), before, 'the units are the rules’ own')
})

test('the Reviewer may rename a zone: words only, no part moves and no level changes, and an unknown zone is refused', () => {
  const nodes = [node('a', 'mid', { zone: '-/model/a' }), node('b', 'safe', { zone: '-/model/b' })]
  const before = shaped(nodes)
  const answer = readReviewAnswer(JSON.stringify({ map: [{ op: 'zone', zone: '-/model/a', name: 'Pricing rules' }, { op: 'zone', zone: '-/nowhere', name: 'Elsewhere' }, { op: 'zone', zone: '-/model/b' }] }), { nodes, units: before.units, claims: [] })
  assert.deepEqual(answer.map, [{ op: 'zone', zone: '-/model/a', name: 'Pricing rules' }, { op: 'zone', zone: '-/nowhere', name: 'Elsewhere' }])
  assert.ok(answer.problems.some((problem) => /^map\[2\]: zone needs a zone id and a name/.test(problem)), answer.problems.join('\n'))
  const zones = [{ id: '-/model/a', label: 'Models · A' }, { id: '-/model/b', label: 'Models · B' }]
  const reshaped = reshapeMap({ nodes, units: before.units, ops: answer.map, added: new Set(), claims: [], alone: () => false, zones })
  assert.deepEqual(reshaped.zones, { '-/model/a': 'Pricing rules' })
  assert.deepEqual(reshaped.problems, ['map[1] naming zone -/nowhere was refused: no zone -/nowhere in the map.'])
  assert.equal(reshaped.layout, null, 'no unit changed')
  assert.deepEqual(reshaped.nodes, nodes, 'no part moved and no level changed')
})

// ───────────────────────── Applying it ─────────────────────────

test('the Reviewer redefines parts, moves them, makes, merges and orders units, and every unit keeps the rules’ shape', () => {
  const nodes = [node('a', 'mid'), node('b', 'mid'), node('c', 'safe'), node('d', 'safe')]
  const before = shaped(nodes)
  const [ua, ub] = [unitWith(before.units, 'a'), unitWith(before.units, 'b')]
  const ops: MapOp[] = [
    { op: 'describe', node: 'a', title: 'The rounded total', what: 'It rounds the total now.' },
    { op: 'unit', id: 'g1', nodes: ['c', 'd'], title: 'Two renames that change nothing' },
    { op: 'merge', units: [ua, ub] },
    { op: 'order', unit: ua, nodes: ['b', 'a'] },
    { op: 'order', units: ['g1', ua] },
  ]
  const reshaped = reshapeMap({ nodes, units: before.units, ops, added: new Set(), claims: [], alone: () => false })
  assert.deepEqual(reshaped.problems, [])
  assert.deepEqual(levelsAndProofs(reshaped.nodes), levelsAndProofs(nodes), 'no level, criticality or fact moved')
  assert.deepEqual(reshaped.nodes.find((item) => item.id === 'a')?.told, { title: 'The rounded total', what: 'It rounds the total now.' })

  const after = shaped(reshaped.nodes, { layout: reshaped.layout! })
  assert.deepEqual(after.units.map((unit) => [unit.nodes, unit.grouping, unit.level, unit.story_order]), [
    [['b', 'a'], 'regrouped', 'mid', 2],
    [['c', 'd'], 'regrouped', 'safe', 1],
  ])
  const merged = after.units[0]!
  assert.deepEqual(merged.members?.map((member) => [member.node, member.what]), [['b', 'Changes 1 line in `b`.'], ['a', 'It rounds the total now.']])
  assert.match(merged.title, /, with 1 other part the Reviewer put with it$/)
  const required = ['id', 'title', 'level', 'critical', 'nodes', 'buckets', 'represents', 'grouping', 'story_order', 'where', 'what', 'code', 'facts', 'why_level', 'would_change', 'watch', 'questions', 'members', 'unverified', 'reading_minutes', 'part']
  for (const unit of after.units) assert.deepEqual(Object.keys(unit), required.filter((key) => key in unit), `${unit.id} keeps the fields in their order`)

  const words = carryWords({ units: reshaped.words }, reshaped.groups, after.units)
  assert.deepEqual(words.units, { [after.units[1]!.id]: { title: 'Two renames that change nothing' } }, 'a unit the Reviewer made keeps the words it gave it')
})

test('a unit the Reviewer fills with parts of several levels is at its worst one, told by the part that sets it', () => {
  const nodes = [node('a', 'safe'), node('b', 'high', { critical: true })]
  const before = shaped(nodes)
  const reshaped = reshapeMap({ nodes, units: before.units, ops: [{ op: 'unit', id: 'g1', nodes: ['a', 'b'] }], added: new Set(), claims: [], alone: () => false })
  const [unit] = shaped(reshaped.nodes, { layout: reshaped.layout! }).units
  assert.deepEqual([unit!.nodes, unit!.level, unit!.critical], [['a', 'b'], 'high', true])
  assert.deepEqual(unit!.why_level, ['It is high.'], 'its reasons are those of the part its level rests on')
})

test('a part comes out of the map only when nothing can hide behind it; one taken out is in no unit and keeps the reason in the graph', () => {
  const failing: TestRun = { command: 'bin/rails test test/f_test.rb', tests: ['test/f_test.rb'], kind: 'baseline', condition_state: 'default', exit_code: 1, seconds: 2, failed: ['test/f_test.rb'] }
  const nodes = [
    node('m', 'mid'),
    node('f', 'safe', { runs: [failing] }),
    node('u', 'safe', { facts: { ...node('x', 'safe').facts, proof: { value: 'unknown', evidence: 'its tests could not run' } } }),
    node('k', 'safe', { hosts_condition: true }),
    node('q', 'safe', { questions: [{ text: 'Is the old rounding meant to stay?', why: 'the description does not say' }] }),
    node('clamp', 'safe', { symbol: 'Money.clamp' }),
    node('t', 'safe', { kind: 'test', path: 'test/t_test.rb' }),
    node('ok', 'safe'),
  ]
  const claims: Claim[] = [{ text: '`clamp` keeps the old bounds', source: 'PR description', status: 'verified', evidence: 'the bounds did not change' }]
  const before = shaped(nodes)
  const ops: MapOp[] = ['m', 'f', 'u', 'k', 'q', 'clamp', 't', 'ghost', 'ok'].map((id) => ({ op: 'remove', node: id, why: 'only a local variable was renamed' }))
  const reshaped = reshapeMap({ nodes, units: before.units, ops, added: new Set(), claims, alone: () => false })

  const refused = (index: number) => reshaped.problems.find((problem) => problem.startsWith(`map[${index}] `)) ?? ''
  assert.match(refused(0), /it is mid: only a safe part comes out/)
  assert.match(refused(1), /a test fails with it/)
  assert.match(refused(2), /its tests could not run/)
  assert.match(refused(3), /it holds a condition check/)
  assert.match(refused(4), /it carries a question for the reviewer/)
  assert.match(refused(5), /the claim "`clamp` keeps the old bounds" names it/)
  assert.match(refused(6), /a test is proof/)
  assert.match(refused(7), /no part ghost/)
  assert.equal(refused(8), '', 'the last one is taken out')
  assert.equal(reshaped.problems.length, 8)
  assert.deepEqual(reshaped.nodes.filter((item) => item.hidden).map((item) => [item.id, item.hidden]), [['ok', 'only a local variable was renamed']])
  assert.deepEqual(levelsAndProofs(reshaped.nodes), levelsAndProofs(nodes))

  const after = shaped(reshaped.nodes)
  assert.ok(!after.units.some((unit) => unit.nodes.includes('ok')), 'it is in no unit')
  assert.equal(after.units.length, before.units.length - 1, 'and no unit takes its place, such as one saying its file was never read')
  assert.ok(!JSON.stringify(after).includes('app/ok.rb'))
})

test('an added part points at real lines of the change or the scan, outside every mapped part: changed lines are worth a look with no test looked for, unchanged ones are context', () => {
  const nodes = [node('a', 'mid'), node('b', 'mid')]
  const head = new Map([
    ['app/b.rb', Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join('\n')],
    ['app/caller.rb', 'class Checkout\n  def create\n    cart.total\n    render :ok\n  end\nend\n'],
  ])
  const source = (path: string, side: 'head' | 'base') => (side === 'head' ? (head.get(path) ?? null) : null)
  const diffs: FileDiff[] = [{ path: 'app/a.rb', hunks: [hunkAt(3, 'old a', 'new a')] }, { path: 'app/b.rb', hunks: [hunkAt(3, 'old b', 'new b'), hunkAt(20, 'old tax', 'new tax')] }]
  const before = shaped(nodes, { diffs })
  const ub = unitWith(before.units, 'b')
  const ops: MapOp[] = [
    { op: 'add', id: 'x1', path: 'app/a.rb', lines: [3, 3], side: 'head', why: 'the changed line of a' },
    { op: 'add', id: 'x2', path: 'app/b.rb', lines: [19, 21], side: 'head', symbol: 'Cart#tax', why: 'the map missed the tax line' },
    { op: 'add', id: 'x3', path: 'app/caller.rb', lines: [2, 5], side: 'head', unit: ub, what: 'Calls `total` for every order.', why: 'it shows how a request reaches the total' },
    { op: 'add', id: 'x4', path: 'app/nowhere.rb', lines: [1, 2], side: 'head', why: 'a file nobody changed' },
    { op: 'add', id: 'x5', path: 'app/b.rb', lines: [25, 99], side: 'head', why: 'past the end of the file' },
    { op: 'add', id: 'b', path: 'app/b.rb', lines: [25, 26], side: 'head', why: 'an id already taken' },
  ]
  const made = addedParts(ops, { nodes, diffs, scanned: [{ symbol: 'Checkout#create', path: 'app/caller.rb', lines: [2, 5] }], source, runsInRequest: () => true })
  assert.deepEqual(made.nodes.map((item) => item.id), ['x2', 'x3'])
  const said = (index: number) => made.problems.find((problem) => problem.startsWith(`map[${index}] `)) ?? ''
  assert.match(said(0), /already in the map as `a`/)
  assert.match(said(3), /not a file of the change or of the scan/)
  assert.match(said(4), /app\/b\.rb has 30 lines at head/)
  assert.match(said(5), /the id b is taken/)

  // Levels come from the floor, as for every part: the Reviewer sets none by adding.
  const applied = applyRiskEvents([...nodes, ...made.nodes], []).nodes
  const x2 = applied.find((item) => item.id === 'x2')!
  assert.deepEqual([x2.symbol, x2.change, x2.changed_lines, x2.facts.proof.value, x2.level?.current, x2.level?.rule], ['Cart#tax', 'modified', [20], 'unknown', 'mid', 5])
  assert.ok(x2.findings.some((finding) => finding.rule === 'added-by-reviewer' && /the map missed the tax line/.test(finding.text)))
  const x3 = applied.find((item) => item.id === 'x3')!
  assert.deepEqual([x3.symbol, x3.change, x3.extras.context, x3.level?.current, x3.level?.rule], ['Checkout#create', 'none', true, 'safe', 2])
  assert.match(x3.level?.why[0] ?? '', /Nothing in it changed/)

  const reshaped = reshapeMap({ nodes: applied, units: before.units, ops, added: new Set(['x2', 'x3']), claims: [], alone: () => false })
  assert.deepEqual(reshaped.problems, [])
  const after = shaped(reshaped.nodes, { diffs, source, layout: reshaped.layout! })
  const withContext = after.units.find((unit) => unit.nodes.includes('x3'))!
  assert.deepEqual([withContext.nodes, withContext.level, withContext.grouping], [['b', 'x3'], 'mid', 'regrouped'])
  assert.deepEqual(withContext.members?.find((member) => member.node === 'x3')?.what, 'Calls `total` for every order.')
  assert.match(withContext.code.find((shown) => shown.path === 'app/caller.rb')?.diff ?? '', /cart\.total/)
  const missed = after.units.find((unit) => unit.nodes.includes('x2'))!
  assert.deepEqual([missed.nodes, missed.level], [['x2'], 'mid'])
  assert.match(missed.title, /`tax` .*the Reviewer added it to the map: no test was looked for/)
})

test('a part told on its own stays alone, a bucket’s unit keeps its parts, and nothing the Reviewer refuses is half done', () => {
  const nodes = [node('a', 'mid'), node('k', 'high', { critical: true }), node('s', 'safe', { path: 'lib/s.rb' })]
  const units: Pick<Unit, 'id' | 'nodes' | 'buckets' | 'grouping'>[] = [
    { id: 'u1', nodes: ['k'], grouping: 'single' },
    { id: 'u2', nodes: ['a'], grouping: 'single' },
    { id: 'u3', nodes: ['s'], buckets: ['b2'], grouping: 'bucket' },
  ]
  const triage = triageOf(nodes, [{ id: 'b2', folder: 'lib', kind: 'code', change: 'modified', paths: ['lib/s.rb'], files: 1, added: 1, deleted: 1, treatment: 'sample', why: 'the same edit', sample: { read: ['lib/s.rb'], trusted: 0 } }])
  const alone = standsAloneIn({ graph: graph(nodes), triage })
  assert.deepEqual(nodes.map((item) => alone(item.id)), [false, true, false], 'a critical part is always told on its own')
  const ops: MapOp[] = [
    { op: 'move', node: 'k', unit: 'u2' },
    { op: 'move', node: 'a', unit: 'u1' },
    { op: 'merge', units: ['u1', 'u2'] },
    { op: 'move', node: 's', unit: 'u2' },
    { op: 'move', node: 'a', unit: 'u3' },
    { op: 'unit', id: 'g1', nodes: ['a', 'k'] },
    { op: 'remove', node: 's', why: 'the same edit as elsewhere' },
    { op: 'describe', node: 'k', title: 'The broken total' },
  ]
  const reshaped = reshapeMap({ nodes, units, ops, added: new Set(), claims: [], alone })
  assert.equal(reshaped.problems.length, 7, reshaped.problems.join('\n'))
  assert.match(reshaped.problems[0]!, /k is always told on its own/)
  assert.match(reshaped.problems[1]!, /u1 holds a part that is always told on its own/)
  assert.match(reshaped.problems[3]!, /s is read with its bucket of files/)
  assert.match(reshaped.problems[4]!, /u3 is a bucket of files/)
  assert.equal(reshaped.layout, null, 'nothing was regrouped')
  assert.deepEqual(reshaped.groups.map((group) => [group.id, group.nodes]), [['u1', ['k']], ['u2', ['a']], ['u3', ['s']]])
  assert.deepEqual(levelsAndProofs(reshaped.nodes), levelsAndProofs(nodes))
  assert.equal(reshaped.nodes.find((item) => item.id === 'k')?.told?.title, 'The broken total')
})
