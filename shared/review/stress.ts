/**
 * A made-up change of 80 nodes and 160 wires, for measuring the graph and the code panel under load.
 * It goes through the same passes as a real change, so it also shows the cases a small sample cannot:
 * a failed test, an unproven line, a deleted function, a binary file, and a 5,000 line file over the size limit.
 * Nothing here is random: the same call always builds the same review.
 */
import { captureChange, type Capture } from './capture.ts'
import { memoryReader, type Tree } from './memory.ts'
import type { ModelPassInput } from './model.ts'
import { completeReview, draftReview } from './prepare.ts'
import type { Review, ReviewFileContents } from './types.ts'

export const STRESS = { nodes: 80, wires: 160, bigFileLines: 5000, bigFile: 'src/generated/catalog.ts' } as const

const MODULES = ['trees', 'harvest', 'market', 'ledger'] as const
// The last verb names a function this change deletes. The three before it name functions it adds.
const VERBS = ['plan', 'check', 'load', 'save', 'score', 'merge', 'trim', 'rank', 'drop'] as const
// Which functions each one calls, by position. It is a tree three calls deep, so the code band has four columns.
const CALLS: Record<number, number[]> = { 0: [1, 2], 1: [3, 4], 2: [5, 6], 3: [7] }
const LIBS = ['soil', 'weather', 'prices', 'clock'] as const
const SPEC_PATH = '_specs/5e77a1-keep-the-orchard-books/spec.md'

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
const fn = (verb: string, module: string) => `${verb}${capital(module)}`
const libFns = (lib: string) => [`read${capital(lib)}`, `round${capital(lib)}`]

function moduleSource(module: string, side: 'base' | 'head'): string {
  const lib = LIBS[MODULES.indexOf(module as (typeof MODULES)[number])]!
  const lines = [`import { ${libFns(lib).join(', ')} } from '../lib/${lib}.ts'`, '']
  const body = (index: number) => {
    const name = fn(VERBS[index]!, module)
    const called = (side === 'head' ? (CALLS[index] ?? []) : (CALLS[index] ?? []).filter((target) => target < 5)).map((target) => `${fn(VERBS[target]!, module)}(amount)`)
    return [
      `/** ${capital(VERBS[index]!)}s the ${module} for one season. */`,
      `export function ${name}(amount: number): number {`,
      `  const season = ${libFns(lib)[index % 2]}(amount)`,
      // The one line that differs between the two sides of a modified function.
      side === 'head' ? `  const total = season * ${index + 2} + ${called.length > 0 ? called.join(' + ') : '1'}` : `  const total = season * ${index + 1} + ${called.length > 0 ? called.join(' + ') : '0'}`,
      "  if (total < 0) throw new Error('A season cannot go below zero.')",
      '  return total',
      '}',
      '',
    ]
  }
  // The deleted function sits first at base, away from the added ones, so the diff reads it as removed and not renamed.
  if (side === 'base') lines.push(...body(8))
  for (let index = 0; index < (side === 'head' ? 8 : 5); index += 1) lines.push(...body(index))
  return `${lines.join('\n').trimEnd()}\n`
}

const testName = (module: string, index: number) => `${VERBS[index]}s the ${module} for a season`

function testSource(module: string): string {
  const names = VERBS.slice(0, 5).map((verb) => fn(verb, module))
  const lines = ["import assert from 'node:assert/strict'", "import { test } from 'node:test'", `import { ${names.join(', ')} } from '../src/orchard/${module}.ts'`, '']
  names.forEach((name, index) => {
    lines.push(`test('${testName(module, index)}', () => {`, `  assert.equal(${name}(${index + 1}) >= 0, true)`, '})', '')
  })
  return `${lines.join('\n').trimEnd()}\n`
}

function libSource(lib: string): string {
  const [read, round] = libFns(lib)
  return [
    `/** Reads the ${lib} figure for a season. */`,
    `export function ${read}(amount: number): number {`,
    `  return amount * ${lib.length}`,
    '}',
    '',
    `/** Rounds a ${lib} figure to whole units. */`,
    `export function ${round}(amount: number): number {`,
    '  return Math.round(amount)',
    '}',
    '',
  ].join('\n')
}

