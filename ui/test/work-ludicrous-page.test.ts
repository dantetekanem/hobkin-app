import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LudicrousArea, LudicrousRun, LudicrousState } from '#shared/protocol/ludicrous.ts'
import type { WorkProject } from '#shared/protocol/work.ts'
import { readViews, stillMotion } from './view-draws.ts'

readViews({ 'motion/react': { motion: stillMotion, AnimatePresence: ({ children }: { children?: unknown }) => children ?? null } })
const { LudicrousMap, LudicrousPage } = await import('../src/features/work/LudicrousScreen.tsx')
const { controlsOf, NOBODY_ELSE, tierWords } = await import('../src/features/work/ludicrous-page.ts')
const { SAMPLE_LUDICROUS } = await import('../src/features/work/ludicrous-sample.ts')

const MACHINE = SAMPLE_LUDICROUS.machine
const harbor = { slug: 'harbor', name: 'harbor', state: 'chosen', paused: false, kind: 'code' } as unknown as WorkProject
const opening: LudicrousState = { run: null, machine: MACHINE }
const DIRTY = 'This folder has uncommitted changes. Ludicrous works in it on its own branch, so commit them or put them away first.'
// React writes an apostrophe in text as &#x27;.
const shown = (markup: string, words: string) => markup.replaceAll('&#x27;', "'").replaceAll('&quot;', '"').includes(words)

test('an existing project says nobody else should work on it, and a folder with changes keeps Let\'s plan this disabled with the reason', () => {
  const page = (folder: { clean: boolean; reason: string | null }) =>
    renderToStaticMarkup(createElement(LudicrousPage, { state: opening, projects: [harbor], live: false, start: { slug: 'harbor', idea: 'A harbor master for every dock.', folder } }))

  const dirty = page({ clean: false, reason: DIRTY })
  assert.ok(shown(dirty, NOBODY_ELSE), 'the page says nobody else should work on the project, and why')
  assert.match(dirty, /<button[^>]*\sdisabled=""[^>]*>Let(&#x27;|')s plan this<\/button>/)
  assert.ok(shown(dirty, DIRTY))

  const clean = page({ clean: true, reason: null })
  assert.match(clean, /<button(?![^>]*\sdisabled="")[^>]*>Let(&#x27;|')s plan this<\/button>/)
  assert.ok(!shown(clean, DIRTY))

  // No project picked: nothing to warn about yet, and the button says what it waits for.
  const none = renderToStaticMarkup(createElement(LudicrousPage, { state: opening, projects: [harbor], live: false, start: { idea: 'Anything.' } }))
  assert.ok(!shown(none, NOBODY_ELSE))
  assert.equal(controlsOf({ state: opening, slug: null, idea: 'Anything.', folder: null }).main.reason, 'Pick a project first.')
})

const area = (id: string, change: Partial<LudicrousArea> = {}): LudicrousArea => ({
  id, name: id.toUpperCase(), depends: id === 'foundation' ? [] : ['foundation'], open: true, done: false, steps: { done: 0, total: 4 }, agents: 0, leader: false, ...change,
})

test('the map shows each area\'s agents, leader and steps, and never what an agent is doing', () => {
  const areas = [
    area('foundation', { agents: 2, leader: true, steps: { done: 3, total: 4 } }),
    area('api', { agents: 7, leader: true, steps: { done: 1, total: 9 } }),
    area('web', { depends: ['api'], open: false }),
    area('docs', { done: true, steps: { done: 4, total: 4 } }),
  ]
  const markup = renderToStaticMarkup(createElement(LudicrousMap, { areas, name: 'harbor' }))
  for (const line of ['2 agents · leader on it · 3 of 4 steps', '7 agents · leader on it · 1 of 9 steps', 'waits for api', 'done · 4 of 4 steps']) assert.ok(shown(markup, line), line)
  assert.ok(shown(markup, '4 areas · 1 done · 9 agents on them'))
  // Every island is drawn, and nothing names an agent, a packet or a path one works on.
  assert.equal(markup.match(/class="world-island /g)?.length, 4)
  assert.doesNotMatch(markup, /packet|session|\.ts\b|prompt/i)

  // A run that builds shows the map with its numbers; before a run the page has neither.
  const building = renderToStaticMarkup(createElement(LudicrousPage, { state: { run: { ...(SAMPLE_LUDICROUS.run as LudicrousRun), areas }, machine: MACHINE }, projects: [], live: false }))
  assert.ok(shown(building, 'Running now'))
  assert.match(building, /class="world-island /)
  assert.doesNotMatch(renderToStaticMarkup(createElement(LudicrousPage, { state: opening, projects: [harbor], live: false })), /world-island|Running now/)
})

test('a tier above the measure says what it risks', () => {
  const [thirty, , hundred] = MACHINE.tiers
  assert.equal(tierWords(thirty!, MACHINE.picked).risk, null)
  assert.match(tierWords(hundred!, MACHINE.picked).risk ?? '', /^More than this computer measures/)
  assert.equal(tierWords(MACHINE.tiers[1]!, MACHINE.picked).pick, true)

  const page = (tier: 30 | 50 | 100) => renderToStaticMarkup(createElement(LudicrousPage, { state: opening, projects: [harbor], live: false, start: { slug: 'harbor', tier } }))
  assert.ok(shown(page(100), hundred!.risk!))
  assert.ok(!shown(page(50), 'More than this computer measures'))
  // The machine tier is named once, as hobkin's pick, and not again as a number of agents anywhere else on the opening.
  assert.equal(page(50).match(/hobkin(&#x27;|')s pick/g)?.length, 1)
})
