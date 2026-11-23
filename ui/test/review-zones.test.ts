import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeRect, ZONE_FRAME } from '#shared/review/layout.ts'
import type { Review, ReviewNode, ReviewZone } from '#shared/review/types.ts'
import { MAX_ZONES, regionsOf, zoneWords, zonesOf, type GraphZone } from '../src/features/review/graph/zones.ts'
import { pullReview } from '../src/features/review/sample/pull.ts'

/** The pull sample as an older host sent it: no zones on it. */
function unzoned(): Review {
  const { zones: _zones, ...review } = pullReview('pr:hobkin-sample/storefront/482')
  return { ...review, nodes: review.nodes.map(({ zone: _zone, ...node }) => node) }
}
/** Every node drawn as itself. */
const alone = (review: Pick<Review, 'nodes'>) => review.nodes.map((node) => ({ id: node.id, of: [node.id] }))
const zoneNamed = (zones: readonly GraphZone[], label: string) => zones.find((zone) => zone.label === label)

test('a review with no zones gets them named from its paths, every node in one, in the order a request passes them', () => {
  const review = unzoned()
  const { zones, zoneOf } = zonesOf(review, alone(review))
  for (const node of review.nodes) assert.ok(zones.some((zone) => zone.id === zoneOf[node.id]), `${node.title} is in a zone`)
  const of = (id: string) => zones.find((zone) => zone.id === zoneOf[id])!
  assert.equal(of('u1').label, 'Helpers · Posts')
  assert.equal(of('c1').label, 'Helpers · Posts', 'unchanged code is in the zone of its path too')
  assert.equal(of('c4').label, 'Models · User')
  assert.equal(of('u4').label, 'Tests · Posts helper', 'a test takes the subject of the code it mirrors')
  assert.equal(of('u4').tests, true)
  // Routes, then controllers, then the helper, then the model it calls: the way a request goes.
  const place = (id: string) => zones.indexOf(of(id))
  assert.ok(place('c5') < place('c2') && place('c2') < place('u1') && place('u1') < place('c4'))
  assert.ok(zones.length <= MAX_ZONES)
  // A node drawn as itself is in its zone by its own id, and a zone lists what it holds.
  assert.ok(of('u1').members.includes('u1') && of('u1').nodes.includes('c1'))
  assert.deepEqual(zonesOf(review, alone(review)), { zones, zoneOf }, 'the same review always gives the same zones')
})

test("the host's zones win: its words, its order, and a node it put in none is named from its path", () => {
  const review = unzoned()
  const renamed: ReviewZone = { id: 'posts', layer: 'helper', subject: 'post', label: 'Rendering posts' }
  const scripts: ReviewZone = { id: 'scripts', layer: 'script', subject: 'production_errors', label: 'Production errors script' }
  const zoned: Review = {
    ...review,
    zones: [scripts, renamed],
    nodes: review.nodes.map((node): ReviewNode => (node.id === 'u1' || node.id === 'c1' ? { ...node, zone: 'posts' } : node.id === 'u2' || node.id === 'u3' ? { ...node, zone: 'scripts' } : node)),
  }
  const { zones, zoneOf } = zonesOf(zoned, alone(zoned))
  assert.deepEqual(zones.slice(0, 2).map((zone) => zone.label), ['Production errors script', 'Rendering posts'], "the host's first, in its order")
  assert.equal(zoneOf.u1, 'posts')
  assert.equal(zones.find((zone) => zone.id === zoneOf.c4)?.label, 'Models · User', 'a node with no zone of the host is named from its path')
})

test('a card stands in the zone of the first node it holds, and every node it holds is in that zone', () => {
  const review = unzoned()
  const tests = review.nodes.filter((node) => node.kind === 'test' && node.subtitle === 'test/helpers/posts_helper_test.rb').map((node) => node.id)
  const drawn = [...review.nodes.filter((node) => !tests.includes(node.id)).map((node) => ({ id: node.id, of: [node.id] })), { id: 'tests:u1', of: tests }]
  const { zones, zoneOf } = zonesOf(review, drawn)
  assert.equal(zones.find((zone) => zone.id === zoneOf['tests:u1'])?.label, 'Tests · Posts helper')
  for (const id of tests) assert.equal(zoneOf[id], zoneOf['tests:u1'])
})