/** A file of exactly `STRESS.bigFileLines` lines, all added, so it is over the limit of changed lines. */
function catalogSource(): string {
  const lines = [
    '/** Every variety the orchard grows, generated from the nursery list. */',
    'export interface CatalogEntry {',
    '  id: number',
    '  name: string',
    '  ready: boolean',
    '  weight: number',
    '}',
    '',
  ]
  const varieties = ['pippin', 'russet', 'bramley', 'gala', 'braeburn', 'jonagold', 'cox', 'fuji']
  for (let index = 1; lines.length < STRESS.bigFileLines; index += 1) {
    const name = `${varieties[index % varieties.length]}-${index}`
    lines.push(
      `/** Catalog entry ${index}: ${name}. */`,
      `export function entry${index}(season: number): CatalogEntry {`,
      `  const ripeness = (season * ${index}) % 9`,
      '  if (ripeness > 6) {',
      `    return { id: ${index}, name: '${name}', ready: true, weight: ripeness * 12 }`,
      '  }',
      `  return { id: ${index}, name: '${name}', ready: false, weight: 0 }`,
      '}',
    )
  }
  return `${lines.join('\n')}\n`
}

function specSource(): string {
  const acceptance = Array.from({ length: 10 }, (_, index) => {
    const module = MODULES[index % MODULES.length]!
    const verb = VERBS[Math.floor(index / MODULES.length)]!
    return `- A${index + 1}. The ${module} can be ${verb === 'plan' ? 'planned' : verb === 'check' ? 'checked' : 'loaded'} for a season, and a season below zero is refused.`
  })
  const proof = Array.from({ length: 8 }, (_, index) => {
    const module = MODULES[index % MODULES.length]!
    return `- A${index + 1}. \`test/${module}.test.ts\` › "${testName(module, Math.floor(index / MODULES.length))}"`
  })
  return `---
{ "id": "5e77a1-keep-the-orchard-books", "title": "Keep the orchard's books by season", "kind": "work", "status": "done", "depends": [], "updated": "2026-11-09" }
---
# Keep the orchard's books by season

## Outcome
The orchard's trees, harvest, market and ledger are each counted by season. This is made-up data for measuring Change Review under load.

## Out of scope
- Counting by week.
- More than one orchard.

## Acceptance
${acceptance.join('\n')}

## Proof
${proof.join('\n')}
- A9. check: load one season and compare the ledger with the market.

## Steps
- [x] S1 (A1, A2, A3, A4). Plan each part of the orchard.
- [x] S2 (A5, A6, A7, A8). Check each part.
- [x] S3 (A9, A10). Load a season.

## Open questions
- Should a season that is still open be counted?
`
}

function trees(): { base: Tree; head: Tree } {
  const base: Tree = { 'README.md': '# Orchard\n\nCounts trees.\n', 'CHANGELOG.md': '# Changes\n', 'config/settings.json': '{\n  "seasons": 4\n}\n', 'docs/guide.md': '# Guide\n\nRun the count once a year.\n' }
  const head: Tree = {
    'README.md': '# Orchard\n\nCounts trees, harvest, market and ledger by season.\n',
    'CHANGELOG.md': '# Changes\n\n- Keep the books by season.\n',
    'config/settings.json': '{\n  "seasons": 4,\n  "refuseBelowZero": true\n}\n',
    'docs/guide.md': '# Guide\n\nRun the count once a season.\n\nA season below zero is refused.\n',
    'assets/logo.png': new Uint8Array([137, 80, 78, 71]),
    [STRESS.bigFile]: catalogSource(),
  }
  for (const module of MODULES) {
    base[`src/orchard/${module}.ts`] = moduleSource(module, 'base')
    head[`src/orchard/${module}.ts`] = moduleSource(module, 'head')
    head[`test/${module}.test.ts`] = testSource(module)
  }
  for (const lib of LIBS) base[`src/lib/${lib}.ts`] = head[`src/lib/${lib}.ts`] = libSource(lib)
  return { base, head }
}

export interface StressSample {
  review: Review
  capture: Capture
  /** Both sides of every file the review points into. */
  files: ReviewFileContents[]
}

