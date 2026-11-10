import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MOST_PER_KIND, searchSpotlight, type SpotlightEntry, type SpotlightGroup } from '../src/app/spotlight-search.ts'

const screen = (id: string, title: string, keywords: string[] = []): SpotlightEntry => ({ id: `screen:${id}`, kind: 'screen', title, keywords })

const ENTRIES: SpotlightEntry[] = [
  screen('reports', 'Reports', ['runs']),
  screen('routines', 'Routines', ['schedule']),
  screen('actions', 'Action Items', ['decisions']),
  screen('work', 'Work', ['projects', 'queue']),
  screen('github', 'GitHub', ['pull requests', 'issues']),
  { id: 'setting:movement', kind: 'setting', title: 'Movement', keywords: ['motion', 'animation'] },
  { id: 'agent:a1', kind: 'agent', title: 'Fix the login redirect loop', detail: 'storefront · running the auth tests' },
  { id: 'report:r2', kind: 'report', title: 'Morning recap', detail: 'hobkin · 2 hours ago' },
  { id: 'report:r1', kind: 'report', title: 'Repository audit', detail: 'Dependency sweep' },
  { id: 'routine:morning', kind: 'routine', title: 'Morning recap', detail: 'Every day at 08:00' },
  { id: 'pull:128', kind: 'pull', title: 'Fix rounding in invoice export', detail: 'acme/billing-api#128' },
  { id: 'issue:7', kind: 'issue', title: 'Café menu crashes on résumé upload', detail: 'acme/storefront#7' },
]

const ids = (groups: SpotlightGroup<SpotlightEntry>[]) => groups.flatMap((group) => group.entries.map((entry) => entry.id))

test('with no text it offers the screens and the agents working now, in their own order', () => {
  const expected = ['screen:reports', 'screen:routines', 'screen:actions', 'screen:work', 'screen:github', 'agent:a1']
  assert.deepEqual(ids(searchSpotlight(ENTRIES, '')), expected)
  assert.deepEqual(ids(searchSpotlight(ENTRIES, '   ')), expected, 'spaces are no text')
})

test('every word has to match, in the title, the second line or the hidden words', () => {
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'login storefront')), ['agent:a1'], 'one word in the title, one in the second line')
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'pull requests')), ['screen:github'], 'hidden words')
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'login billing')), [], 'a word that matches nothing leaves the entry out')
  assert.deepEqual(searchSpotlight(ENTRIES, 'zzz'), [], 'nothing matching gives no groups')
})

test('the start of the title counts most, then the start of a word, then anywhere in it', () => {
  const reports = searchSpotlight(ENTRIES, 're').find((group) => group.kind === 'report')
  assert.deepEqual(
    reports?.entries.map((entry) => entry.id),
    ['report:r1', 'report:r2'],
    '"Repository audit" starts with it, "Morning recap" only has a word that does',
  )
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'gthb')), ['screen:github'], 'letters in order find a short title')
})

test('case and accents do not matter', () => {
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'CAFE')), ['issue:7'])
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'resume')), ['issue:7'])
  assert.deepEqual(ids(searchSpotlight(ENTRIES, 'Rés')), ids(searchSpotlight(ENTRIES, 'res')))
})

test('a hidden word or the initials find an entry by another name', () => {
  assert.equal(ids(searchSpotlight(ENTRIES, 'motion'))[0], 'setting:movement')
  assert.equal(ids(searchSpotlight(ENTRIES, 'ai'))[0], 'screen:actions', 'Action Items')
  assert.equal(ids(searchSpotlight(ENTRIES, '#128'))[0], 'pull:128', 'a pull request by its number')
})

test('a screen comes before anything else that matches as well', () => {
  const groups = searchSpotlight([{ id: 'report:x', kind: 'report', title: 'Reports' }, screen('reports', 'Reports')], 'reports')
  assert.deepEqual(ids(groups), ['screen:reports', 'report:x'])
})

test('groups come in the order of their best match, each holds a few, and says how many more there are', () => {
  const checks: SpotlightEntry[] = Array.from({ length: MOST_PER_KIND + 3 }, (_, index) => ({ id: `report:${index}`, kind: 'report', title: `Check ${index}` }))
  const groups = searchSpotlight([{ id: 'routine:weekly', kind: 'routine', title: 'Weekly check' }, ...checks], 'check')

  assert.deepEqual(
    groups.map((group) => group.kind),
    ['report', 'routine'],
    'the reports start with the word, the routine only has it',
  )
  assert.equal(groups[0]!.entries.length, MOST_PER_KIND)
  assert.equal(groups[0]!.hidden, 3)
  assert.equal(groups[1]!.hidden, 0)
})

test('entries that match as well keep the order they came in', () => {
  const groups = searchSpotlight(ENTRIES, 'morning')
  assert.deepEqual(ids(groups), ['report:r2', 'routine:morning'], 'kinds that tie keep the order of the kinds')

  const newestFirst: SpotlightEntry[] = [
    { id: 'report:new', kind: 'report', title: 'Morning recap' },
    { id: 'report:old', kind: 'report', title: 'Morning recap' },
  ]
  assert.deepEqual(ids(searchSpotlight(newestFirst, 'recap')), ['report:new', 'report:old'])
})
