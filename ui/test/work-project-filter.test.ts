import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FinishedChange, FinishedGroup, QueueRow, WorkProject } from '#shared/protocol/work.ts'
import { chipsOf, filterPage, resolveChoice, type FilterPage } from '../src/features/work/project-filter.ts'

const project = (slug: string, name = slug): WorkProject => ({ slug, name }) as WorkProject
const change = (slug: string, item: string, stackId?: string): FinishedChange =>
  ({ key: `${slug}:${item}`, slug, project: slug, item, ...(stackId ? { stack: { id: stackId } } : {}) }) as FinishedChange
const group = (name: string, changes: FinishedChange[]): FinishedGroup => ({ name, heading: name, why: null, action: null, changes }) as FinishedGroup
const row = (slug: string | null, key: string): QueueRow => ({ key, slug, skipped: false }) as QueueRow
const agent = (project: string, id: string) => ({ id, project })

const projects = [project('shop', 'Shop'), project('api', 'API'), project('docs', 'Docs'), project('idle', 'Idle')]
const page: FilterPage<ReturnType<typeof agent>> = {
  finished: [group('needs', [change('api', 'a1'), change('shop', 's1')]), group('merge', [change('shop', 's2'), change('shop', 's3')])],
  queue: [row('docs', 'q1'), row(null, 'q2'), row('api', 'q3')],
  agents: [agent('Docs', 'x1'), agent('elsewhere', 'x2')],
}

test('chips are the projects with something on the page, most finished changes first, then by name', () => {
  assert.deepEqual(chipsOf(page, projects), [
    { slug: 'shop', name: 'Shop', count: 3 },
    { slug: 'api', name: 'API', count: 1 },
    { slug: 'docs', name: 'Docs', count: 0 },
  ])
})

test('a project with changes that hobkin has not listed as a project still gets a chip, named as the change names it', () => {
  const chips = chipsOf({ ...page, finished: [group('merge', [change('ghost', 'g1')])], queue: [], agents: [] }, projects)
  assert.deepEqual(chips, [{ slug: 'ghost', name: 'ghost', count: 1 }])
})

test('an agent counts for the project that matches its name or slug, in any case', () => {
  const chips = chipsOf({ finished: [], queue: [], agents: [agent('SHOP', 'x')] }, projects)
  assert.deepEqual(chips, [{ slug: 'shop', name: 'Shop', count: 0 }])
})

test('no choice, or a project with no chip, resolves to All', () => {
  const chips = chipsOf(page, projects)
  assert.equal(resolveChoice(null, chips), null)
  assert.equal(resolveChoice('shop', chips), 'shop')
  assert.equal(resolveChoice('gone', chips), null)
})

test('All gives the page back as it is', () => {
  assert.equal(filterPage(page, projects, null), page)
})

test('a project keeps its own finished changes, queue rows and agents, and drops groups left empty', () => {
  const only = filterPage(page, projects, 'api')
  assert.deepEqual(only.finished.map((g) => [g.name, g.changes.map((c) => c.item)]), [['needs', ['a1']]])
  assert.deepEqual(only.queue.map((r) => r.key), ['q3'])
  assert.deepEqual(only.agents, [])
  const docs = filterPage(page, projects, 'docs')
  assert.deepEqual(docs.agents.map((a) => a.id), ['x1'])
  assert.deepEqual(docs.finished, [])
})

test('a group that loses nothing is the same object, so what draws it holds still', () => {
  const only = filterPage(page, projects, 'shop')
  assert.equal(only.finished[1], page.finished[1])
  assert.notEqual(only.finished[0], page.finished[0])
})

test('a stack stays whole: its layers all belong to one project', () => {
  const stacked: FilterPage<never> = { finished: [group('merge', [change('api', 'l1', 'st'), change('api', 'l2', 'st'), change('shop', 'o')])], queue: [], agents: [] }
  const only = filterPage(stacked, projects, 'api')
  assert.deepEqual(only.finished[0]!.changes.map((c) => c.item), ['l1', 'l2'])
})

test('an unknown project falls back to All', () => {
  assert.equal(filterPage(page, projects, 'gone'), page)
})
