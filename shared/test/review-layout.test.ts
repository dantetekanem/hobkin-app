import assert from 'node:assert/strict'
import { test } from 'node:test'
import { columnsOf, layoutReview, nodeRect, pinPoints, MAX_CODE_COLUMNS, NODE_SIZE, type LayoutEdge, type LayoutNode } from '../review/layout.ts'
import { stressReview } from '../review/stress.ts'
import type { NodeKind } from '../review/types.ts'

const node = (id: string, kind: NodeKind): LayoutNode => ({ id, kind })
const wire = (from: string, to: string): LayoutEdge => ({ from, to })

const nodes: LayoutNode[] = [
  node('A1', 'criterion'),
  node('A2', 'criterion'),
  node('A3', 'criterion'),
  node('t1', 'test'),
  node('t2', 'test'),
  node('ui', 'code'),
  node('app', 'code'),
  node('runtime', 'code'),
  node('word', 'code'),
  node('lonely', 'code'),
  node('notes', 'file'),
  node('mood', 'context'),
  node('clock', 'context'),
]
const edges: LayoutEdge[] = [
  wire('A1', 't1'),
  wire('A2', 't2'),
  wire('A3', 'ui'),
  wire('t1', 'word'),
  wire('t2', 'ui'),
  wire('ui', 'app'),
  wire('app', 'runtime'),
  wire('runtime', 'word'),
  // A cycle among code must not hang the layout or push a node out of its band.
  wire('word', 'runtime'),
  wire('word', 'mood'),
  wire('ui', 'clock'),
]

function overlaps(a: ReturnType<typeof nodeRect>, b: ReturnType<typeof nodeRect>): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function assertNoOverlap(all: readonly LayoutNode[], positions: ReturnType<typeof layoutReview>) {
  const rects = all.map((entry) => ({ id: entry.id, rect: nodeRect(entry.kind, positions[entry.id]!) }))
  for (let first = 0; first < rects.length; first += 1) {
    for (let second = first + 1; second < rects.length; second += 1) {
      assert.equal(overlaps(rects[first]!.rect, rects[second]!.rect), false, `${rects[first]!.id} and ${rects[second]!.id} overlap`)
    }
  }
}

test('places nodes in columns without overlap', () => {
  const positions = layoutReview(nodes, edges)
  const x = (id: string) => positions[id]!.x
  const right = (id: string) => x(id) + NODE_SIZE[nodes.find((entry) => entry.id === id)!.kind].width

  assert.deepEqual(Object.keys(positions).sort(), nodes.map((entry) => entry.id).sort(), 'every node has a place')
  assertNoOverlap(nodes, positions)

  // Columns run left to right: spec, tests, code, context. A whole column clears the one before it.
  const band = (kind: NodeKind[]) => nodes.filter((entry) => kind.includes(entry.kind)).map((entry) => entry.id)
  const bands = [band(['criterion']), band(['test']), band(['code', 'file']), band(['context'])]
  for (let index = 1; index < bands.length; index += 1) {
    const reach = Math.max(...bands[index - 1]!.map(right))
    for (const id of bands[index]!) assert.ok(x(id) > reach, `${id} starts after the column before it`)
  }
  assert.equal(new Set(band(['criterion']).map(x)).size, 1, 'one column of acceptance lines')
  assert.equal(new Set(band(['test']).map(x)).size, 1, 'one column of tests')
  assert.equal(new Set(band(['context']).map(x)).size, 1, 'one column of context')

  // Inside the code band, code sits left of the code it calls, so wires run forward.
  assert.ok(x('ui') < x('app') && x('app') < x('runtime'))
  // The cycle is broken in one place, and both of its nodes stay in the band.
  assert.notEqual(x('runtime'), x('word'))
  assert.equal(x('lonely'), x('ui'), 'code that nothing calls starts the band')

  // Every wire leaves a right pin and arrives at a left pin.
  for (const edge of edges) {
    const { source, target } = pinPoints(edge, nodes, positions)
    const from = nodes.find((entry) => entry.id === edge.from)!
    const to = nodes.find((entry) => entry.id === edge.to)!
    assert.equal(source.x, positions[from.id]!.x + NODE_SIZE[from.kind].width)
    assert.equal(target.x, positions[to.id]!.x)
    assert.equal(source.y, positions[from.id]!.y + NODE_SIZE[from.kind].height / 2)
    assert.equal(target.y, positions[to.id]!.y + NODE_SIZE[to.kind].height / 2)
  }
  const forward = edges.filter((edge) => !(edge.from === 'word' && edge.to === 'runtime') && !(edge.from === 'runtime' && edge.to === 'word'))
  for (const edge of forward) {
    const { source, target } = pinPoints(edge, nodes, positions)
    assert.ok(source.x < target.x, `${edge.from} to ${edge.to} runs forward`)
  }

  // Positions are whole numbers, start at the origin, and never change for the same review.
  assert.equal(Math.min(...Object.values(positions).map((position) => position.x)), 0)
  assert.equal(Math.min(...Object.values(positions).map((position) => position.y)), 0)
  assert.ok(Object.values(positions).every((position) => Number.isInteger(position.x) && Number.isInteger(position.y)))
  assert.deepEqual(layoutReview(nodes, edges), positions)
})

