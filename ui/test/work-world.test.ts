import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunSummary } from '#shared/protocol/snapshot.ts'
import { sampleWork } from '../src/features/work/sample.ts'
import { worldFrom, changedWorldAgents, visitWorldAgent, visitWorldProject } from '../src/features/work/world.ts'

const base = sampleWork().projects[0]!
const project = (slug: string, priority = base.priority, state = base.state) => ({ ...base, slug, name: 'Same name', priority, state })
const work = { ...sampleWork(), projects: [project('alpha', 'P2', 'chosen'), project('beta', 'P0', 'chosen'), project('gamma', 'P2', 'chosen')] }
const run = (id: string, slug?: string): RunSummary => ({ id, title: id, state: 'running', ...(slug ? { work: { slug } } : { cwd: '/projects/alpha' }) })
const input = { work, runs: [run('one', 'alpha')], agents: [{ id: 'one', doing: 'reading' }], connection: 'live' as const, sourceIdentity: 'home:1' }

test('eligibility uses current distinct taken slugs and priority ties keep host order', () => {
  assert.deepEqual(worldFrom(input).zones.map(z => z.project.slug), ['beta', 'alpha', 'gamma'])
  assert.equal(worldFrom({ ...input, work: { ...work, projects: [project('alpha'), project('alpha'), project('beta')] } }).visible, false)
  assert.equal(worldFrom({ ...input, work: { ...work, projects: work.projects.slice(0, 2) } }).visible, false)
  assert.equal(worldFrom(input).visible, true)
})

test('only taken projects count toward the world, regardless of priority, picks or activity', () => {
  const states = ['proposed', 'skipped', 'dropped', 'unknown', undefined]
  const unapproved = Array.from({ length: 55 }, (_, i) => ({ ...project(`unapproved-${i}`, 'P0'), state: states[i % states.length] as typeof base.state }))
  const candidate = worldFrom({ ...input, runs: [...input.runs, run('unapproved-agent', 'unapproved-0')], work: { ...work, autoPick: true,
    projects: [...work.projects.slice(0, 2), ...unapproved],
    queue: work.queue.map(row => ({ ...row, slug: 'unapproved-0', picked: true })),
    finished: work.finished.map(group => ({ ...group, changes: group.changes.map(change => ({ ...change, slug: 'unapproved-0' })) })),
  } })
  assert.deepEqual(candidate.zones.map(zone => zone.project.slug), ['beta', 'alpha'])
  assert.equal(candidate.visible, false)
  assert.deepEqual(candidate.zones.flatMap(zone => zone.agents.map(agent => agent.id)), ['one'])
  assert.deepEqual(candidate.zones.flatMap(zone => zone.queue), [])
  assert.deepEqual(candidate.zones.flatMap(zone => zone.finished), [])
  assert.equal(visitWorldProject(candidate, 'unapproved-0', () => assert.fail('Unapproved project navigation')), false)
  assert.equal(visitWorldAgent(candidate, 'unapproved-agent', { open: () => assert.fail('Unapproved agent navigation'), focus: () => {} }), false)
})

test('taking and dropping a project change eligibility; pause does not revoke taken status', () => {
  for (const state of ['proposed', 'chosen', 'skipped', 'proposed', 'chosen', 'dropped'] as const) {
    const candidate = worldFrom({ ...input, work: { ...work, projects: [...work.projects.slice(0, 2), { ...project('gamma', 'P2', state), paused: true }] } })
    assert.deepEqual(candidate.zones.map(zone => zone.project.slug), state === 'chosen' ? ['beta', 'alpha', 'gamma'] : ['beta', 'alpha'])
    assert.equal(candidate.visible, state === 'chosen')
  }
})