test('past twelve zones the small ones merge into their layer, which says how many subjects it holds', () => {
  const path = (folder: string, name: string) => `app/${folder}/${name}.rb`
  const nodes: ReviewNode[] = [
    ...['orders', 'carts', 'users', 'invoices', 'refunds', 'coupons', 'plans', 'taxes'].map((name, index) => codeAt(`c${index}`, path('controllers', `${name}_controller`))),
    // The models are larger than the controllers, so they keep their names.
    ...['order', 'cart', 'user', 'invoice', 'refund', 'coupon'].flatMap((name, index) => [codeAt(`m${index}`, path('models', name)), codeAt(`m${index}b`, path('models', name))]),
    // A big zone keeps its own name.
    ...Array.from({ length: 6 }, (_, index) => codeAt(`s${index}`, 'app/services/billing/charge.rb')),
  ]
  const review = { nodes, edges: [] }
  const { zones, zoneOf } = zonesOf(review, alone(review))
  assert.ok(zones.length <= MAX_ZONES, `${zones.length} zones`)
  const controllers = zoneNamed(zones, 'Controllers')!
  assert.equal(controllers.subjects, 8)
  for (let index = 0; index < 8; index += 1) assert.equal(zoneOf[`c${index}`], controllers.id)
  assert.ok(zoneNamed(zones, 'Services · Billing charge'), 'the biggest zone keeps its name')
  assert.ok(zoneNamed(zones, 'Models · Order'))
  assert.ok(zoneWords(controllers).includes('8 subjects'))
})

test("a zone counts what changed in it, what needs the reviewer and its tests, and says so in a few words", () => {
  const review = pullReview('pr:hobkin-sample/storefront/482')
  const tests = review.nodes.filter((node) => node.kind === 'test')
  // Every test of the helper covers link_user_tags, as the arranged graph says.
  const covers = Object.fromEntries(tests.filter((node) => node.subtitle === 'test/helpers/posts_helper_test.rb').map((node) => [node.id, 'u1']))
  const { zones, zoneOf } = zonesOf(review, alone(review), covers)
  const helpers = zones.find((zone) => zone.id === zoneOf.u1)!
  assert.equal(helpers.counts.changed, 1, 'link_user_tags changed, render_body did not')
  assert.equal(helpers.counts.needsYou, review.nodes.filter((node) => zoneOf[node.id] === helpers.id && node.attention?.tier === 'needs-you').length)
  assert.equal(helpers.counts.tests, Object.keys(covers).length)
  assert.equal(helpers.standing, helpers.counts.needsYou > 0 ? 'needs-you' : 'worth-a-look')
  const routes = zones.find((zone) => zone.id === zoneOf.c5)!
  assert.deepEqual(routes.counts, { changed: 0, needsYou: 0, tests: 0 })
  assert.equal(routes.standing, 'context')
  assert.equal(zoneWords(routes), 'Unchanged')
  assert.match(zoneWords(helpers), /7 tests/)
})

test('each zone is drawn as a region around its drawn nodes, with room above them for its heading', () => {
  const nodes = [
    { id: 'a', kind: 'code' as const, position: { x: 0, y: 0 }, zone: 'one' },
    { id: 'b', kind: 'code' as const, position: { x: 420, y: 0 }, zone: 'one' },
    { id: 'c', kind: 'context' as const, position: { x: 900, y: 40 }, zone: 'two' },
    { id: 'd', kind: 'file' as const, position: { x: 1400, y: 0 } },
  ]
  const zones = [{ id: 'two' }, { id: 'one' }, { id: 'three' }] as GraphZone[]
  const regions = regionsOf(nodes, zones)
  assert.deepEqual(regions.map((region) => region.zone), ['two', 'one'], 'in the order of the zones, and only those drawn')
  const one = regions.find((region) => region.zone === 'one')!.rect
  for (const id of ['a', 'b']) {
    const rect = nodeRect('code', nodes.find((node) => node.id === id)!.position)
    assert.ok(rect.x >= one.x && rect.x + rect.width <= one.x + one.width && rect.y - ZONE_FRAME.head >= one.y)
  }
  assert.equal(regions[0]!.id, 'zone:two')
})

function codeAt(id: string, path: string): ReviewNode {
  return { id, kind: 'code', title: id, subtitle: path, change: 'modified', summary: '', anchors: [], position: { x: 0, y: 0 } }
}
