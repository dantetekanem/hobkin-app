import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nodeRect, ZONE_FRAME } from '#shared/review/layout.ts'
import type { Review, ReviewNode, ReviewZone } from '#shared/review/types.ts'
import { FAR_HEADING, farRoom, headingRoom, headingWords, MAX_ZONES, regionsOf, zoneTitle, zoneWords, zonesOf, type GraphZone } from '../src/features/review/graph/zones.ts'
import { pullReview } from '../src/features/review/sample/pull.ts'
import { planEntrance } from '../src/features/review/graph/entrance-plan.ts'
import { keyOwner, pressKey } from '../src/features/review/keys.ts'
import { createReviewMemory } from '../src/features/review/state/memory.ts'
import { createSession } from '../src/features/review/state/session.ts'

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

test('the entrance brings each region in with its members, zone by zone, and a large graph only fades', () => {
  const at = (id: string, x: number, y: number, zone: string) => ({ id, position: { x, y }, zone })
  // The zone of tests stands under the code it covers, in the same columns: it still comes after that code.
  const nodes = [at('a', 0, 0, 'one'), at('b', 420, 0, 'one'), at('t', 0, 600, 'tests'), at('c', 900, 0, 'two'), at('d', 900, 180, 'two')]
  const plan = planEntrance(nodes, [{ id: 'w', from: 'a', to: 'c' }])
  const of = (zone: string) => nodes.filter((node) => node.zone === zone).map((node) => plan.nodes[node.id]!)
  assert.ok(Math.max(...of('one')) < Math.min(...of('tests')) && Math.max(...of('tests')) < Math.min(...of('two')), 'zone by zone')
  for (const zone of ['one', 'tests', 'two']) assert.equal(plan.zones[zone], Math.min(...of(zone)), `the region of ${zone} comes in with its first node`)
  assert.equal(plan.quiet, false)
  assert.ok(plan.wires.w! > plan.nodes.c!)

  const many = Array.from({ length: 41 }, (_, index) => at(`n${index}`, (index % 5) * 420, Math.floor(index / 5) * 180, `z${index % 5}`))
  const quiet = planEntrance(many, [])
  assert.equal(quiet.quiet, true)
  assert.deepEqual(quiet.wires, {})
  assert.equal(Object.keys(quiet.zones).length, 5)
})

test("J and K move to the next and the previous zone, on its first node that needs the reviewer, in Story and Free Roam; in the proof they are the proof's", () => {
  const keys = { panelKey: () => false, toggleSteps: () => {}, verdict: () => {}, proofKey: () => {} }
  const session = createSession(pullReview('pr:hobkin-sample/storefront/482'), createReviewMemory())
  const press = (key: string) => pressKey(session.getState(), { key, shift: false, alt: false }, keys)
  const zones = session.getState().view.zones
  const zoneOn = () => session.getState().view.nodes.find((node) => node.id === session.getState().focus[0])?.zone

  assert.equal(press('j'), true)
  assert.equal(zoneOn(), zones[0]!.id, 'from the whole graph, J goes to the first zone')
  assert.deepEqual(session.getState().focus, ['c5'], 'on its first node, as it is drawn, when none needs the reviewer')
  press('j')
  assert.equal(zoneOn(), zones[1]!.id)
  press('k')
  press('k')
  assert.equal(zoneOn(), zones.at(-1)!.id, 'K from the first zone goes round to the last')

  // A zone with a part that needs the reviewer is entered on it.
  const helpers = zones.findIndex((zone) => zone.label === 'Helpers · Posts')
  session.getState().setMode('roam')
  for (let step = 0; step <= helpers; step += 1) press('j')
  assert.deepEqual(session.getState().focus, ['u1'], 'in Free Roam too')

  // With the keyboard in the proof beside the review, J and K are the proof's.
  const heard = { key: 'j', shift: false, meta: false, ctrl: false, alt: false, typing: false }
  assert.equal(keyOwner(heard, true), 'proof')
  assert.equal(keyOwner({ ...heard, key: 'k' }, true), 'proof')
  assert.equal(keyOwner(heard, false), 'review')
})

test('however many small zones join Other parts, there is one of it, and the zones of acceptance lines keep their own', () => {
  const nodes: ReviewNode[] = [
    ...Array.from({ length: 16 }, (_, index) => codeAt(`n${index}`, `area${index}/thing.rb`)),
    // Acceptance lines with no path, as a host may send them, and a node with no path that joins Other parts.
    { ...codeAt('A1', ''), kind: 'criterion', change: 'unchanged' },
    { ...codeAt('A2', ''), kind: 'criterion', change: 'unchanged' },
    codeAt('loose', ''),
  ]
  const review = { nodes, edges: [] }
  const { zones, zoneOf } = zonesOf(review, alone(review))
  assert.ok(zones.length <= MAX_ZONES)
  assert.equal(new Set(zones.map((zone) => zone.id)).size, zones.length, 'every zone once')
  assert.equal(zones.filter((zone) => zone.label === 'Other parts').length, 1)
  assert.equal(zones.find((zone) => zone.id === zoneOf.A1)!.label, 'Acceptance lines')
  assert.equal(zones.find((zone) => zone.id === zoneOf.loose)!.label, 'Other parts')
})

