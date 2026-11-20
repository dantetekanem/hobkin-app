import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layOut, placePath } from '../src/features/proofs/graph/layout.ts'
import { aroundPicture, defaultLens, groupedPicture, pathPicture, stateGraph } from '../src/features/proofs/graph/model.ts'
import { findStates, parseQuery } from '../src/features/proofs/graph/search.ts'
import { formatValue, lensesOf } from '../src/features/proofs/graph/values.ts'
import { brokenRun, holdingRun, traceOnlyRun } from './proof-graph-fixture.ts'

const ids = (picture: { nodes: { id: string }[] }) => picture.nodes.map((node) => node.id)

test('a value reads as TLA+ writes it, with Unicode brackets for sequences and maps', () => {
  assert.equal(formatValue({ kind: 'string', text: 'merged' }), '"merged"')
  assert.equal(formatValue({ kind: 'string', text: '"merged"' }), '"merged"')
  assert.equal(formatValue({ kind: 'boolean', text: 'true' }), 'TRUE')
  assert.equal(formatValue({ kind: 'set', items: [{ kind: 'number', text: '1' }, { kind: 'model', text: 'None' }] }), '{1, None}')
  assert.equal(formatValue({ kind: 'sequence', items: [] }), '⟨⟩')
  assert.equal(formatValue({ kind: 'function', pairs: [{ key: 'i1', value: { kind: 'number', text: '2' } }] }), '[i1 ↦ 2]')
})

test('a function variable can be read whole or at each of its keys', () => {
  const lenses = lensesOf(brokenRun().trace![0]!.vars).map((lens) => lens.label)
  assert.deepEqual(lenses.slice(0, 3), ['state[i1]', 'state[i2]', 'state'])
  assert.equal(lenses.length, 12)
})

test('the graph finds each state of the counterexample among the dumped states', () => {
  const graph = stateGraph(brokenRun())
  assert.deepEqual(graph.path, ['s1', 's2', 's3', 's4', 's5', 's6'])
  assert.equal(graph.broken, true)
  assert.equal(graph.total, 4906)
  assert.equal(graph.dumped, true)
})

test('without a dump the graph is the counterexample alone', () => {
  const graph = stateGraph(traceOnlyRun())
  assert.equal(graph.path.length, 6)
  assert.equal(graph.nodes.size, 6)
  assert.equal(graph.dumped, false)
  assert.equal(graph.total, 4906)
})

test('the counterexample shows its path in order and fades the other moves from the same states', () => {
  const picture = pathPicture(stateGraph(brokenRun()))
  const steps = picture.nodes.filter((node) => node.look === 'step')
  assert.deepEqual(
    steps.map((node) => node.text),
    ['1', '2', '3', '4', '5', '6'],
  )
  assert.equal(steps.at(-1)!.breaks, true)
  assert.equal(steps.filter((node) => node.breaks).length, 1)
  assert.deepEqual(
    picture.nodes.filter((node) => node.look === 'side').map((node) => node.id),
    ['a', 'b', 'c'],
  )
  const path = picture.edges.filter((edge) => edge.look === 'path')
  assert.deepEqual(
    path.map((edge) => edge.labels[0]!.text),
    ['Start(i1)', 'Finish(i1)', 'Review(i1)', 'Fix(i1)', 'YoloMerge(i1)'],
  )
  assert.equal(path.at(-1)!.breaks, true)
  assert.deepEqual(
    picture.edges.filter((edge) => edge.look === 'side').map((edge) => `${edge.from}>${edge.to} ${edge.labels[0]!.text}`),
    ['s1>a Start', 's2>b Start', 's3>c Fix'],
  )
  assert.match(picture.note, /shortest path/)
})

test('around the path shows the states within two steps of it and says how many of how many', () => {
  const picture = aroundPicture(stateGraph(brokenRun()))
  assert.deepEqual(ids(picture).slice(0, 6), ['s1', 's2', 's3', 's4', 's5', 's6'])
  assert.deepEqual(ids(picture).slice(6).sort(), ['a', 'b', 'c', 'e'])
  assert.equal(picture.note, 'Showing 10 of 4,906 states: those within 2 steps of the path. Search to find others.')
  // f is three steps away.
  assert.ok(!ids(picture).includes('f'))
})

test('around the path stops at its cap and keeps the whole path', () => {
  const picture = aroundPicture(stateGraph(brokenRun()), { cap: 7 })
  assert.equal(picture.nodes.length, 7)
  assert.deepEqual(ids(picture).slice(0, 6), ['s1', 's2', 's3', 's4', 's5', 's6'])
  assert.match(picture.note, /^Showing 7 of 4,906 states/)
})

test('around shows the states a search found, with the path, and counts the matches', () => {
  const graph = stateGraph(brokenRun())
  const query = parseQuery('head[i1] = 2', lensesOf(graph.nodes.get('s1')!.vars))
  assert.ok(query?.ok)
  const match = new Set(findStates(graph, query.query))
  const picture = aroundPicture(graph, { match: { ids: match, text: 'head[i1] = 2' } })
  assert.deepEqual(ids(picture).sort(), ['c', 's1', 's2', 's3', 's4', 's5', 's6'])
  assert.equal(picture.note, 'Showing 3 of 3 states where head[i1] = 2, with the path.')
})

test('a model without a counterexample is explored around where it starts', () => {
  const picture = aroundPicture(stateGraph(holdingRun()))
  assert.deepEqual(ids(picture).sort(), ['a', 'b', 's1', 's2', 's3'])
  assert.match(picture.note, /within 2 steps of the start/)
})

