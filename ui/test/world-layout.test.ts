import assert from 'node:assert/strict'
import { test } from 'node:test'
import { worldLayout, sceneFrame, activityObservation } from '../src/features/work/world-layout.ts'

const zone = (slug: string, priority = 'P2', ids: string[] = []) => ({ project: { slug, priority }, agents: ids.map(id => ({ id })) })
const input = (zones = [zone('alpha', 'P1', ['one']), zone('beta')], fresh = true, sourceIdentity = 'home:1') => ({ zones, fresh, sourceIdentity })
const entry = (id: string, state: 'running' | 'completed' = 'running') => ({ id, kind: 'tool' as const, state, name: 'read' })

test('layout is deterministic, priority ordered with exact slug ties, including fewer than three and empty', () => {
  const zones = [zone('z'), zone('a'), zone('first', 'P0')]
  const layout = worldLayout(zones)
  assert.deepEqual(layout, worldLayout([...zones].reverse()))
  assert.deepEqual(layout.territories.map(t => t.slug), ['first', 'a', 'z'])
  assert.equal(worldLayout([zone('alone')]).territories.length, 1)
  assert.deepEqual(worldLayout([]).agents, [])
})

function inside(x: number, y: number, polygon: readonly { x: number; y: number }[]) {
  let hit = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

test('dense exact IDs occupy nonoverlapping hit boxes inside connected irregular territories', () => {
  const ids = Array.from({ length: 43 }, (_, i) => `run:${i}`)
  const layout = worldLayout([zone('a', 'P0', [...ids, ids[0]!]), zone('b', 'P1', ['other'])])
  assert.equal(layout.agents.length, 44)
  const [a, b] = layout.territories
  assert.deepEqual(a!.bottom, b!.top)
  for (const p of layout.agents) {
    const territory = layout.territories.find(t => t.slug === p.slug)!
    for (const dx of [0, 160]) for (const dy of [0, 72]) assert.ok(inside(p.x + dx, p.y + dy, territory.points))
    for (const q of layout.agents) if (p.id !== q.id) assert.ok(Math.abs(p.x - q.x) >= 160 || Math.abs(p.y - q.y) >= 72)
  }
  assert.ok(layout.height > worldLayout([zone('a')]).height)
})

test('activity evidence uses actual entry identity/state, not text streaming or fallback doing', () => {
  assert.equal(activityObservation(undefined), null)
  assert.equal(activityObservation([]), null)
  assert.equal(activityObservation([entry('call')]), activityObservation([{ ...entry('call'), output: 'more' }]))
  assert.equal(activityObservation([{ id: 'words', kind: 'assistant', text: 'a' }]), activityObservation([{ id: 'words', kind: 'assistant', text: 'ab' }]))
  assert.notEqual(activityObservation([entry('call')]), activityObservation([entry('call', 'completed')]))
})

test('only observed live assignment/activity changes travel; new arrivals and incidental layout snap', () => {
  const before = sceneFrame(null, input(), { one: [entry('call')] }, false)
  assert.deepEqual(before.travel, [])
  assert.deepEqual(sceneFrame(before, input(), { one: [entry('call')] }, false).travel, [])
  const active = sceneFrame(before, input(), { one: [entry('next')] }, false)
  assert.deepEqual(active.travel, ['one'])
  assert.notDeepEqual(active.layout.agents[0], before.layout.agents[0])
  const reassigned = sceneFrame(before, input([zone('alpha', 'P1'), zone('beta', 'P2', ['one', 'new'])]), {}, false)
  assert.deepEqual(reassigned.travel, ['one'])
  assert.equal(reassigned.layout.agents.find(a => a.id === 'one')!.slug, 'beta')
  assert.deepEqual(sceneFrame(before, input([zone('alpha', 'P0', ['one']), zone('beta')]), {}, false).travel, [])
  assert.equal(sceneFrame(before, input([zone('alpha')]), {}, false).layout.agents.length, 0)
})

test('missing activity is unknown, not a new location observation', () => {
  const before = sceneFrame(null, input(), { one: [entry('call')] }, false)
  const next = sceneFrame(before, input(), {}, false)
  assert.deepEqual(next.layout.agents, before.layout.agents)
  assert.deepEqual(next.travel, [])
  assert.deepEqual(sceneFrame(next, input(), { one: [entry('call')] }, false).travel, [])
})

test('offline freezes the last placement; reconnect, changed source and Still snap', () => {
  const before = sceneFrame(null, input(), {}, false)
  const moved = input([zone('beta', 'P0', ['one'])])
  for (const still of [false, true]) {
    const offline = sceneFrame(before, { ...moved, fresh: false }, {}, still)
    assert.deepEqual(offline.layout, before.layout)
    assert.deepEqual(offline.travel, [])
    assert.deepEqual(sceneFrame(offline, moved, {}, still).travel, [])
  }
  const reset = sceneFrame(before, { ...moved, sourceIdentity: 'home:2' }, {}, false)
  assert.deepEqual(reset.travel, [])
  assert.equal(reset.layout.agents[0]!.slug, 'beta')
  assert.deepEqual(sceneFrame(before, moved, {}, true).travel, [])
})
