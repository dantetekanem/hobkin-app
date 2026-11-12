import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { hashLines } from '../review/lines.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview, type PrepareInput } from '../review/prepare.ts'
import type { Review } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import { VICINITY_LIMIT, type Vicinity, type VicinityDefinition } from '../review/vicinity.ts'

// The change: doingAfter now asks the mood and keeps a note. Around it, unchanged: main.ts starts the app, start
// listens, listen calls doingAfter, and doingAfter's new lines call searchingTool and remember.
const unchanged: Tree = {
  'src/runtime.ts': lines("import { doingAfter } from './doing.ts';", 'export function listen(main: Main) {', '  main.doing = doingAfter(main.doing, main.event);', '  return main;', '}'),
  'src/app.ts': lines("import { listen } from './runtime.ts';", 'export function start(main: Main) {', '  if (main.ready) {', '    return listen(main);', '  }', '  return main;', '}'),
  'src/main.ts': lines("import { start } from './app.ts';", 'start(globalThis.main);'),
  'src/mood.ts': lines('export function searchingTool(name: string) {', "  return name === 'read';", '}'),
  'src/notes.ts': lines('export function remember(text: string) {', '  return text;', '}'),
  // At this commit it no longer calls doingAfter, whatever a scan of another checkout said.
  'src/old.ts': lines('export function oldCaller() {', '  return 1;', '}'),
}
const base: Tree = { ...unchanged, 'src/doing.ts': lines('export function doingAfter(previous: string) {', '  return previous;', '}') }
const head: Tree = {
  ...unchanged,
  'src/doing.ts': lines(
    "import { searchingTool } from './mood.ts';",
    "import { remember } from './notes.ts';",
    '',
    'export function doingAfter(previous: string, event: Event): string {',
    "  if (event.type === 'tool') return searchingTool(event.name) ? 'researching' : 'working';",
    '  remember(previous);',
    '  return previous;',
    '}',
  ),
}

/** The review of the change, with `around` unchanged on both sides. */
async function prepared(vicinity: Vicinity, around: Tree = {}): Promise<Review> {
  const tree = { ...head, ...around }
  const input: PrepareInput = {
    id: 'r1',
    change: { project: 'hobkin', item: '7d02c9', title: 'Say what hobkin is doing', branch: 'hobkin/7d02c9-say-what-hobkin-is-doing' },
    capture: await captureChange(memoryReader({ ...base, ...around }, tree), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof tree[path] === 'string' ? (tree[path] as string) : null),
    vicinity,
  }
  return prepareReview(input)
}

const definition = (path: string, symbol: string, startLine: number, endLine: number): VicinityDefinition => ({ path, symbol, startLine, endLine })
const listen = definition('src/runtime.ts', 'listen', 2, 5)
// The scan read app.ts in a checkout where start sits lower down. At this commit it is lines 2 to 7.
const start = definition('src/app.ts', 'start', 12, 17)
const boot = definition('src/main.ts', 'start(globalThis.main)', 2, 2)
const oldCaller = definition('src/old.ts', 'oldCaller', 1, 3)
const changedLine = { changed: { path: 'src/doing.ts', line: 5 } }

const lifeCycle: Vicinity = {
  links: [
    { near: changedLine, other: listen, direction: 'caller', hops: 1, call: { line: 3, name: 'doingAfter' }, proven: true },
    { near: { definition: listen }, other: start, direction: 'caller', hops: 2, call: { line: 14, name: 'listen', guards: [{ line: 13, text: 'if (main.ready)', branch: 'then' }] }, proven: true },
    { near: { definition: start }, other: boot, direction: 'caller', hops: 3, call: { line: 2, name: 'start' }, proven: true, entry: { kind: 'load', exact: true } },
    { near: changedLine, other: definition('src/mood.ts', 'searchingTool', 1, 3), direction: 'callee', hops: 1, call: { line: 5, name: 'searchingTool', guards: [{ line: 5, text: "if (event.type === 'tool')", branch: 'then' }] }, proven: true },
    { near: { changed: { path: 'src/doing.ts', line: 6 } }, other: definition('src/notes.ts', 'remember', 1, 3), direction: 'callee', hops: 1, call: { line: 6, name: 'remember' }, proven: false },
    { near: changedLine, other: oldCaller, direction: 'caller', hops: 1, call: { line: 2, name: 'doingAfter' }, proven: true },
    // What hangs off a caller that is not there goes with it.
    { near: { definition: oldCaller }, other: definition('src/app.ts', 'start', 2, 7), direction: 'caller', hops: 2, call: { line: 4, name: 'oldCaller' }, proven: true },
    { near: changedLine, other: definition('src/gone.ts', 'gone', 1, 2), direction: 'callee', hops: 1, call: { line: 5, name: 'gone' }, proven: true },
  ],
  left: { byName: 2, perDefinition: 1, further: 1, partial: 3 },
}

