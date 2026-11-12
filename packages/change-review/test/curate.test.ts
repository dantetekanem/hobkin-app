import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkMap, curate, markUnverified } from '../src/curate.ts'
import type { Bucket, FileDiff, GraphEdge, Graph, Level, ReviewNode, Triage } from '../src/types.ts'

/** A node that is safe by default; tests say only what differs. */
function node(id: string, over: Partial<ReviewNode> = {}): ReviewNode {
  const level: Level = over.level?.current ?? 'safe'
  return {
    id,
    kind: 'function',
    symbol: id,
    path: `app/${id}.rb`,
    lines: [1, 10],
    change: 'modified',
    changed_lines: [3],
    entries: ['Ctl#a'],
    facts: {
      effect: { value: 'behaviour', evidence: 'one line changed' },
      proof: { value: 'lifecycle-observed', evidence: 'CtlTest runs it' },
      exposure: { value: 'nobody-yet', evidence: 'behind the flag' },
      undo: { value: 'flag', evidence: 'flag off' },
    },
    extras: {},
    conditions: [],
    hosts_condition: false,
    runs: [],
    sensitive: [],
    level: { floor: level, rule: 11, current: level, why: ['It is behind a condition that is off.'], if: [] },
    critical: false,
    findings: [],
    watch: null,
    questions: [],
    ...over,
  }
}

const withLevel = (current: Level, over: Partial<ReviewNode> = {}): Partial<ReviewNode> => ({
  ...over,
  level: { floor: current, rule: 3, current, why: [`No test that runs reaches these lines (${current}).`], if: [{ text: 'Add a test.', level: 'mid' }] },
})

function graph(nodes: ReviewNode[], edges: GraphEdge[] = [], truncated = false): Graph {
  return { schema: 'review-graph/1', range: 'main...x', base: 'a', head: 'b', nodes, edges, coverage: { truncated, notes: [] } }
}

function bucket(id: string, over: Partial<Bucket> = {}): Bucket {
  return { id, folder: 'app', kind: 'code', change: 'modified', paths: [], files: 0, added: 0, deleted: 0, treatment: 'scan', why: 'code', ...over }
}

function triage(buckets: Bucket[]): Triage {
  const files = buckets.reduce((sum, item) => sum + item.paths.length, 0)
  return {
    schema: 'review-triage/1',
    range: 'main...x',
    mode: 'mixed',
    description_source: 'none',
    totals: { files, added: 0, deleted: 0 },
    buckets,
    claims: [],
    plan: { steps: [], estimate_seconds: 0 },
  }
}

/** Triage whose one scan bucket holds the file of every node. */
const triageFor = (nodes: ReviewNode[]) => triage([bucket('b1', { paths: [...new Set(nodes.map((item) => item.path))], files: nodes.length })])

/** A one-hunk diff replacing `old` with `next` at `line`, with a line of context each side. */
function fileDiff(path: string, line: number, old: string, next: string): FileDiff {
  return { path, hunks: [{ oldStart: line - 1, oldLines: 3, newStart: line - 1, newLines: 3, lines: [' # before', `-${old}`, `+${next}`, ' # after'] }] }
}

const diffsFor = (nodes: ReviewNode[]) => nodes.map((item) => fileDiff(item.path, 3, `old ${item.id}`, `new ${item.id}`))

const call = (from: string, to: string, line = 5): GraphEdge => ({ from, to, relationship: 'calls', resolution: 'exact', line })

// ───────────────────────── checkMap and markUnverified ─────────────────────────

test('checkMap finds nothing wrong in a consistent map', () => {
  const nodes = [node('a'), node('b')]
  assert.deepEqual(checkMap(graph(nodes, [call('a', 'b')]), triageFor(nodes), ['app/a.rb', 'app/b.rb']), [])
})

