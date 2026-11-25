import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { RunGuide, RunGuideRun } from '#shared/protocol/work.ts'
import { projectPage, type ProjectInput } from '../src/features/project/model.ts'
import { askForGuide, guideButton, guideRunLine, sourcesLine, type GuideRead } from '../src/features/project/run-guide.ts'
import { sampleRunGuide } from '../src/features/project/sample.ts'
import { sampleWork } from '../src/features/work/sample.ts'

const NOW = new Date(2026, 10, 24, 15, 30).getTime()
const DAY_MS = 24 * 3_600_000

const TEXT = ['## What you need', 'Node 22.', '## Set up once', '`pnpm install`', '## Database', '`pnpm db:migrate`', '## Run it', '`pnpm dev`'].join('\n')

const guide = (over: Partial<RunGuide> = {}): RunGuide => ({
  slug: 'storefront',
  text: TEXT,
  writtenAt: new Date(NOW - 4 * DAY_MS).toISOString(),
  commit: '3f1a9c2e8b7d6c5a4f3e2d1c0b9a8f7e6d5c4b3a',
  sources: ['README.md', 'bin/setup', '.env.example'],
  lastRun: null,
  pending: null,
  refused: null,
  ...over,
})
const run = (over: Partial<RunGuideRun> = {}): RunGuideRun => ({ at: new Date(NOW - 3 * DAY_MS).toISOString(), by: 'guide', item: null, worked: true, reached: null, note: null, ...over })
const read = (over: Partial<RunGuide> = {}): GuideRead => ({ state: 'read', guide: guide(over) })

test('the last-run line says how long ago it ran and that it worked', () => {
  assert.deepEqual(guideRunLine(read({ lastRun: run() }), NOW), { text: 'Last run 3 days ago: it worked', tone: 'ok' })
  assert.equal(guideRunLine(read({ lastRun: run({ at: new Date(NOW - 20 * 60_000).toISOString() }) }), NOW).text, 'Last run 20 minutes ago: it worked')
})

test('a run a week or more ago is said by its date, and a stopped run names the step after the last one that worked', () => {
  const stopped = run({ at: new Date(2026, 10, 15, 9).toISOString(), worked: false, reached: 'Set up once', note: 'pnpm db:create needs Postgres 16.' })
  assert.deepEqual(guideRunLine(read({ lastRun: stopped }), NOW), { text: 'Last run Nov 15: stopped at Database', tone: 'warn', title: 'pnpm db:create needs Postgres 16.' })
})

test('a stopped run whose step is not one of the guide\'s headings says what it got past, and one that got nowhere names the first', () => {
  const past = run({ worked: false, reached: 'pnpm db:migrate' })
  assert.equal(guideRunLine(read({ lastRun: past }), NOW).text, 'Last run 3 days ago: stopped after pnpm db:migrate')
  const nowhere = run({ worked: false, reached: null })
  assert.equal(guideRunLine(read({ lastRun: nowhere }), NOW).text, 'Last run 3 days ago: stopped at What you need')
  assert.equal(guideRunLine(read({ text: 'No headings here.', lastRun: nowhere }), NOW).text, 'Last run 3 days ago: it did not work')
})

test('a guide never run, one being read, one that could not be read and one hobkin refuses each say so in the same line', () => {
  assert.deepEqual(guideRunLine(read(), NOW), { text: 'Not run yet', tone: 'quiet' })
  assert.deepEqual(guideRunLine({ state: 'reading' }, NOW), { text: 'Reading the run guide…', tone: 'quiet' })
  assert.deepEqual(guideRunLine({ state: 'failed', error: 'This hobkin cannot keep run guides yet. Update hobkin.' }, NOW), { text: 'This hobkin cannot keep run guides yet. Update hobkin.', tone: 'bad' })
  assert.deepEqual(guideRunLine(read({ refused: 'A goal has no run guide.' }), NOW), { text: 'A goal has no run guide.', tone: 'quiet' })
})

test('the sources line names the files the guide was written from and its commit, or says there is no guide yet', () => {
  assert.equal(sourcesLine(read()), 'From README.md, bin/setup and .env.example, at 3f1a9c2')
  assert.equal(sourcesLine(read({ sources: ['README.md'], commit: null })), 'From README.md')
  assert.equal(sourcesLine(read({ sources: [] })), 'Its sources were not recorded, at 3f1a9c2')
  assert.match(sourcesLine(read({ text: null, sources: [], commit: null })), /^No run guide yet\./)
  assert.equal(sourcesLine({ state: 'reading' }), '')
})

test('the button writes a guide when there is none, checks one again, and says Queued or Writing while its look waits or runs', () => {
  assert.deepEqual(guideButton(read({ text: null, sources: [] }), false), { label: 'Write the run guide', disabled: false })
  assert.deepEqual(guideButton(read(), false), { label: 'Check it again', disabled: false })
  assert.deepEqual(guideButton(read({ pending: 'queued' }), false), { label: 'Queued', disabled: true })
  assert.deepEqual(guideButton(read({ text: null, pending: 'writing' }), false), { label: 'Writing', disabled: true })
})

test('the button waits while the guide is read or a press is on its way, and cannot be pressed for a project hobkin refuses', () => {
  assert.deepEqual(guideButton({ state: 'reading' }, false), { label: 'Write the run guide', disabled: true })
  assert.deepEqual(guideButton(read(), true), { label: 'Check it again', disabled: true })
  assert.deepEqual(guideButton(read({ text: null, refused: 'Not taken.' }), false), { label: 'Write the run guide', disabled: true })
  // A read that failed can still be pressed: hobkin's answer then says what stands in the way.
  assert.deepEqual(guideButton({ state: 'failed', error: 'Lost the host.' }, false), { label: 'Write the run guide', disabled: false })
})

test('a press passes hobkin\'s line on, and its refusal in its own words', async () => {
  assert.deepEqual(await askForGuide(async () => ({ message: 'A guide look waits at the front of the queue.' })), { tone: 'done', text: 'A guide look waits at the front of the queue.' })
  assert.deepEqual(
    await askForGuide(async () => {
      throw new Error('hobkin does not work on old-landing.')
    }),
    { tone: 'refused', text: 'hobkin does not work on old-landing.' },
  )
})

const input = (over: Partial<ProjectInput>): ProjectInput => ({ slug: 'storefront', work: sampleWork(NOW), yolo: null, metrics: null, metricsState: 'loading', reviews: null, live: false, now: NOW, ...over })

test('a code project\'s page has a Run guide section with what was read, and one not read yet is being read', () => {
  const page = projectPage(input({ runGuide: read() }))
  assert.equal(page.kind, 'taken')
  assert.deepEqual(page.kind === 'taken' && page.runGuide, read())
  const unread = projectPage(input({}))
  assert.deepEqual(unread.kind === 'taken' && unread.runGuide, { state: 'reading' })
})

test('a goal\'s page has no Run guide section', () => {
  const page = projectPage(input({ slug: 'marathon-plan', runGuide: read() }))
  assert.equal(page.kind, 'taken')
  assert.equal(page.kind === 'taken' && page.runGuide, null)
})

test('the sample has a guide that worked, one that stopped, a project with none and a goal hobkin refuses', () => {
  assert.equal(sampleRunGuide('storefront', NOW).lastRun?.worked, true)
  assert.equal(sampleRunGuide('billing-api', NOW).lastRun?.worked, false)
  assert.equal(sampleRunGuide('docs-site', NOW).text, null)
  assert.ok(sampleRunGuide('marathon-plan', NOW).refused)
})