test('without a dump, around says only the counterexample is there', () => {
  const picture = aroundPicture(stateGraph(traceOnlyRun()))
  assert.equal(picture.nodes.length, 6)
  assert.match(picture.note, /^Showing 6 of 4,906 states: TLC did not dump/)
})

test('grouped by a variable, each value is one node and each action its count on the arrow', () => {
  const run = brokenRun()
  const graph = stateGraph(run)
  const lens = defaultLens(graph)!
  assert.equal(lens.label, 'state[i1]')
  const picture = groupedPicture(graph, lens, run.actions)
  const groups = picture.nodes.filter((node) => node.look === 'group')
  assert.deepEqual(
    groups.map((node) => `${node.text} ${node.states.length}`),
    ['"queued" 2', '"doing" 2', '"branch" 6', '"merged" 1'],
  )
  assert.equal(groups.find((node) => node.text === '"merged"')!.breaks, true)
  const arrows = Object.fromEntries(picture.edges.map((edge) => [edge.id, edge.labels.map((label) => label.text).join(' / ')]))
  assert.equal(arrows['"queued">"doing"'], 'Start · 2')
  assert.equal(arrows['"doing">"branch"'], 'Finish · 2')
  assert.equal(arrows['"branch">"merged"'], 'YoloMerge · 1 · breaks')
  // Moves that keep the value loop on their node: the first action above, the rest below.
  assert.equal(arrows['"branch">"branch":above'], 'Review · 1')
  assert.equal(arrows['"branch">"branch":below'], 'Fix · 2 / Finish · 1')
  const ghost = picture.nodes.find((node) => node.look === 'ghost')!
  assert.equal(ghost.text, 'Decline · never fired')
  assert.match(picture.note, /grouped by state\[i1\]/)
})

test('grouped without a dump draws the counterexample states and their actions, without counts', () => {
  const run = traceOnlyRun()
  const graph = stateGraph(run)
  const picture = groupedPicture(graph, defaultLens(graph)!, run.actions)
  const arrows = picture.edges.map((edge) => edge.labels.map((label) => label.text).join(' / '))
  assert.ok(arrows.includes('Start'))
  assert.ok(arrows.includes('YoloMerge · breaks'))
  assert.match(picture.note, /TLC did not dump/)
})

test('grouped stops at its cap of values and says so', () => {
  const run = brokenRun()
  const graph = stateGraph(run)
  const picture = groupedPicture(graph, defaultLens(graph)!, run.actions, { cap: 2 })
  assert.equal(picture.nodes.filter((node) => node.look === 'group').length, 2)
  assert.match(picture.note, /Showing the 2 biggest of 4 values/)
})

test('search reads variable = value, with or without quotes, and finds the states that match', () => {
  const graph = stateGraph(brokenRun())
  const lenses = lensesOf(graph.nodes.get('s1')!.vars)
  const merged = parseQuery('state[i1] = "merged"', lenses)
  assert.ok(merged?.ok)
  assert.deepEqual(findStates(graph, merged.query), ['s6'])
  const bare = parseQuery('state[i1]=merged', lenses)
  assert.ok(bare?.ok)
  assert.deepEqual(findStates(graph, bare.query), ['s6'])
  const not = parseQuery('state[i2] ≠ "queued"', lenses)
  assert.ok(not?.ok)
  assert.deepEqual(findStates(graph, not.query).sort(), ['a', 'b', 'e', 'f'])
  assert.equal(parseQuery('   ', lenses), null)
  assert.deepEqual(parseQuery('clock = 3', lenses), { ok: false, reason: 'No variable is called clock.' })
  assert.deepEqual(parseQuery('state[i9] = "doing"', lenses), { ok: false, reason: 'state has no i9.' })
  assert.equal(parseQuery('state[i1]', lenses)?.ok, false)
})

test('the layout puts each state of a path to the right of the one before, with no two boxes overlapping', () => {
  const boxes = ['1', '2', '3', 'x'].map((id) => ({ id, width: 44, height: 44 }))
  const at = layOut(boxes, [
    { from: '1', to: '2', weight: 8 },
    { from: '2', to: '3', weight: 8 },
    { from: '1', to: 'x' },
  ])
  assert.ok(at.get('1')!.x < at.get('2')!.x && at.get('2')!.x < at.get('3')!.x)
  for (const one of boxes)
    for (const two of boxes) {
      if (one === two) continue
      const [a, b] = [at.get(one.id)!, at.get(two.id)!]
      assert.ok(Math.abs(a.x - b.x) >= 44 || Math.abs(a.y - b.y) >= 44, `${one.id} and ${two.id} overlap`)
    }
})

test('the counterexample lies on one straight line, and the moves it did not take land above and below it in turn', () => {
  const picture = pathPicture(stateGraph(brokenRun()))
  const at = placePath(picture)
  const path = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => at.get(id)!)
  assert.ok(path.every((point) => point.y === 0))
  assert.ok(path.every((point, index) => index === 0 || point.x > path[index - 1]!.x))
  const middle = (id: string) => at.get(id)!.y + 13
  // a leaves state 1 into column 2 above, b leaves state 2 into column 3 below, c leaves state 3 into column 4 above.
  assert.ok(middle('a') < 0)
  assert.ok(middle('b') > 44)
  assert.ok(middle('c') < 0)
  assert.equal(at.get('a')!.x + 13, at.get('s2')!.x + 22)
})
