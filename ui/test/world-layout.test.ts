import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GLOBE, worldLayout, sceneFrame, activityObservation, sameObservations, type Island } from '../src/features/work/world-layout.ts'

type Point = { x: number; y: number }
type Facts = { merged?: number; prs?: number; branches?: number }

const zone = (slug: string, priority = 'P2', agentIds: string[] = [], facts: Facts = {}) => ({
  project: { slug, priority, ...facts },
  agents: agentIds.map((id) => ({ id })),
})

/** This many idle projects, spread over the four priorities. */
const projects = (count: number) => Array.from({ length: count }, (_, index) => zone(`project-${String(index).padStart(2, '0')}`, `P${index % 4}`))

/** A live world of alpha, where the agent `one` works, and beta. */
const world = (zones = [zone('alpha', 'P1', ['one']), zone('beta')], fresh = true, sourceIdentity = 'home:1') => ({ zones, fresh, sourceIdentity })

const toolCall = (id: string, state: 'running' | 'completed' = 'running') => ({ id, kind: 'tool' as const, state, name: 'read' })

const pole = GLOBE / 2
const fromPole = (island: Island) => Math.hypot(island.x - pole, island.y - pole)
const bearing = (island: Island) => Math.atan2(island.y - pole, island.x - pole)
const apart = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const coastReach = (island: Island) => island.coast.map((point) => Math.hypot(point.x, point.y))

function inside(point: Point, polygon: readonly Point[]) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!
    const b = polygon[j]!
    const straddles = a.y > point.y !== b.y > point.y
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

/** Whether a place on the globe is on the island's land, whose coast is measured from its centre in radii. */
const onLand = (place: Point, island: Island) => inside({ x: (place.x - island.x) / island.radius, y: (place.y - island.y) / island.radius }, island.coast)

test('layout is deterministic and priority ordered with exact slug ties: the top priority sits nearest the pole', () => {
  const zones = [zone('z'), zone('a'), zone('first', 'P0')]

  const layout = worldLayout(zones)

  assert.deepEqual(layout, worldLayout(zones.toReversed()))
  assert.deepEqual(
    layout.islands.map((island) => island.slug),
    ['first', 'a', 'z'],
  )
  const distances = layout.islands.map(fromPole)
  assert.deepEqual(
    distances,
    distances.toSorted((a, b) => a - b),
  )
})

test('one project is one island, and no project is an empty globe', () => {
  assert.equal(worldLayout([zone('alone')]).islands.length, 1)
  assert.deepEqual(worldLayout([]), { islands: [], agents: [] })
})

test('from one project to forty, every island is whole on the globe and none touches another', () => {
  for (const count of [1, 2, 3, 5, 8, 13, 24, 40]) {
    const { islands } = worldLayout(projects(count))

    assert.equal(islands.length, count)
    for (const island of islands) {
      assert.ok(fromPole(island) + island.radius <= GLOBE / 2, `${island.slug} of ${count} leaves the globe`)

      const others = islands.filter((other) => other !== island)
      for (const other of others) {
        assert.ok(apart(island, other) >= island.radius + other.radius, `${island.slug} touches ${other.slug} among ${count}`)
      }

      const isletCoasts = island.islets.flatMap((islet) => islet.coast.map((point) => ({ x: islet.x + point.x, y: islet.y + point.y })))
      for (const point of [...island.coast, ...isletCoasts]) {
        assert.ok(Math.hypot(point.x, point.y) <= 1 + 1e-9, `${island.slug} outgrows its own radius`)
      }
    }
  }
})

test('an island is drawn from its slug: capes and bays, unlike its neighbour', () => {
  const [alpha, beta] = worldLayout([zone('alpha', 'P0'), zone('beta', 'P1')]).islands as [Island, Island]

  for (const island of [alpha, beta]) {
    const nearest = Math.min(...coastReach(island))
    const farthest = Math.max(...coastReach(island))
    assert.ok(nearest < 0.72 * farthest, `${island.slug} is a circle`)
  }
  assert.notDeepEqual(alpha.coast, beta.coast)
})

test('an island keeps its shape wherever it sits, and is smaller on a fuller globe', () => {
  const alone = worldLayout([zone('alpha', 'P0'), zone('beta', 'P1')]).islands.find((island) => island.slug === 'alpha')!

  const crowded = worldLayout([...projects(9), zone('alpha', 'P3')]).islands.find((island) => island.slug === 'alpha')!

  assert.deepEqual(crowded.coast, alone.coast)
  assert.deepEqual(crowded.islets, alone.islets)
  assert.ok(crowded.radius < alone.radius)
})