test('a wire pulls the nodes it joins to the same height', () => {
  const positions = layoutReview(
    [node('A1', 'criterion'), node('t1', 'test'), node('t2', 'test'), node('t3', 'test'), node('t4', 'test'), node('t5', 'test')],
    [wire('A1', 't4')],
  )
  const middle = (id: string, kind: NodeKind) => positions[id]!.y + NODE_SIZE[kind].height / 2

  assert.ok(Math.abs(middle('A1', 'criterion') - middle('t4', 'test')) <= 4, 'the line and its test line up')
})

test('acceptance lines keep the order of the spec, whatever they are wired to', () => {
  const positions = layoutReview(
    [node('A1', 'criterion'), node('A2', 'criterion'), node('t1', 'test'), node('t2', 'test'), node('t3', 'test'), node('t4', 'test'), node('u1', 'code')],
    // The first line is pulled down by the code it is wired to, and the second up by its test.
    [wire('A2', 't1'), wire('t4', 'u1'), wire('A1', 'u1')],
  )

  assert.ok(positions.A1!.y < positions.A2!.y, 'A1 stays above A2')
  assert.ok(positions.t1!.y < positions.t4!.y)
})

test('columns report which nodes they hold, in order', () => {
  const columns = columnsOf(nodes, edges)

  assert.deepEqual(columns.map((column) => column.band), ['spec', 'tests', 'code', 'code', 'code', 'code', 'context'])
  assert.deepEqual(columns[0]!.ids.slice().sort(), ['A1', 'A2', 'A3'])
  assert.ok(columns[2]!.ids.includes('ui') && columns[2]!.ids.includes('lonely'))
  assert.equal(columns[2]!.ids.at(-1), 'notes', 'files sit under the code in their column')
})

test('a chain of calls deeper than the code band is wide shares the last column', () => {
  const chain = Array.from({ length: MAX_CODE_COLUMNS + 3 }, (_, index) => node(`u${index}`, 'code'))
  const calls = chain.slice(1).map((entry, index) => wire(`u${index}`, entry.id))
  const positions = layoutReview(chain, calls)

  assert.equal(new Set(chain.map((entry) => positions[entry.id]!.x)).size, MAX_CODE_COLUMNS)
  assert.equal(positions[`u${MAX_CODE_COLUMNS - 1}`]!.x, positions[`u${MAX_CODE_COLUMNS + 2}`]!.x)
  assertNoOverlap(chain, positions)
})

test('a review without a spec or without context still starts at the left edge', () => {
  const positions = layoutReview([node('t1', 'test'), node('u1', 'code')], [wire('t1', 'u1')])

  assert.equal(positions.t1!.x, 0)
  assert.ok(positions.u1!.x > NODE_SIZE.test.width)
  assert.deepEqual(layoutReview([], []), {})
})

test('the 80 node stress review lays out without overlap, with every node in its band', async () => {
  const review = await stressReview()

  assert.equal(review.nodes.length, 80)
  assert.equal(review.edges.length, 160)
  assertNoOverlap(review.nodes, Object.fromEntries(review.nodes.map((entry) => [entry.id, entry.position])))
  const reach = (kinds: NodeKind[]) => Math.max(...review.nodes.filter((entry) => kinds.includes(entry.kind)).map((entry) => entry.position.x + NODE_SIZE[entry.kind].width))
  const start = (kinds: NodeKind[]) => Math.min(...review.nodes.filter((entry) => kinds.includes(entry.kind)).map((entry) => entry.position.x))
  assert.ok(reach(['criterion']) < start(['test']))
  assert.ok(reach(['test']) < start(['code', 'file']))
  assert.ok(reach(['code', 'file']) < start(['context']))
})