test('checkMap reports each kind of inconsistency, with the node when there is one', () => {
  const nodes = [
    node('edge'),
    node('badfact', { facts: { ...node('x').facts, effect: { value: 'surprise' as never, evidence: 'x' } } }),
    node('safenone', { facts: { ...node('x').facts, proof: { value: 'none', evidence: 'no test' } } }),
    node('crit', { critical: true }),
  ]
  const two = triage([bucket('b1', { paths: ['app/edge.rb', 'app/both.rb'] }), bucket('b2', { paths: ['app/both.rb'] })])
  const problems = checkMap(graph(nodes, [call('edge', 'ghost')], true), two, ['app/edge.rb', 'app/missing.rb'])
  const by = (rule: string) => problems.filter((problem) => problem.rule === rule)
  assert.equal(by('edge-endpoint')[0]?.node, 'edge')
  assert.equal(by('fact-value')[0]?.node, 'badfact')
  assert.equal(by('safe-without-proof')[0]?.node, 'safenone')
  assert.equal(by('critical-not-high')[0]?.node, 'crit')
  assert.match(by('file-in-two-buckets')[0]?.text ?? '', /app\/both\.rb/)
  assert.match(by('scanned-file-without-node')[0]?.text ?? '', /app\/missing\.rb/)
  assert.equal(by('scan-truncated').length, 1)
  assert.equal(by('scan-truncated')[0]?.node, undefined)
})

test('checkMap accepts unknown for any fact and reports a diff file in no bucket', () => {
  const unknown = node('u', withLevel('high', { facts: { effect: { value: 'unknown' as never, evidence: '' }, proof: { value: 'unknown', evidence: '' }, exposure: { value: 'everyone', evidence: '' }, undo: { value: 'unknown' as never, evidence: '' } } }))
  const problems = checkMap(graph([unknown]), triageFor([unknown]), ['app/u.rb'], ['app/u.rb', 'docs/lost.md'])
  assert.deepEqual(problems.map((problem) => problem.rule), ['file-in-no-bucket'])
})

test('markUnverified marks the node with the reason, drops nothing and leaves the input alone', () => {
  const nodes = [node('a'), node('b', { critical: true })]
  const source = graph(nodes)
  const marked = markUnverified(source, checkMap(source, triageFor(nodes), []))
  assert.equal(marked.nodes.length, 2)
  assert.match(marked.nodes[1]?.unverified ?? '', /critical/)
  assert.equal(marked.nodes[0]?.unverified, undefined)
  assert.equal(source.nodes[1]?.unverified, undefined)
})

// ───────────────────────── curate: one node, one unit ─────────────────────────