test('a project added after the others leaves their bearings from the pole alone', () => {
  const before = worldLayout(projects(5))

  const after = worldLayout([...projects(5), zone('zz-new', 'P3')])

  assert.equal(after.islands.at(-1)!.slug, 'zz-new')
  before.islands.forEach((island, index) => {
    const same = after.islands[index]!
    assert.equal(same.slug, island.slug)
    assert.ok(Math.abs(bearing(same) - bearing(island)) < 1e-9)
  })
})

test('the island with the most work landed and under way has the strongest colour, and one with none has none', () => {
  const quiet = zone('quiet')
  const busy = zone('busy', 'P2', ['one', 'two'], { merged: 12, prs: 1 })
  const some = zone('some', 'P2', [], { merged: 3, branches: 1 })

  const { islands } = worldLayout([quiet, busy, some])

  const island = (slug: string) => islands.find((candidate) => candidate.slug === slug)!
  assert.equal(island('busy').heat, 1)
  assert.ok(island('some').heat > 0 && island('some').heat < 1)
  assert.equal(island('quiet').heat, 0)
  assert.deepEqual([island('busy').merged, island('busy').workers], [12, 2])
  assert.deepEqual([island('quiet').merged, island('quiet').workers], [0, 0])
})

test('the busiest island is larger than it would be idle', () => {
  const busy = worldLayout([zone('quiet'), zone('busy', 'P2', ['one'], { merged: 12 }), zone('some')]).islands.find((island) => island.slug === 'busy')!

  const idle = worldLayout([zone('quiet'), zone('busy'), zone('some')]).islands.find((island) => island.slug === 'busy')!

  assert.ok(busy.radius > idle.radius)
})

test('with nothing landed or under way no island has colour, and one agent at work is enough for all of it', () => {
  const idle = worldLayout([zone('a'), zone('b')])
  assert.ok(idle.islands.every((island) => island.heat === 0))

  const working = worldLayout([zone('a', 'P2', ['one']), zone('b')])
  assert.equal(working.islands[0]!.heat, 1)
})

test('land rises as work merges', () => {
  const tiers = (merged?: number) => worldLayout([zone('a', 'P2', [], { merged })]).islands[0]!.tiers

  assert.deepEqual([undefined, 0, 1, 4, 5, 19, 20, 400].map(tiers), [0, 0, 1, 1, 2, 2, 3, 3])
})

test("workers stand on their own island and apart, however many of hobkin's eight are there", () => {
  for (const slug of ['alpha', 'pi-coder', 'storefront', 'x', 'a-very-long-project-name']) {
    for (let count = 1; count <= 8; count++) {
      const ids = Array.from({ length: count }, (_, index) => `run:${index}`)
      const activity = Object.fromEntries(ids.map((id, index) => [id, [toolCall(`call-${index}`)]]))
      // The first island lists an agent twice, and the second lists one of the first's.
      const first = zone(slug, 'P0', [...ids, ids[0]!])
      const second = zone('other', 'P1', ['elsewhere', ids[1] ?? 'elsewhere'])

      const layout = worldLayout([first, second, zone('third')], activity)

      assert.equal(layout.agents.length, count + 1, 'one place for each exact id, on the first island that has it')
      for (const place of layout.agents) {
        const island = layout.islands.find((candidate) => candidate.slug === place.slug)!
        assert.ok(onLand(place, island), `${place.id} stands in the sea off ${slug} with ${count}`)

        const others = layout.agents.filter((other) => other.id !== place.id)
        for (const other of others) {
          assert.ok(apart(place, other) >= (place.size + other.size) / 2, `${place.id} overlaps ${other.id} on ${slug} with ${count}`)
        }
      }
    }
  }
})

test('a crowd no real home has still gets a place each, on its island', () => {
  const crowd = Array.from({ length: 43 }, (_, index) => `run:${index}`)

  const layout = worldLayout([zone('a', 'P0', crowd), zone('b', 'P1', ['other'])])

  assert.equal(layout.agents.length, 44)
  const island = layout.islands[0]!
  const onTheFirst = layout.agents.filter((agent) => agent.slug === 'a')
  for (const place of onTheFirst) assert.ok(onLand(place, island))
})

test('activity evidence uses actual entry identity/state, not text streaming or fallback doing', () => {
  assert.equal(activityObservation(undefined), null)
  assert.equal(activityObservation([]), null)

  const call = toolCall('call')
  assert.equal(activityObservation([call]), activityObservation([{ ...call, output: 'more' }]))
  assert.notEqual(activityObservation([call]), activityObservation([toolCall('call', 'completed')]))

  const words = { id: 'words', kind: 'assistant' as const, text: 'a' }
  assert.equal(activityObservation([words]), activityObservation([{ ...words, text: 'ab' }]))
})