test("a zone's heading never loses its subject before its layer: the whole name, the layer's first word, the subject, then the subject cut", () => {
  const zone = (label: string, subjects = 1) => ({ label, subjects })
  assert.deepEqual(zoneTitle(zone('Controllers · Posts')), { layer: 'Controllers', subject: 'Posts' })
  // A merged zone, Other parts and a name the Reviewer gave have no subject of their own: one line.
  for (const one of [zone('Controllers', 3), zone('Tests · billing', 12), zone('Other parts'), zone('Rendering posts')]) {
    assert.deepEqual(zoneTitle(one), { layer: null, subject: one.label })
  }

  const title = zoneTitle(zone('Host controllers · Admin orders'))
  const wide = headingWords(title, 1000, 14)
  assert.equal(wide, 'Host controllers · Admin orders')
  const room = (text: string) => text.length * 14 * 0.6
  assert.equal(headingWords(title, room('Host · Admin orders'), 14), 'Host · Admin orders', 'the layer gives way to its first word first')
  assert.equal(headingWords(title, room('Admin orders'), 14), 'Admin orders', 'then the layer goes, and the subject stays')
  assert.equal(headingWords(title, 20, 14), 'Admin orders', 'then only the subject is left, for the end of it to be cut')
  for (let width = 0; width < 400; width += 10) assert.match(headingWords(title, width, 14), /Admin orders$/, `at ${width} the subject is whole`)
  assert.equal(headingWords(zoneTitle(zone('Script · production errors')), room('production errors'), 14), 'production errors', 'a one-word layer goes whole')
  assert.equal(headingWords(zoneTitle(zone('Controllers', 3)), 10, 14), 'Controllers')

  // The room a heading has at reading size: its region less its padding, its mark and chevron, and room for some counts.
  assert.ok(headingRoom(344, 'Unchanged') > room('Controllers · Posts'), 'a one-column zone says "Controllers · Posts" whole')
  assert.ok(headingRoom(344, '2 need you · 13 tests') < headingRoom(344, 'Unchanged'))
  assert.ok(headingRoom(344, '2 need you · 13 tests · and a great many more words') > room('production err'), 'counts never take all the room')
})

test('from far away a heading is the same one line in larger type and without its counts, so the name gives up its layer sooner', () => {
  const title = zoneTitle({ label: 'Host controllers · Admin orders', subjects: 1 })
  const { far, farther } = FAR_HEADING
  assert.ok(far.size > 14 && farther.size > far.size, 'the type grows with the distance')
  // No counts and no chevron beside the name: all the heading's room but its padding, its mark and one gap.
  assert.equal(farRoom(344, 'far'), 344 - 2 * ZONE_FRAME.pad + 24 - (24 + far.mark + FAR_HEADING.gap))
  assert.ok(farRoom(344, 'farther') < farRoom(344, 'far'), 'a larger mark leaves a little less')
  assert.equal(headingWords(title, farRoom(1000, 'far'), far.size), 'Host controllers · Admin orders', 'a wide zone still says the whole name')
  assert.equal(headingWords(title, farRoom(344, 'far'), far.size), 'Admin orders', 'a one-column zone says the subject')
  assert.equal(headingWords(title, farRoom(344, 'farther'), farther.size), 'Admin orders', 'and from farther still, for its end to be cut')
  assert.equal(farRoom(40, 'far'), 0, 'never less than nothing')
})

test("a zone the rule no longer makes gives its nodes to the zone their path names now, in its place; a zone the host named itself stays", () => {
  // A review kept from before: the rule had named a zone after one file, and the Reviewer had given another its own name.
  const old: ReviewZone = { id: '-/docs/intro', layer: 'docs', subject: 'intro', label: 'Docs · Intro' }
  const named: ReviewZone = { id: 'people', layer: 'model', subject: 'person', label: 'People and accounts' }
  const kept: ReviewZone = { id: '-/model/order', layer: 'model', subject: 'order', label: 'Models · Order' }
  const review: Pick<Review, 'nodes' | 'edges' | 'zones'> = {
    nodes: [
      { ...codeAt('intro', 'docs/guide/intro.md'), zone: old.id },
      { ...codeAt('setup', 'docs/guide/setup.md'), zone: old.id },
      { ...codeAt('user', 'app/models/user.rb'), zone: named.id },
      { ...codeAt('order', 'app/models/order.rb'), zone: kept.id },
    ],
    edges: [],
    zones: [old, named, kept],
  }
  const { zones, zoneOf } = zonesOf(review, alone(review))
  assert.equal(zoneOf.intro, '-/docs/guide', 'the same layer under another subject: the path wins')
  assert.equal(zoneOf.setup, '-/docs/guide')
  assert.equal(zoneOf.user, 'people', "an id the rule never makes is the host's own zone")
  assert.equal(zoneOf.order, kept.id, 'a zone the rule still makes is kept as it is')
  assert.deepEqual(zones.map((zone) => zone.label), ['Docs · Guide', 'People and accounts', 'Models · Order'], 'the new zone stands where the old one stood, and the old one is gone')
})