test('a single node becomes a unit with every field, a claim title, and code trimmed to its lines', () => {
  const a = node('round_money', withLevel('high', {
    critical: true,
    sensitive: ['money'],
    facts: { ...node('x').facts, proof: { value: 'none', evidence: 'no test executes line 3' }, exposure: { value: 'everyone', evidence: 'no condition' }, undo: { value: 'rollback', evidence: 'revert' } },
    findings: [{ rule: 'x', text: 'It is on a money path.', by: 'model' }],
    questions: [{ text: 'Is it meant?', why: 'no description' }],
    lines: [2, 4],
  }))
  const diff: FileDiff = { path: a.path, hunks: [{ oldStart: 1, oldLines: 7, newStart: 1, newLines: 7, lines: [' 1', ' def round_money', '-  old', '+  new', ' end', ' 6', ' 7', ' 8'] }] }
  const caller = node('job', { path: 'app/job.rb', lines: [1, 5], entries: ['Job#perform'] })
  const text = ['def perform', '  a = 1', '  round_money(x)', '  b = 2', 'end'].join('\n')
  const result = curate({
    graph: graph([a, caller], [call('job', 'round_money', 3)]),
    triage: triageFor([a, caller]),
    diffs: [diff],
    source: (path, side) => (path === 'app/job.rb' && side === 'head' ? text : null),
  })
  const unit = result.units.find((item) => item.nodes.includes('round_money'))!
  assert.equal(unit.title, '`round_money` changes behaviour, and no test shows it')
  assert.equal(unit.level, 'high')
  assert.equal(unit.critical, true)
  assert.equal(unit.grouping, 'single')
  assert.match(unit.where, /Ctl#a/)
  assert.equal(unit.code[0]?.path, 'app/round_money.rb')
  assert.equal(unit.code[0]?.diff, ' def round_money\n-  old\n+  new\n end')
  assert.equal(unit.code[1]?.path, 'app/job.rb')
  assert.match(unit.code[1]?.diff ?? '', /round_money\(x\)/)
  assert.match(unit.code[1]?.why ?? '', /caller/)
  assert.deepEqual(unit.would_change, [{ text: 'Add a test.', level: 'mid' }])
  assert.deepEqual(unit.why_level, ['No test that runs reaches these lines (high).', 'It is on a money path.'])
  assert.equal(unit.reading_minutes, 2)
  assert.deepEqual(unit.questions, [{ text: 'Is it meant?', why: 'no description' }])
})

test('a node the map marked unverified is its own high unit with the reason', () => {
  const a = node('a')
  const odd = node('odd', { critical: true })
  const nodes = [a, odd]
  const result = curate({ graph: graph(nodes), triage: triageFor(nodes), diffs: diffsFor(nodes) })
  const unit = result.units.find((item) => item.nodes.includes('odd'))!
  assert.equal(unit.level, 'high')
  assert.match(unit.unverified ?? '', /critical/)
  assert.match(unit.why_level[0] ?? '', /Unverified/)
  assert.equal(result.units.find((item) => item.nodes.includes('a'))?.level, 'safe')
})

test('safe units say not assessed for watch; mid and high carry a watch', () => {
  const nodes = [node('s'), node('m', withLevel('mid'))]
  const result = curate({ graph: graph(nodes), triage: triageFor(nodes), diffs: diffsFor(nodes) })
  assert.equal(result.units.find((item) => item.level === 'safe')?.watch, 'not assessed')
  const mid = result.units.find((item) => item.level === 'mid')!
  assert.notEqual(mid.watch, 'not assessed')
  assert.equal(mid.reading_minutes, 1)
  assert.equal(result.units.find((item) => item.level === 'safe')?.reading_minutes, 0.5)
})

test('tests are never units', () => {
  const nodes = [node('a'), node('a_test', { kind: 'test', path: 'test/a_test.rb' })]
  const result = curate({ graph: graph(nodes), triage: triageFor(nodes), diffs: diffsFor(nodes) })
  assert.deepEqual(result.units.flatMap((item) => item.nodes), ['a'])
})

// ───────────────────────── grouping ─────────────────────────

test('a definition takes the private helpers changed with it and reached only through it', () => {
  const owner = node('owner', { path: 'app/s.rb', lines: [1, 10], entries: ['Ctl#a'] })
  const helper = node('helper', { path: 'app/s.rb', lines: [12, 20], entries: ['Ctl#a'] })
  const shared = node('shared', { path: 'app/s.rb', lines: [22, 30], entries: ['Ctl#a'] })
  const other = node('other', { path: 'app/o.rb' })
  const nodes = [owner, helper, shared, other]
  const edges = [call('owner', 'helper'), call('owner', 'shared'), call('other', 'shared')]
  const result = curate({ graph: graph(nodes, edges), triage: triageFor(nodes), diffs: [] })
  const unit = result.units.find((item) => item.nodes.includes('owner'))!
  assert.deepEqual(unit.nodes, ['owner', 'helper'])
  assert.equal(unit.grouping, 'definition-with-helpers')
  assert.deepEqual(unit.members?.map((member) => member.node), ['owner', 'helper'])
  assert.ok(result.units.some((item) => item.nodes.length === 1 && item.nodes[0] === 'shared'))
  assert.equal(result.attention.nodes_collapsed, 1)
})

test('a helper that is critical, or at another level, is not folded into its owner', () => {
  const owner = node('owner', { path: 'app/s.rb' })
  const helper = node('helper', withLevel('high', { path: 'app/s.rb' }))
  const nodes = [owner, helper]
  const result = curate({ graph: graph(nodes, [call('owner', 'helper')]), triage: triageFor(nodes), diffs: [] })
  assert.equal(result.units.length, 2)
})

test('identical hunks across many sites make one mechanical unit that shows three sites', () => {
  const sites = ['a', 'b', 'c', 'd', 'e'].map((id) => node(`site_${id}`, { entries: [`Ctl#${id}`] }))
  const diffs = sites.map((item) => fileDiff(item.path, 3, `use_${item.id}(1)`, `use_${item.id}(2)`))
  const result = curate({ graph: graph(sites), triage: triageFor(sites), diffs })
  assert.equal(result.units.length, 1)
  const unit = result.units[0]!
  assert.equal(unit.grouping, 'mechanical')
  assert.equal(unit.code.length, 3)
  assert.equal(unit.members?.length, 5)
  assert.equal(unit.represents?.nodes, 5)
  assert.equal(result.attention.nodes_collapsed, 4)
})

test('a site whose hunk differs leaves the mechanical group', () => {
  const sites = ['a', 'b', 'c', 'd', 'e'].map((id) => node(`site_${id}`))
  const diffs = sites.map((item) => fileDiff(item.path, 3, `use_${item.id}(1)`, item.id === 'site_e' ? 'something_else' : `use_${item.id}(2)`))
  const result = curate({ graph: graph(sites), triage: triageFor(sites), diffs })
  const group = result.units.find((item) => item.grouping === 'mechanical')!
  assert.equal(group.nodes.length, 4)
  assert.equal(result.units.length, 2)
})

test('a group that mixes levels is split by level', () => {
  const sites = ['a', 'b', 'c', 'd', 'e'].map((id) => node(`site_${id}`, id === 'e' ? withLevel('mid') : {}))
  const diffs = sites.map((item) => fileDiff(item.path, 3, `use_${item.id}(1)`, `use_${item.id}(2)`))
  const result = curate({ graph: graph(sites), triage: triageFor(sites), diffs })
  assert.deepEqual(result.units.map((item) => item.level).sort(), ['mid', 'safe'])
})

// ───────────────────────── buckets and file-level ─────────────────────────

test('a translation bucket is one unit with its checks and counts', () => {
  const translation = bucket('b4', { folder: 'config/locales', kind: 'translation', treatment: 'sample', paths: ['config/locales/en.yml', 'config/locales/fr.yml', 'config/locales/de.yml'], files: 3, added: 66, sample: { read: ['config/locales/en.yml'], trusted: 2 }, checks: [{ name: 'every locale has every key', passed: true, detail: 'all 3 locales hold 22 keys' }] })
  const a = node('a')
  const result = curate({ graph: graph([a]), triage: triage([bucket('b1', { paths: ['app/a.rb'] }), translation]), diffs: diffsFor([a]) })
  const unit = result.units.find((item) => item.grouping === 'bucket')!
  assert.equal(unit.level, 'safe')
  assert.equal(unit.critical, false)
  assert.deepEqual(unit.buckets, ['b4'])
  assert.equal(unit.represents?.files, 3)
  assert.match(unit.why_level.join(' '), /every locale has every key/)
  assert.equal(result.attention.files_sampled, 1)
  assert.equal(result.map, 'node-level')
})

test('a failed breaking check makes the bucket high and critical, an unrun check makes it high', () => {
  const make = (passed: boolean | null, breaks: boolean) => bucket('b4', { kind: 'translation', treatment: 'sample', paths: ['a.yml'], files: 1, checks: [{ name: 'keys', passed, detail: 'fr lacks 2 keys', breaks }] })
  const a = node('a')
  const run = (item: Bucket) => curate({ graph: graph([a]), triage: triage([bucket('b1', { paths: ['app/a.rb'] }), item]), diffs: [] }).units.find((u) => u.grouping === 'bucket')!
  const failed = run(make(false, true))
  assert.deepEqual([failed.level, failed.critical], ['high', true])
  const unrun = run(make(null, false))
  assert.deepEqual([unrun.level, unrun.critical], ['high', false])
})

test('a code change with no nodes is a scan failure', () => {
  const code = bucket('b1', { paths: ['app/a.rb'], files: 1 })
  assert.throws(() => curate({ graph: graph([]), triage: triage([code]), diffs: [] }), /scan failure/)
})

test('a change with no code gets units from buckets with map file-level', () => {
  const docsOnly = triage([
    bucket('b1', { folder: 'config', kind: 'config', paths: ['config/a.yml'], files: 1, added: 2, deleted: 1 }),
    bucket('b2', { folder: 'docs', kind: 'docs', treatment: 'skip', paths: ['docs/a.md'], files: 1 }),
  ])
  const result = curate({ graph: graph([]), triage: docsOnly, diffs: [fileDiff('config/a.yml', 3, 'a: 1', 'a: 2')] })
  assert.equal(result.map, 'file-level')
  assert.equal(result.units.length, 1)
  assert.equal(result.units[0]?.grouping, 'bucket')
  assert.equal(result.units[0]?.code[0]?.path, 'config/a.yml')
  assert.equal(result.attention.files_skipped, 1)
})

// ───────────────────────── order, parts, invariants ─────────────────────────

test('inside a level units go by path order, then sensitive names, then path', () => {
  const caller = node('caller', { entries: ['Ctl#a'] })
  const deep = node('deep', { entries: ['Ctl#a'] })
  const sensitive = node('sens', { entries: ['Ctl#a'], sensitive: ['money'] })
  const plain = node('plain', { entries: ['Ctl#a'] })
  const nodes = [deep, plain, sensitive, caller]
  const edges = [call('caller', 'deep'), call('caller', 'sens'), call('caller', 'plain')]
  const result = curate({ graph: graph(nodes, edges), triage: triageFor(nodes), diffs: [] })
  assert.deepEqual(result.units.map((item) => item.nodes[0]), ['caller', 'sens', 'deep', 'plain'])
  assert.deepEqual(result.units.map((item) => item.id), ['u1', 'u2', 'u3', 'u4'])
  assert.ok(result.units[0]!.story_order < result.units[1]!.story_order)
})

test('every node in one unit, worst level, same shape, parts past nine', () => {
  const levels: Level[] = ['high', 'mid', 'safe']
  const nodes = Array.from({ length: 12 }, (_, index) => {
    const level = levels[index % 3]!
    return node(`n${index}`, withLevel(level, { entries: [`Ctl#e${index % 3}`], critical: level === 'high' && index === 0 }))
  })
  const tests = node('t1', { kind: 'test', path: 'test/t1.rb' })
  const unverified = node('bad', { critical: true, entries: ['Ctl#e0'] })
  const all = [...nodes, tests, unverified]
  const distinct = all.map((item, index) => fileDiff(item.path, 3, `value ${index}`, `value ${index + 100}`))
  const result = curate({ graph: graph(all), triage: triageFor(all), diffs: distinct })

  const placed = result.units.flatMap((unit) => unit.nodes)
  const expected = all.filter((item) => item.kind !== 'test').map((item) => item.id).sort()
  assert.deepEqual([...placed].sort(), expected)
  assert.equal(new Set(placed).size, placed.length)

  const rank = { safe: 0, mid: 1, high: 2 }
  const effective = (id: string) => (id === 'bad' ? 'high' : all.find((item) => item.id === id)!.level!.current)
  for (const unit of result.units) {
    const worst = unit.nodes.map(effective).reduce((a, b) => (rank[a as Level] >= rank[b as Level] ? a : b))
    assert.equal(unit.level, worst)
    if (unit.critical) assert.equal(unit.level, 'high')
  }

  const required = ['id', 'title', 'level', 'critical', 'nodes', 'grouping', 'story_order', 'where', 'what', 'code', 'facts', 'why_level', 'would_change', 'watch', 'questions', 'reading_minutes']
  for (const unit of result.units) {
    assert.deepEqual(Object.keys(unit).filter((key) => required.includes(key)), required)
    assert.deepEqual(Object.keys(unit.facts), ['effect', 'proof', 'exposure', 'undo'])
    assert.ok(unit.code.every((shown) => shown.diff.split('\n').length <= 40))
  }

  assert.equal(result.units.length, 13)
  assert.equal(result.attention.parts, 2)
  const perPart = new Map<number, number>()
  for (const unit of result.units) perPart.set(unit.part!, (perPart.get(unit.part!) ?? 0) + 1)
  assert.ok([...perPart.values()].every((count) => count <= 9))
  assert.deepEqual([...perPart.keys()].sort(), [1, 2])
  assert.equal(result.attention.units, 13)
  assert.equal(result.attention.reading_minutes, result.units.reduce((sum, unit) => sum + unit.reading_minutes, 0))
})

test('a mechanical bucket from triage takes the worst level of the sites it read, as one unit', () => {
  const read = ['app/a.rb', 'app/f.rb', 'app/j.rb']
  const paths = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((name) => `app/${name}.rb`)
  const mechanical = bucket('b1', { paths, files: paths.length, treatment: 'sample', why: '10 files with the same edit', sample: { read, trusted: 7 } })
  const sites = [node('a', withLevel('mid', { path: 'app/a.rb', bucket: 'b1' })), node('f', { path: 'app/f.rb', bucket: 'b1' }), node('j', withLevel('mid', { path: 'app/j.rb', bucket: 'b1' }))]
  const units = curate({ graph: graph(sites), triage: triage([mechanical]), diffs: diffsFor(sites) })
  assert.equal(units.units.length, 1)
  const [unit] = units.units
  assert.equal(unit!.level, 'mid')
  assert.equal(unit!.grouping, 'bucket')
  assert.deepEqual([...unit!.nodes].sort(), ['a', 'f', 'j'])
  assert.equal(unit!.facts.proof.value, 'lifecycle-observed')
})

test('a unit says where it is reached from and what changed in short, plain sentences', () => {
  // The scan names the action as an entry point, and its path names it again: it is said once, without its kind.
  const show = node('show', { symbol: 'ErrorsController#show', path: 'app/controllers/errors_controller.rb', lines: [2, 13], changed_lines: [9, 10, 11, 12], entries: ['ErrorsController#show (controller)', 'ErrorsController#show'], ...withLevel('high') })
  const added = node('count', { symbol: 'Cart#count', change: 'added', changed_lines: [4, 5], entries: [] })
  const result = curate({ graph: graph([show, added]), triage: triageFor([show, added]), diffs: [] })
  const unitOf = (id: string) => result.units.find((unit) => unit.nodes.includes(id))!
  assert.deepEqual([unitOf('show').where, unitOf('show').what], ['Reached from ErrorsController#show.', 'Changes 4 lines in `show`.'])
  assert.deepEqual([unitOf('count').where, unitOf('count').what], ['No route, job or command was found that leads to it.', 'Adds `count`, 2 lines.'])
})

test('a title says what proves the change in plain words, and who runs it only when a condition holds it back', () => {
  const titled = (proof: 'isolated' | 'lifecycle' | 'lifecycle-observed', exposure: 'everyone' | 'nobody-yet' = 'everyone') => {
    const a = node('link_user_tags', withLevel('mid', { facts: { ...node('x').facts, proof: { value: proof, evidence: '' }, exposure: { value: exposure, evidence: '' } } }))
    return curate({ graph: graph([a]), triage: triageFor([a]), diffs: [] }).units[0]!.title
  }
  assert.equal(titled('isolated'), '`link_user_tags` changes behaviour, and tests that call it directly fail without the change')
  assert.equal(titled('lifecycle'), '`link_user_tags` changes behaviour, and a test goes through a request to it')
  assert.equal(titled('lifecycle-observed', 'nobody-yet'), '`link_user_tags` changes behaviour for nobody yet, and a test added with it goes through a request to it')
})