test('the life cycle runs from where a request starts, through the callers, to the change and what its lines call', async () => {
  const review = await prepared(lifeCycle)
  const node = (title: string) => {
    const found = review.nodes.find((entry) => entry.title === title)
    assert.ok(found, `a node titled ${title}`)
    return found
  }
  const doingAfter = node('doingAfter')
  const context = review.nodes.filter((entry) => entry.kind === 'context')
  assert.deepEqual(
    context.map((entry) => [entry.title, entry.subtitle, entry.change, entry.lifecycle, entry.entry]),
    [
      ['listen', 'src/runtime.ts', 'unchanged', { role: 'caller', hops: 1 }, undefined],
      ['start', 'src/app.ts', 'unchanged', { role: 'caller', hops: 2 }, undefined],
      ['start(globalThis.main)', 'src/main.ts', 'unchanged', { role: 'caller', hops: 3 }, { kind: 'load', exact: true }],
      ['searchingTool', 'src/mood.ts', 'unchanged', { role: 'callee', hops: 1 }, undefined],
      ['remember', 'src/notes.ts', 'unchanged', { role: 'callee', hops: 1 }, undefined],
    ],
  )

  // The host owns every range: start is where this commit has it, not where the scan's checkout did.
  const appText = head['src/app.ts'] as string
  assert.deepEqual(node('start').anchors, [{ fileId: 'src/app.ts', side: 'added', startLine: 2, endLine: 7, hash: hashLines(appText, 2, 7) }])
  assert.match(node('start(globalThis.main)').summary, /runs as its file loads/)

  // Every wire says where the call is, and what it sits under, at this commit.
  const wire = (from: string, to: string) => review.edges.find((edge) => edge.from === from && edge.to === to)
  const [listenId, startId, bootId] = ['listen', 'start', 'start(globalThis.main)'].map((title) => node(title).id)
  assert.deepEqual([wire(doingAfter.id, listenId)?.kind, wire(doingAfter.id, listenId)?.label], ['called-by', 'from line 3'])
  assert.deepEqual([wire(listenId, startId!)?.kind, wire(listenId, startId!)?.label], ['called-by', 'from line 4, inside if (main.ready)'])
  assert.deepEqual([wire(startId!, bootId!)?.kind, wire(startId!, bootId!)?.label], ['called-by', 'from line 2'])
  assert.deepEqual([wire(doingAfter.id, node('searchingTool').id)?.kind, wire(doingAfter.id, node('searchingTool').id)?.label], ['calls', "line 5, inside if (event.type === 'tool')"])
  assert.equal(wire(doingAfter.id, node('remember').id)?.label, 'line 6, found by name')

  // The way out reads left to right: each caller sits a column further than the one it calls.
  const x = (title: string) => node(title).position.x
  assert.ok(x('doingAfter') < x('listen') && x('listen') < x('start') && x('start') < x('start(globalThis.main)'))

  // What was left out is said, with why.
  const said = review.notices.join(' ')
  assert.match(said, /shows 5 unchanged definitions/)
  assert.match(said, /3 not found at this commit/)
  assert.match(said, /2 callers matched only by name/)
  assert.match(said, /callers of 1 definition go further/)
  assert.match(said, /could not list every caller of 3/)
  assert.deepEqual(validateReview(review), [])
})

test('a changed definition the framework calls is marked where the request enters', async () => {
  const review = await prepared({ links: [], entries: [{ changed: changedLine.changed, entry: { kind: 'controller', exact: true } }] })
  assert.deepEqual(review.nodes.find((entry) => entry.title === 'doingAfter')?.entry, { kind: 'controller', exact: true })
  assert.deepEqual(validateReview(review), [])
})

test('past the limit the rest of the life cycle is left out, and the review says how much', async () => {
  const many = Array.from({ length: VICINITY_LIMIT + 2 }, (_, index) => `caller${index}`)
  const callers: Tree = { 'src/callers.ts': lines(...many.flatMap((name) => [`export function ${name}() {`, "  return doingAfter('', event);", '}'])) }
  const review = await prepared(
    { links: many.map((name, index) => ({ near: changedLine, other: definition('src/callers.ts', name, index * 3 + 1, index * 3 + 3), direction: 'caller' as const, hops: 1, call: { line: index * 3 + 2, name: 'doingAfter' }, proven: true })) },
    callers,
  )
  assert.equal(review.nodes.filter((entry) => entry.kind === 'context').length, VICINITY_LIMIT)
  assert.match(review.notices.join(' '), new RegExp(`2 past the limit of ${VICINITY_LIMIT}`))
  assert.deepEqual(validateReview(review), [])
})
