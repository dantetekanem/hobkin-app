import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { assessmentFolder, Assessments } from '../src/review/assessment.ts'
import { temporaryDirectory } from './support.ts'

const target = { kind: 'change' as const, slug: 'rpsleague', item: 'f07742' }
const HEAD = 'e44106a3da8a0000000000000000000000000000'

/** A unit as an engine from before plain words wrote it: rpsleague f07742 at e44106a, as the user saw it. */
const OLD_UNIT = {
  id: 'u1',
  title: '`show` changes behaviour for everyone, and its tests could not run',
  level: 'high',
  critical: false,
  nodes: ['n1'],
  grouping: 'single',
  story_order: 1,
  where: 'Stop 1. Reached from ErrorsController#show (controller), ErrorsController#show.',
  what: '`show` in `app/controllers/errors_controller.rb` (lines 2 to 13) was changed, with 4 changed lines. Effect: behaviour (executable lines changed (from patterns)). It is reached from ErrorsController#show (controller), ErrorsController#show.',
  code: [],
  facts: {},
  why_level: ['Floor rule 3: no test that runs shows the changed lines work.', 'test/controllers/errors_controller_test.rb fails at head, before anything is changed.'],
  would_change: [],
  watch: 'not assessed',
  questions: [],
  reading_minutes: 2,
}

/** Its story, which held the careful pass's words and nothing else did. */
const STORY = [
  '# Return empty error responses for non-HTML requests',
  '',
  '## Opening',
  '',
  '**Does:** Changes `ErrorsController#show` to render HTML error pages and return status-only responses for other formats.',
  '',
  '## Needs you',
  '',
  '### 1. Only HTML requests receive an error page (high)',
  '',
  '**Where:** Stop 1. Reached from ErrorsController#show (controller), ErrorsController#show.',
  '',
  '**What changed:** `show` replaces unconditional rendering with `respond_to`. HTML keeps the error page; other formats get an empty response.',
  '',
  '```diff',
  '### 2. Not a unit (high)',
  '**What changed:** a line of the change itself',
  '```',
  '',
].join('\n')

function stored(t: TestContext, { storyBy = 'model', words }: { storyBy?: 'model' | 'host'; words?: object } = {}) {
  const root = temporaryDirectory(t)
  const folder = assessmentFolder(root, target, HEAD)
  mkdirSync(folder, { recursive: true })
  const write = (name: string, value: unknown) => writeFileSync(join(folder, name), typeof value === 'string' ? value : JSON.stringify(value))
  write('summary.json', { level: 'high', critical: false, needsYou: 1, worthALook: 0, safe: 0, storyBy, at: '2026-11-12T21:12:54.383Z' })
  write('units.json', { schema: 'review-units/1', map: 'node-level', attention: { units: 1, reading_minutes: 2 }, units: [OLD_UNIT] })
  write('story.md', STORY)
  if (words) write('story-words.json', words)
  return new Assessments({ root, run: async () => Promise.reject(new Error('unused')), repoOf: () => null })
}

test('the units the window gets carry the model’s words, read back from the story when a run kept them nowhere else', (t) => {
  const [unit] = stored(t).read(target, HEAD)!.units!.units
  assert.deepEqual([unit!.title, unit!.what], ['Only HTML requests receive an error page', '`show` replaces unconditional rendering with `respond_to`. HTML keeps the error page; other formats get an empty response.'])
  // And the engine's own words are plain, as it writes them now: no stop number, an entry point once, no rule name.
  assert.equal(unit!.where, 'Reached from ErrorsController#show.')
  assert.deepEqual(unit!.why_level, ['No test that runs shows the changed lines work.', 'test/controllers/errors_controller_test.rb fails at head, before anything is changed.'])
})

test('with no model words, an older unit’s long account of what changed is one short sentence', (t) => {
  const [unit] = stored(t, { storyBy: 'host' }).read(target, HEAD)!.units!.units
  assert.deepEqual([unit!.title, unit!.what], [OLD_UNIT.title, 'Changes 4 lines in `show`.'])
})

test('the words a run saved in story-words.json come first', (t) => {
  const assessments = stored(t, { words: { title: 'Error pages for HTML only', does: 'Other formats get only a status.', units: { u1: { title: 'Only HTML gets a page', what: 'JSON, XML and YAML get an empty response.' } } } })
  const [unit] = assessments.read(target, HEAD)!.units!.units
  assert.deepEqual([unit!.title, unit!.what], ['Only HTML gets a page', 'JSON, XML and YAML get an empty response.'])
})