test('activity that only streams words says the same to the globe, so it does not draw it again', () => {
  const words = { id: 'words', kind: 'assistant' as const, text: 'a' }
  const held = { one: [toolCall('call')], two: [words] }
  assert.equal(sameObservations(held, { one: [{ ...toolCall('call'), output: 'more' }], two: [{ ...words, text: 'ab' }] }), true)
  assert.equal(sameObservations(undefined, undefined), true)
  assert.equal(sameObservations(held, { ...held, one: [toolCall('call', 'completed')] }), false, 'a call that ended')
  assert.equal(sameObservations(held, { ...held, two: [words, toolCall('next')] }), false, 'a new step')
  assert.equal(sameObservations(held, { one: held.one }), false, 'a job gone')
  assert.equal(sameObservations(held, { ...held, three: [] }), false, 'a job new')
})

test('only observed live assignment/activity changes travel; new arrivals and incidental layout snap', () => {
  const before = sceneFrame(null, world(), { one: [toolCall('call')] }, false)
  assert.deepEqual(before.travel, [], 'a first sight is no move')

  const unchanged = sceneFrame(before, world(), { one: [toolCall('call')] }, false)
  assert.deepEqual(unchanged.travel, [])

  const active = sceneFrame(before, world(), { one: [toolCall('next')] }, false)
  assert.deepEqual(active.travel, ['one'])
  assert.ok(apart(active.layout.agents[0]!, before.layout.agents[0]!) > 0, 'new activity is a step across the island')

  const reassigned = sceneFrame(before, world([zone('alpha', 'P1'), zone('beta', 'P2', ['one', 'new'])]), {}, false)
  assert.deepEqual(reassigned.travel, ['one'], 'the newcomer snaps into place')
  assert.equal(reassigned.layout.agents.find((agent) => agent.id === 'one')!.slug, 'beta')

  const reprioritised = sceneFrame(before, world([zone('alpha', 'P0', ['one']), zone('beta')]), {}, false)
  assert.deepEqual(reprioritised.travel, [])

  const ended = sceneFrame(before, world([zone('alpha')]), {}, false)
  assert.equal(ended.layout.agents.length, 0)
})

test('missing activity is unknown, not a new location observation', () => {
  const before = sceneFrame(null, world(), { one: [toolCall('call')] }, false)

  const silent = sceneFrame(before, world(), {}, false)
  assert.deepEqual(silent.layout.agents, before.layout.agents)
  assert.deepEqual(silent.travel, [])

  const heardAgain = sceneFrame(silent, world(), { one: [toolCall('call')] }, false)
  assert.deepEqual(heardAgain.travel, [])
})

test('offline freezes the last placement; reconnect, changed source and Still snap', () => {
  const before = sceneFrame(null, world(), {}, false)
  const moved = world([zone('beta', 'P0', ['one'])])

  for (const still of [false, true]) {
    const offline = sceneFrame(before, { ...moved, fresh: false }, {}, still)
    assert.deepEqual(offline.layout, before.layout)
    assert.deepEqual(offline.travel, [])

    const reconnected = sceneFrame(offline, moved, {}, still)
    assert.deepEqual(reconnected.travel, [])
  }

  const otherSource = sceneFrame(before, { ...moved, sourceIdentity: 'home:2' }, {}, false)
  assert.deepEqual(otherSource.travel, [])
  assert.equal(otherSource.layout.agents[0]!.slug, 'beta')

  const heldStill = sceneFrame(before, moved, {}, true)
  assert.deepEqual(heldStill.travel, [])
})

test('a merge seen while watching is told once; first sight, stale frames, new sources and Still tell none', () => {
  const alphaWith = (merged: number, fresh = true, source = 'home:1') => world([zone('alpha', 'P1', [], { merged }), zone('beta')], fresh, source)
  const before = sceneFrame(null, alphaWith(2), {}, false)
  assert.deepEqual(before.landed, [], 'a first sight is no merge')

  const after = sceneFrame(before, alphaWith(3), {}, false)
  assert.deepEqual(after.landed, ['alpha'])
  assert.deepEqual(sceneFrame(after, alphaWith(3), {}, false).landed, [], 'told once')

  assert.deepEqual(sceneFrame(before, alphaWith(1), {}, false).landed, [], 'a count that falls is no merge')
  assert.deepEqual(sceneFrame(before, alphaWith(3), {}, true).landed, [], 'held still')
  assert.deepEqual(sceneFrame(before, alphaWith(3, true, 'home:2'), {}, false).landed, [], 'another source')

  const offline = sceneFrame(before, alphaWith(3, false), {}, false)
  assert.deepEqual(offline.landed, [])
  assert.deepEqual(sceneFrame(offline, alphaWith(3), {}, false).landed, [], 'nobody saw when it merged')
})
