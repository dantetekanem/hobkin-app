import assert from 'node:assert/strict'
import { test } from 'node:test'
import { columnsOf, LANE_GAP, layoutRequest, layoutReview, layoutZones, nodeRect, pinPoints, MAX_CODE_COLUMNS, NODE_SIZE, readFlow, wirePins, ZONE_FRAME, zoneRects, type LayoutEdge, type LayoutNode, type LayoutZone, type ZoneNode } from '../review/layout.ts'
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

test('a caller of a caller sits a column further out, so the way to where a request enters reads across', () => {
  const life = [node('u1', 'code'), node('callee', 'context'), node('caller', 'context'), node('outer', 'context'), node('entry', 'context')]
  const positions = layoutReview(life, [wire('u1', 'callee'), wire('u1', 'caller'), wire('caller', 'outer'), wire('outer', 'entry')])
  const x = (id: string) => positions[id]!.x
  assert.equal(x('callee'), x('caller'), 'what the change calls and what calls it start the context band together')
  assert.ok(x('u1') < x('caller') && x('caller') < x('outer') && x('outer') < x('entry'))
  assertNoOverlap(life, positions)
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

test('a request reads left to right: where it enters, the callers, the change, what it calls; tests sit under it', () => {
  const entry = { kind: 'route', exact: true }
  const way = [{ ...node('route', 'context'), entry }, node('controller', 'context'), node('helper', 'code'), node('callee', 'context'), node('script', 'code'), node('readme', 'file')]
  const lane = [node('t-helper', 'test'), node('t-script', 'test'), node('t-other', 'test'), node('A1', 'criterion')]
  const all = [...way, ...lane]
  const wires = [wire('route', 'controller'), wire('controller', 'helper'), wire('helper', 'callee'), wire('t-helper', 'helper'), wire('t-script', 'script'), wire('t-other', 'script'), wire('A1', 't-helper')]
  const positions = layoutRequest(all, wires)
  const x = (id: string) => positions[id]!.x
  const y = (id: string) => positions[id]!.y
  const kind = (id: string) => all.find((entry) => entry.id === id)!.kind

  assert.ok(x('route') < x('controller') && x('controller') < x('helper') && x('helper') < x('callee'), 'the way a request goes, left to right')
  // A way no entry reaches is not an entry: it starts at the column of the change, in a row of its own under the ways that do.
  const entered = ['route', 'controller', 'helper', 'callee']
  const enteredBottom = Math.max(...entered.map((id) => y(id) + NODE_SIZE[kind(id)].height))
  for (const id of ['script', 'readme']) {
    assert.equal(x(id), x('helper'), `${id} starts at the change's column`)
    assert.ok(y(id) > enteredBottom, `${id} sits under the ways a request enters`)
  }
  assert.equal(new Set(way.filter((entry) => x(entry.id) === x('route')).map((entry) => entry.id)).size, 1, 'the first column holds only where a request enters')
  // Tests and acceptance lines are off the way: in a lane under it, each just left of what it covers, so its wire rises to it.
  const bottom = Math.max(...way.map((entry) => y(entry.id) + NODE_SIZE[entry.kind].height))
  for (const entry of lane) assert.ok(y(entry.id) >= bottom + LANE_GAP - 1, `${entry.id} sits under the way`)
  assert.ok(x('t-helper') + NODE_SIZE.test.width < x('helper') && x('helper') - x('t-helper') < 2 * NODE_SIZE.test.width)
  assert.ok(x('A1') + NODE_SIZE.criterion.width < x('t-helper'), 'the line its test proves sits left of that test')
  // Two tests of the same code do not sit on each other.
  assertNoOverlap(all, positions)
  assert.ok(Math.abs(x('t-script') - x('t-other')) >= NODE_SIZE.test.width || y('t-script') !== y('t-other'))

  // From the origin, in whole points, the same every time.
  assert.equal(Math.min(...Object.values(positions).map((position) => position.x)), 0)
  assert.equal(Math.min(...Object.values(positions).map((position) => position.y)), 0)
  assert.ok(Object.values(positions).every((position) => Number.isInteger(position.x) && Number.isInteger(position.y)))
  assert.deepEqual(layoutRequest(all, wires), positions)
  assert.equal(kind('route'), 'context')
})

/** A request through four zones, a zone of tests that mirrors the third, and a spec's acceptance lines. */
function zoned() {
  const zones: LayoutZone[] = [
    { id: 'routes', layer: 'route' },
    { id: 'controllers', layer: 'controller' },
    { id: 'helpers', layer: 'helper' },
    { id: 'helper-tests', layer: 'test:helper' },
    { id: 'models', layer: 'model' },
    { id: 'spec', layer: '_specs' },
  ]
  const at = (id: string, kind: NodeKind, zone: string, more: Partial<ZoneNode> = {}): ZoneNode => ({ id, kind, zone, ...more })
  const entry = { kind: 'route' }
  const all: ZoneNode[] = [
    at('A1', 'criterion', 'spec'),
    at('t-render', 'test', 'helper-tests'),
    at('t-link', 'test', 'helper-tests'),
    at('t-link-2', 'test', 'helper-tests'),
    at('link', 'code', 'helpers', { change: 'modified' }),
    at('render', 'context', 'helpers', { change: 'unchanged' }),
    at('posts', 'context', 'controllers', { change: 'unchanged' }),
    at('feeds', 'context', 'controllers', { change: 'unchanged' }),
    at('get-post', 'context', 'routes', { change: 'unchanged', entry }),
    at('get-feed', 'context', 'routes', { change: 'unchanged', entry }),
    at('user', 'context', 'models', { change: 'unchanged' }),
    // A node whose zone the review does not list still has a place.
    at('stray', 'file', 'nowhere'),
  ]
  const wires = [
    wire('get-post', 'posts'),
    wire('get-feed', 'feeds'),
    wire('posts', 'render'),
    wire('feeds', 'render'),
    wire('render', 'link'),
    wire('link', 'user'),
    wire('t-render', 'render'),
    wire('t-link', 'link'),
    wire('t-link-2', 'link'),
    wire('A1', 't-link'),
  ]
  return { zones, all, wires }
}

test('zones: one block for each, in the order given, none overlapping another, and every node inside its own', () => {
  const { zones, all, wires } = zoned()
  const positions = layoutZones(all, wires, zones)
  assert.deepEqual(Object.keys(positions).sort(), all.map((entry) => entry.id).sort(), 'every node has a place')
  assertNoOverlap(all, positions)

  const rects = zoneRects(all.map((entry) => (entry.zone === 'nowhere' ? { ...entry, zone: undefined } : entry)), positions)
  const listed = [...rects.keys()]
  for (const [index, one] of listed.entries()) {
    for (const two of listed.slice(index + 1)) assert.equal(overlaps(rects.get(one)!, rects.get(two)!), false, `the zones ${one} and ${two} overlap`)
  }
  for (const entry of all.filter((each) => each.zone !== 'nowhere')) {
    const box = rects.get(entry.zone!)!
    const rect = nodeRect(entry.kind, positions[entry.id]!)
    assert.ok(rect.x >= box.x + ZONE_FRAME.pad && rect.x + rect.width <= box.x + box.width - ZONE_FRAME.pad, `${entry.id} is inside its zone across`)
    assert.ok(rect.y >= box.y + ZONE_FRAME.head && rect.y + rect.height <= box.y + box.height - ZONE_FRAME.pad, `${entry.id} is inside its zone down, under its heading`)
  }

  // A request reads left to right: each zone of code after the one it passes first, the regions' tops on one line.
  const code = ['routes', 'controllers', 'helpers', 'models'].map((id) => rects.get(id)!)
  for (let index = 1; index < code.length; index += 1) {
    assert.ok(code[index - 1]!.x + code[index - 1]!.width + ZONE_FRAME.gap <= code[index]!.x, `${zones[index]!.id} comes after the zone before it`)
    assert.equal(code[index]!.y, code[0]!.y)
  }
  // Inside a block, columns by call depth: the caller before what it calls.
  assert.ok(positions.render!.x < positions.link!.x)
  assert.equal(positions['get-post']!.x, positions['get-feed']!.x)
  // The acceptance lines lead, as spec 006 has them, so their wires to the tests run forward.
  assert.ok(rects.get('spec')!.x + rects.get('spec')!.width <= code[0]!.x)
  // A node the review puts in no zone it lists stands in a block of its own, which no wire joins: under the zones of
  // the column where the change is.
  assert.equal(positions.stray!.x, positions.render!.x)
  assert.ok(positions.stray!.y > rects.get('helper-tests')!.y + rects.get('helper-tests')!.height)

  // The same review always lays out the same way, in whole points, its first region at the origin.
  assert.deepEqual(layoutZones(all, wires, zones), positions)
  assert.ok(Object.values(positions).every((position) => Number.isInteger(position.x) && Number.isInteger(position.y)))
  assert.equal(Math.min(...[...rects.values()].map((rect) => rect.x)), 0)
  assert.equal(Math.min(...[...rects.values()].map((rect) => rect.y)), 0)
})

test('zones: a zone of tests sits under the code it mirrors, each test just left of what it covers, so its wire is short', () => {
  const { zones, all, wires } = zoned()
  const positions = layoutZones(all, wires, zones)
  const rects = zoneRects(all, positions)
  const [tests, helpers] = [rects.get('helper-tests')!, rects.get('helpers')!]
  assert.ok(tests.y >= helpers.y + helpers.height + ZONE_FRAME.gap, 'under the zone it mirrors, with room between')
  assert.ok(tests.x < helpers.x + helpers.width && helpers.x < tests.x + tests.width, 'beside it, not off in a corner')
  const [from, to] = [positions['t-link']!, positions.link!]
  assert.ok(from.x + NODE_SIZE.test.width < to.x, 't-link sits left of link, so its wire leaves a right pin into a left one')
  assert.ok(to.x - from.x < 2 * NODE_SIZE.test.width, 't-link sits near link')
  // A test of code in the first column stands under it, so the zone's region starts where its code does, tests or none.
  assert.equal(positions['t-render']!.x, positions.render!.x)
  assert.ok(tests.x >= helpers.x)
  assert.equal(overlaps(nodeRect('test', positions['t-link']!), nodeRect('test', positions['t-link-2']!)), false)
  const untested = layoutZones(all.filter((entry) => entry.kind !== 'test'), wires, zones)
  assert.equal(zoneRects(all, untested).get('helpers')!.x, helpers.x, "folding the zone's tests away leaves its heading where it was")
})

test('zones: zones a request reaches together stand one under the other, so no wire runs behind a zone it skips', () => {
  const zones: LayoutZone[] = [
    { id: 'routes', layer: 'route' },
    { id: 'posts', layer: 'controller' },
    { id: 'feeds', layer: 'controller' },
    { id: 'helpers', layer: 'helper' },
    { id: 'script', layer: 'script' },
  ]
  const all: ZoneNode[] = [
    { id: 'get-post', kind: 'context', zone: 'routes', entry: {} },
    { id: 'get-feed', kind: 'context', zone: 'routes', entry: {} },
    { id: 'post', kind: 'context', zone: 'posts' },
    { id: 'feed', kind: 'context', zone: 'feeds' },
    { id: 'render', kind: 'code', zone: 'helpers', change: 'modified' },
    // Changed code nothing calls stands under the change, not under where a request enters.
    { id: 'fetch', kind: 'code', zone: 'script', change: 'added' },
  ]
  const wires = [wire('get-post', 'post'), wire('get-feed', 'feed'), wire('post', 'render'), wire('feed', 'render')]
  const positions = layoutZones(all, wires, zones)
  const rects = zoneRects(all, positions)
  const [posts, feeds, helpers, script] = ['posts', 'feeds', 'helpers', 'script'].map((id) => rects.get(id)!)
  assert.equal(posts!.x, feeds!.x, 'the two controllers share a column')
  assert.ok(posts!.y + posts!.height + ZONE_FRAME.gap <= feeds!.y, 'in the order given, one under the other')
  assert.ok(rects.get('routes')!.x + rects.get('routes')!.width < posts!.x && posts!.x + posts!.width < helpers!.x)
  assert.equal(script!.x, helpers!.x)
  assert.ok(script!.y >= helpers!.y + helpers!.height + ZONE_FRAME.gap)
  // No wire passes behind a zone it does not reach: each runs from one column to the next.
  for (const edge of wires) {
    const [from, to] = [all.find((entry) => entry.id === edge.from)!.zone!, all.find((entry) => entry.id === edge.to)!.zone!]
    const [left, right] = [rects.get(from)!, rects.get(to)!]
    for (const [zone, rect] of rects) {
      if (zone === from || zone === to) continue
      assert.ok(rect.x + rect.width <= left.x + left.width || rect.x >= right.x, `${edge.from} to ${edge.to} runs clear of ${zone}`)
    }
  }
  assertNoOverlap(all, positions)
})

/** Two ways in, two controllers a request reaches together, the helper they call, and a zone of tests that mirrors it. */
function twoWaysIn() {
  const zones: LayoutZone[] = [
    { id: 'routes', layer: 'route' },
    { id: 'posts', layer: 'controller' },
    { id: 'feeds', layer: 'controller' },
    { id: 'helpers', layer: 'helper' },
    { id: 'helper-tests', layer: 'test:helper' },
  ]
  const all: ZoneNode[] = [
    { id: 'get-post', kind: 'context', zone: 'routes', entry: {} },
    { id: 'get-feed', kind: 'context', zone: 'routes', entry: {} },
    { id: 'post', kind: 'context', zone: 'posts' },
    { id: 'feed', kind: 'context', zone: 'feeds' },
    { id: 'render', kind: 'code', zone: 'helpers', change: 'modified' },
    { id: 'link', kind: 'code', zone: 'helpers', change: 'modified' },
    { id: 't-link', kind: 'test', zone: 'helper-tests' },
  ]
  const wires = [wire('get-post', 'post'), wire('get-feed', 'feed'), wire('post', 'render'), wire('feed', 'render'), wire('render', 'link'), wire('t-link', 'link')]
  return { zones, all, wires }
}

test('zones left to right: ranks run across and the nodes of a rank one under the other', () => {
  const { zones, all, wires } = twoWaysIn()
  const positions = layoutZones(all, wires, zones, [], {}, 'left-to-right')
  assert.deepEqual(positions, layoutZones(all, wires, zones), 'left to right is the layout as it was')
  const rects = zoneRects(all, positions)
  const [routes, posts, feeds, helpers, tests] = ['routes', 'posts', 'feeds', 'helpers', 'helper-tests'].map((id) => rects.get(id)!)
  assert.ok(routes!.x + routes!.width + ZONE_FRAME.gap <= posts!.x && posts!.x + posts!.width + ZONE_FRAME.gap <= helpers!.x, 'each rank a column to the right')
  assert.equal(posts!.x, feeds!.x, 'the two controllers share a rank')
  assert.ok(posts!.y + posts!.height + ZONE_FRAME.gap <= feeds!.y, 'one under the other, in the order given')
  assert.ok(tests!.y >= helpers!.y + helpers!.height + ZONE_FRAME.gap, 'the tests under the code they mirror')
  assert.ok(positions['t-link']!.x + NODE_SIZE.test.width < positions.link!.x, 'a test just before what it covers')
  for (const edge of wires) {
    const [from, to] = [all.find((entry) => entry.id === edge.from)!, all.find((entry) => entry.id === edge.to)!]
    const { source, target } = wirePins({ kind: from.kind, position: positions[from.id]! }, { kind: to.kind, position: positions[to.id]! }, 'left-to-right')
    assert.deepEqual(source, { x: positions[from.id]!.x + NODE_SIZE[from.kind].width, y: positions[from.id]!.y + NODE_SIZE[from.kind].height / 2 }, 'it leaves the right edge')
    assert.deepEqual(target, { x: positions[to.id]!.x, y: positions[to.id]!.y + NODE_SIZE[to.kind].height / 2 }, 'it arrives at the left edge')
    assert.ok(source.x < target.x, `${edge.from} to ${edge.to} runs right`)
  }
})

test('zones top to bottom: the same graph with its ranks running down and the nodes of a rank side by side', () => {
  const { zones, all, wires } = twoWaysIn()
  const positions = layoutZones(all, wires, zones, [], {}, 'top-to-bottom')
  assert.deepEqual(Object.keys(positions).sort(), all.map((entry) => entry.id).sort(), 'every node has a place')
  assertNoOverlap(all, positions)

  // The regions keep their heading above their nodes, none overlaps another, and every node is inside its own.
  const rects = zoneRects(all, positions)
  const listed = [...rects.keys()]
  for (const [index, one] of listed.entries()) {
    for (const two of listed.slice(index + 1)) assert.equal(overlaps(rects.get(one)!, rects.get(two)!), false, `the zones ${one} and ${two} overlap`)
  }
  for (const entry of all) {
    const box = rects.get(entry.zone!)!
    const rect = nodeRect(entry.kind, positions[entry.id]!)
    assert.ok(rect.x >= box.x + ZONE_FRAME.pad && rect.x + rect.width <= box.x + box.width - ZONE_FRAME.pad, `${entry.id} is inside its zone across`)
    assert.ok(rect.y >= box.y + ZONE_FRAME.head && rect.y + rect.height <= box.y + box.height - ZONE_FRAME.pad, `${entry.id} is inside its zone down, under its heading`)
  }

  // Ranks run down: where a request enters, then the controllers, then the helper they call.
  const [routes, posts, feeds, helpers, tests] = ['routes', 'posts', 'feeds', 'helpers', 'helper-tests'].map((id) => rects.get(id)!)
  assert.ok(routes!.y + routes!.height + ZONE_FRAME.gap <= posts!.y && posts!.y + posts!.height + ZONE_FRAME.gap <= helpers!.y, 'each rank a row further down')
  // The nodes of a rank spread across: the two controllers side by side in the order given, the two ways in too.
  assert.equal(posts!.y, feeds!.y, 'the two controllers share a rank')
  assert.ok(posts!.x + posts!.width + ZONE_FRAME.gap <= feeds!.x, 'side by side, in the order given')
  assert.equal(positions['get-post']!.y, positions['get-feed']!.y)
  assert.ok(positions['get-post']!.x + NODE_SIZE.context.width <= positions['get-feed']!.x)
  // Inside a block, the caller above what it calls.
  assert.ok(positions.render!.y + NODE_SIZE.code.height < positions.link!.y)
  // The tests beside the code they mirror, each just above what it covers, so its wire is short.
  assert.ok(tests!.x >= helpers!.x + helpers!.width + ZONE_FRAME.gap, 'beside the zone it mirrors, with room between')
  assert.ok(tests!.y < helpers!.y + helpers!.height && helpers!.y < tests!.y + tests!.height, 'level with it, not off in a corner')
  assert.ok(positions['t-link']!.y + NODE_SIZE.test.height < positions.link!.y, 't-link sits above link')
  assert.ok(positions.link!.y - positions['t-link']!.y < 2 * NODE_SIZE.test.height + 2 * ZONE_FRAME.head, 't-link sits near link')

  // Every wire leaves the bottom edge of its source and arrives at the top edge of its target, running down.
  for (const edge of wires) {
    const [from, to] = [all.find((entry) => entry.id === edge.from)!, all.find((entry) => entry.id === edge.to)!]
    const { source, target } = wirePins({ kind: from.kind, position: positions[from.id]! }, { kind: to.kind, position: positions[to.id]! }, 'top-to-bottom')
    assert.deepEqual(source, { x: positions[from.id]!.x + NODE_SIZE[from.kind].width / 2, y: positions[from.id]!.y + NODE_SIZE[from.kind].height })
    assert.deepEqual(target, { x: positions[to.id]!.x + NODE_SIZE[to.kind].width / 2, y: positions[to.id]!.y })
    assert.ok(source.y < target.y, `${edge.from} to ${edge.to} runs down`)
  }

  // The same review always lays out the same way, in whole points, its first region at the origin.
  assert.deepEqual(layoutZones(all, wires, zones, [], {}, 'top-to-bottom'), positions)
  assert.ok(Object.values(positions).every((position) => Number.isInteger(position.x) && Number.isInteger(position.y)))
  assert.equal(Math.min(...[...rects.values()].map((rect) => rect.x)), 0)
  assert.equal(Math.min(...[...rects.values()].map((rect) => rect.y)), 0)
})

test('zones top to bottom: a group opened in place fills its rows across, then down, and no two zones overlap', () => {
  const zones: LayoutZone[] = [{ id: 'one', layer: 'service' }, { id: 'two', layer: 'model' }]
  const all: ZoneNode[] = [
    { id: 'fold:a', kind: 'file', zone: 'one' },
    { id: 'b', kind: 'code', zone: 'one' },
    ...Array.from({ length: 9 }, (_, index): ZoneNode => ({ id: `m${index}`, kind: 'code', zone: 'one' })),
    { id: 'c', kind: 'code', zone: 'two' },
  ]
  const wires = [wire('fold:a', 'b'), wire('b', 'c')]
  const closed = layoutZones(all.filter((entry) => !/^m\d/.test(entry.id)), wires, zones, [], {}, 'top-to-bottom')
  const open = layoutZones(all, wires, zones, [{ at: 'fold:a', ids: Array.from({ length: 9 }, (_, index) => `m${index}`) }], {}, 'top-to-bottom')
  assertNoOverlap(all, open)
  assert.deepEqual(open['fold:a'], closed['fold:a'], 'the group card stays where it stood')
  assert.equal(open.m0!.y, open['fold:a']!.y, 'its first member beside it, on its row')
  assert.ok(open.m0!.x > open['fold:a']!.x)
  const rects = zoneRects(all, open)
  assert.equal(overlaps(rects.get('one')!, rects.get('two')!), false)
  assert.ok(rects.get('one')!.y + rects.get('one')!.height <= rects.get('two')!.y, 'what it calls still a rank further down')
})

test('a saved flow reads back as left to right unless it is top to bottom', () => {
  assert.deepEqual([readFlow('top-to-bottom'), readFlow('left-to-right'), readFlow(undefined), readFlow('down')], ['top-to-bottom', 'left-to-right', 'left-to-right', 'left-to-right'])
})

test('zones: a group opened in place grows its own zone, and no two zones overlap', () => {
  const zones: LayoutZone[] = [{ id: 'one', layer: 'service' }, { id: 'two', layer: 'model' }, { id: 'three', layer: 'model' }]
  const all: ZoneNode[] = [
    { id: 'fold:a', kind: 'file', zone: 'one' },
    { id: 'b', kind: 'code', zone: 'one' },
    ...Array.from({ length: 9 }, (_, index): ZoneNode => ({ id: `m${index}`, kind: 'code', zone: 'one' })),
    // An open group can hold a node of another zone: it stands in its own.
    { id: 'far', kind: 'code', zone: 'three' },
    { id: 'c', kind: 'code', zone: 'two' },
    { id: 'd', kind: 'code', zone: 'three' },
  ]
  const wires = [wire('fold:a', 'b'), wire('b', 'c'), wire('c', 'd')]
  const closed = layoutZones(all.filter((entry) => !/^m\d|far/.test(entry.id)), wires, zones)
  const blocks = [{ at: 'fold:a', ids: [...Array.from({ length: 9 }, (_, index) => `m${index}`), 'far'] }]
  const open = layoutZones(all, wires, zones, blocks)
  assertNoOverlap(all, open)
  assert.deepEqual(open['fold:a'], closed['fold:a'], 'the group card stays where it stood')
  for (let index = 0; index < 9; index += 1) assert.ok(open[`m${index}`]!.x >= open['fold:a']!.x && open[`m${index}`]!.y >= open['fold:a']!.y)
  const rects = zoneRects(all, open)
  assert.equal(overlaps(rects.get('one')!, rects.get('two')!), false)
  assert.equal(overlaps(rects.get('two')!, rects.get('three')!), false)
  const three = rects.get('three')!
  assert.ok(open.far!.x >= three.x && open.far!.x + NODE_SIZE.code.width <= three.x + three.width, 'the member of another zone stands in its own zone')
  assert.deepEqual(layoutZones(all, wires, zones, blocks), open)
})