export async function buildStress(): Promise<StressSample> {
  const { base, head } = trees()
  const capture = await captureChange(memoryReader(base, head), 'base', 'head')
  const spec = specSource()
  const results: Record<string, 'passed' | 'failed'> = {}
  for (const module of MODULES) {
    for (let index = 0; index < 3; index += 1) results[`test/${module}.test.ts › ${testName(module, index)}`] = 'passed'
  }
  results[`test/market.test.ts › ${testName('market', 1)}`] = 'failed'

  const draft = await draftReview({
    id: 'stress',
    change: { project: 'orchard', item: '5e77a1', title: "Keep the orchard's books by season", branch: 'hobkin/5e77a1-keep-the-orchard-books', risk: 'Made-up data. Nothing here runs.' },
    capture,
    spec: { path: SPEC_PATH, text: spec },
    readHead: async (path) => (typeof head[path] === 'string' ? (head[path] as string) : null),
    results,
  })

  const of = (kind: string) => draft.nodes.filter((node) => node.kind === kind)
  const [criteria, tests, code, files] = [of('criterion'), of('test'), of('code'), of('file')]
  const live = code.filter((node) => node.change !== 'deleted')
  const context = LIBS.flatMap((lib) => libFns(lib).map((symbol) => ({ id: symbol, path: `src/lib/${lib}.ts`, symbol, summary: `Unchanged. The ${lib} figures the orchard counts with.` })))
  const byTitle = (title: string) => draft.nodes.find((node) => node.title === title)!.id

  const wires: NonNullable<ModelPassInput['wires']> = []
  const taken = new Set(draft.edges.map((edge) => `${edge.from}>${edge.to}`))
  const propose = (from: string, to: string, kind: string, label?: string) => {
    if (from === to || taken.has(`${from}>${to}`) || draft.edges.length + wires.length >= STRESS.wires) return
    taken.add(`${from}>${to}`)
    wires.push({ from, to, kind, ...(label ? { label } : {}) })
  }
  // One wire of each rarer kind first, so every tint is on screen.
  for (const module of MODULES) propose(byTitle(fn('merge', module)), byTitle(fn('drop', module)), 'replaces', 'takes its place')
  const settings = files.find((node) => node.subtitle === 'config/settings.json')!
  propose(settings.id, byTitle(fn('plan', 'trees')), 'configures', 'sets refuseBelowZero')
  propose(settings.id, byTitle(fn('plan', 'ledger')), 'configures')
  // Then fill to the wire count in rounds: lines to code, tests to code, code to context.
  for (let round = 0; draft.edges.length + wires.length < STRESS.wires && round < 40; round += 1) {
    criteria.forEach((node, index) => propose(node.id, live[(index * 3 + round * 7) % live.length]!.id, 'implements'))
    tests.forEach((node, index) => propose(node.id, live[(index * 2 + 1 + round * 5) % live.length]!.id, 'exercises'))
    live.forEach((node, index) => propose(node.id, context[(index + round * 3) % context.length]!.id, 'uses', round === 0 ? 'reads the figure' : undefined))
  }

  const story: NonNullable<ModelPassInput['story']> = criteria.map((node, index) => {
    const test = draft.edges.find((edge) => edge.kind === 'proves' && edge.from === node.id)?.to
    const exercised = test && draft.edges.find((edge) => edge.kind === 'exercises' && edge.from === test)?.to
    return {
      title: `${node.id}: a season of ${MODULES[index % MODULES.length]}`,
      text: `This line asks for one part of the orchard to be counted by season. ${test ? 'Its test calls the function that does the counting.' : 'Nothing proves it yet.'}`,
      focus: [node.id, ...(test ? [test] : []), ...(exercised ? [exercised] : [])],
      criteria: [node.id],
      specStep: `S${Math.floor(index / 4) + 1}`,
    }
  })

  const model: ModelPassInput = {
    summary: 'Made-up change: the orchard counts trees, harvest, market and ledger by season.',
    nodes: Object.fromEntries(code.map((node) => [node.id, { summary: `Counts one part of the orchard for a season. ${node.change === 'deleted' ? 'Removed, because merging took its place.' : 'Refuses a season below zero.'}` }])),
    context,
    wires,
    story,
    closing: 'Counting by week and more than one orchard are left for later.',
  }
  const { review } = await completeReview(draft, model)

  const contents: ReviewFileContents[] = review.files.map((file) => {
    const captured = capture.files.find((entry) => entry.id === file.id)
    if (captured) return { fileId: file.id, path: file.path, ...(file.oldPath ? { oldPath: file.oldPath } : {}), base: captured.base, head: captured.head, binary: captured.binary }
    const text = file.path === SPEC_PATH ? spec : ((head[file.path] as string | undefined) ?? null)
    return { fileId: file.id, path: file.path, base: text, head: text, binary: false }
  })
  return { review, capture, files: contents }
}

export async function stressReview(): Promise<Review> {
  return (await buildStress()).review
}
