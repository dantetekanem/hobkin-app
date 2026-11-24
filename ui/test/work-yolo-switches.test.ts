import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { YoloChange, YoloProject, YoloState } from '#shared/protocol/work.ts'
import { SAMPLE_YOLO } from '../src/features/settings/yolo.ts'
import { GATES_COUNTS, gates, hasSwitch, isOn, offLine, projectOrder, pullsSay, sampleSwitch, switchesSay, trustTiles } from '../src/features/work/yolo-page.ts'

const change = (item: string, rate: number, why: string | null = null): YoloChange => ({ item, title: `Change ${item}`, kind: 'a bug fix', rate, why })
const project = (slug: string, on: boolean | undefined, change_: Partial<YoloProject> = {}): YoloProject => ({
  slug,
  name: slug,
  ...(on === undefined ? {} : { on }),
  ready: true,
  needs: [],
  ...change_,
})
const yolo = (projects: YoloProject[]): YoloState => ({ on: true, rate: 8, lowest: 6, highest: 10, ready: projects.length, projects })
const slugs = (projects: YoloProject[]) => projects.map(({ slug }) => slug)

test('projects that are on come first, then the ones that are off, each in the order hobkin gives, and the order the page opened with stays while it is open', () => {
  const projects = [project('api', false), project('web', true), project('docs', false), project('jobs', true)]
  assert.deepEqual(slugs(projectOrder(projects, null)), ['web', 'jobs', 'api', 'docs'])

  // The user turns web off and api on while the page is open: neither jumps, and a project new since takes the end of its group.
  const opened = slugs(projectOrder(projects, null))
  const now = [project('api', true), project('web', false), project('docs', false), project('jobs', true), project('lib', true)]
  assert.deepEqual(slugs(projectOrder(now, opened)), ['web', 'jobs', 'api', 'docs', 'lib'])
  assert.deepEqual(slugs(projectOrder(now, null)), ['api', 'jobs', 'lib', 'web', 'docs'], 'the next visit puts each in its group')
})

test('a project that is off is one quiet line, with its count of waiting changes when the page has it', () => {
  assert.equal(offLine(project('api', false, { changes: [change('a', 9), change('b', 7)] })), 'YOLO mode is off here: its 2 finished changes wait for you.')
  assert.equal(offLine(project('api', false, { changes: [change('a', 9)] })), 'YOLO mode is off here: its 1 finished change waits for you.')
  assert.equal(offLine(project('api', false, { changes: [] })), 'YOLO mode is off here: its changes wait for you.')
  assert.equal(offLine(project('api', false)), 'YOLO mode is off here: its changes wait for you.')
})

test('a hobkin that sends no switch has every project shown on, with no switch, and the page says how a switch starts only when there are switches', () => {
  const older = project('api', undefined)
  assert.deepEqual([hasSwitch(older), isOn(older)], [false, true])
  assert.deepEqual([hasSwitch(project('api', false)), isOn(project('api', false))], [true, false])
  assert.equal(switchesSay(yolo([older])), null)
  assert.equal(switchesSay(yolo([project('api', true)])), 'Each project has its own switch. A project you had when the switches came stays on until you turn it off, and one taken on Work later starts off.')
})

test('where hobkin takes pull requests, the page says two can merge on back-to-back passes on checks from before the first landed', () => {
  assert.equal(pullsSay(yolo([project('api', true)])), null, 'a hobkin that takes none says nothing of them')
  assert.equal(
    pullsSay({ ...yolo([project('api', true)]), pullRequests: true }),
    'A pull request merges one a pass on each project. The next one can merge on the pass after, on checks that ran before the first landed, unless its repository requires branches to be up to date before merging.',
  )
})

test('the gates count only the projects YOLO mode is on for and say so, and the 30-day numbers are for every project and say so', () => {
  const counted = gates(yolo([project('api', true, { changes: [change('a', 9), change('b', 7, 'its general rate is 7, under 8')] }), project('web', false, { changes: [change('c', 9)] })]), { waits: null, paused: new Set() })
  assert.deepEqual(counted.steps.map(({ count }) => count), [2, 1, 1])
  assert.deepEqual(counted.holds, [{ reason: 'its general rate is under 8.', count: 1 }])
  assert.match(GATES_COUNTS(8), /on the projects YOLO mode is on for/)
  for (const tile of trustTiles(null)) assert.match(tile.counts, /on every project/)

  // A hobkin that sends no switch counts every project, as before.
  assert.equal(gates(yolo([project('api', undefined, { changes: [change('a', 9)] })]), { waits: null, paused: new Set() }).steps[0]!.count, 1)
})

test('with no host, a project switch changes the sample alone, and the sample has a project that is off', () => {
  const after = sampleSwitch(SAMPLE_YOLO, 'storefront', false)
  assert.deepEqual(after.projects.map(({ slug, on }) => [slug, on]), SAMPLE_YOLO.projects.map(({ slug, on }) => [slug, slug === 'storefront' ? false : on]))
  assert.ok(SAMPLE_YOLO.projects.some(({ on }) => on === false))
  assert.equal(after.on, SAMPLE_YOLO.on)
})