test('assignment is exact raw work.slug, never name, cwd, main, terminal or missing id', () => {
  const runs = [run('one', 'alpha'), run('cwd'), run('name', 'Same name'), { ...run('main', 'alpha'), kind: 'main' as const }, { ...run('ended', 'alpha'), state: 'reported' }, { title: 'missing', state: 'running', work: { slug: 'alpha' } }]
  const world = worldFrom({ ...input, runs })
  assert.deepEqual(world.zones.find(z => z.project.slug === 'alpha')!.agents.map(a => a.id), ['one'])
  assert.deepEqual(world.zones.find(z => z.project.slug === 'beta')!.agents, [])
})

test('backend facts stay independent; zero counts never become an assessment', () => {
  const p = { ...project('alpha', 'P1', 'chosen'), paused: true, open: 0, prs: 0, branches: 0, left: 0, unmerged: 0, lookError: 'permission denied' }
  const world = worldFrom({ ...input, work: { ...work, projects: [p, ...work.projects.slice(1)] } })
  const zone = world.zones.find(z => z.project.slug === 'alpha')!
  assert.equal(zone.project, p)
  assert.deepEqual(zone.facts, ['chosen', 'paused', '0 open items', '0 PRs', '0 branches', '0 waiting for you', '0 unmerged', 'Last look failed: permission denied', 'Assessment unknown'])
  assert.deepEqual(zone.queue, work.queue.filter(r => r.slug === 'alpha'))
  assert.deepEqual(zone.finished, work.finished.flatMap(g => g.changes).filter(c => c.slug === 'alpha'))
})

test('only observed assignment/activity changes animate; stale, Still and new sources reset', () => {
  const before = worldFrom(input)
  const changed = worldFrom({ ...input, runs: [run('one', 'gamma')] })
  assert.equal(changed.zones.find(zone => zone.project.slug === 'alpha')!.agents.length, 0)
  assert.equal(changed.zones.find(zone => zone.project.slug === 'gamma')!.agents[0]!.id, 'one')
  assert.deepEqual(changedWorldAgents(before, changed, false), ['one'])
  assert.deepEqual(changedWorldAgents(before, worldFrom({ ...input, agents: [{ id: 'one', doing: 'testing' }] }), false), ['one'])
  assert.deepEqual(changedWorldAgents(before, before, false), [])
  assert.deepEqual(changedWorldAgents(before, changed, true), [])
  for (const connection of ['offline', 'connecting', 'sample'] as const) {
    const stale = worldFrom({ ...input, connection })
    assert.equal(stale.fresh, false)
    assert.equal(stale.zones[1]!.agents[0]!.id, 'one')
    assert.deepEqual(changedWorldAgents(before, stale, false), [])
    assert.deepEqual(changedWorldAgents(stale, changed, false), [])
  }
  assert.deepEqual(changedWorldAgents(before, { ...changed, sourceIdentity: 'home:2' }, false), [])
  assert.deepEqual(changedWorldAgents(null, before, false), [])
  assert.deepEqual(changedWorldAgents(before, worldFrom({ ...input, runs: [] }), false), [])
  assert.deepEqual(changedWorldAgents(before, worldFrom({ ...input, runs: [...input.runs, run('new', 'alpha')] }), false), ['new'])
})

test('navigation validates current exact identities and reuses canvas/focus in order', () => {
  const calls: string[] = []
  const world = worldFrom(input)
  const nav = { open: (id: string) => calls.push(`open:${id}`), focus: () => calls.push('focus') }
  assert.equal(visitWorldAgent(world, 'one', nav), true)
  assert.equal(visitWorldAgent(world, 'Same name', nav), false)
  assert.deepEqual(calls, ['open:one', 'focus'])
  const visit = (slug: string, discover: boolean) => calls.push(`${slug}:${discover}`)
  assert.equal(visitWorldProject(world, 'alpha', visit), true)
  assert.equal(visitWorldProject(world, 'beta', visit), true)
  assert.equal(visitWorldProject(world, 'Same name', visit), false)
  assert.deepEqual(calls.slice(2), ['alpha:false', 'beta:false'])
})
