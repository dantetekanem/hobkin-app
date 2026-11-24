import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entriesAbove, type AnchorScan, type EntryAbove } from '../src/entries.ts'
import type { CallSite, Scan, ScanAnchor } from '../src/types.ts'

const site = (path: string, line: number): CallSite => ({ id: `${path}:${line}`, symbol: '', path, line, guards: [] })
const anchor = (symbol: string, path: string, lines: [number, number], callers: CallSite[], entry?: ScanAnchor['entry']): ScanAnchor => ({
  id: symbol, symbol, kind: 'method', path, startLine: lines[0], endLine: lines[1], changedLines: [], callSites: callers, tests: [], ...(entry ? { entry } : {}),
})

/** A helper called by a helper, called by a partial, rendered by a view, rendered by two controller actions. */
const DEFINITIONS = [
  anchor('PostsHelper#render_post_message', 'app/helpers/posts_helper.rb', [10, 32], [site('app/helpers/posts_helper.rb', 6)]),
  anchor('PostsHelper#escape_post_message', 'app/helpers/posts_helper.rb', [4, 8], [site('app/views/posts/_post.html.erb', 79)]),
  anchor('posts/_post.html.erb', 'app/views/posts/_post.html.erb', [1, 91], [site('app/views/topics/show.html.erb', 26)]),
  anchor('topics/show.html.erb', 'app/views/topics/show.html.erb', [1, 38], [site('app/controllers/topics_controller.rb', 26), site('app/controllers/museum/topics_controller.rb', 25)]),
  anchor('TopicsController#show', 'app/controllers/topics_controller.rb', [20, 40], [], { kind: 'controller', exact: true }),
  anchor('Museum::TopicsController#show', 'app/controllers/museum/topics_controller.rb', [20, 30], []),
]

/** A scan that answers with the definition holding each place it is asked for, and remembers what it was asked. */
function scanning(definitions: ScanAnchor[] = DEFINITIONS) {
  const asked: string[][] = []
  const scan: AnchorScan = async (anchors) => {
    asked.push([...anchors])
    const found = anchors.flatMap((place) => {
      const [path, line] = [place.slice(0, place.lastIndexOf(':')), Number(place.slice(place.lastIndexOf(':') + 1))]
      return definitions.filter((item) => item.path === path && item.startLine <= line && line <= item.endLine)
    })
    return { ok: true, scan: { anchors: found, nodes: {}, edges: [], dangling: [], tests: [], files: [], coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] } } satisfies Scan }
  }
  return { scan, asked }
}

const isEntry = (path: string) => /(^|\/)controllers\//.test(path)
const start = { id: 'n1', callers: [{ path: 'app/helpers/posts_helper.rb', line: 23 }] }
/** Each entry point found as the walk named it before it kept the way: its name, place and distance. */
const named = (entries: Record<string, EntryAbove[]>) =>
  Object.fromEntries(Object.entries(entries).map(([id, found]) => [id, found.map(({ symbol, path, hops }) => ({ symbol, path, hops }))]))

test('the way up from a changed definition goes a caller at a time, through templates, to every entry point', async () => {
  const { scan, asked } = scanning()
  const found = await entriesAbove({ starts: [start], isEntry, scan })
  assert.deepEqual(named(found.entries), {
    n1: [
      { symbol: 'TopicsController#show', path: 'app/controllers/topics_controller.rb', hops: 5 },
      { symbol: 'Museum::TopicsController#show', path: 'app/controllers/museum/topics_controller.rb', hops: 5 },
    ],
  })
  assert.deepEqual(found.notes, [])
  assert.deepEqual(asked.map((places) => places.length), [1, 1, 1, 1, 2], 'one scan for each call further out')
})

test('an entry point ends its way, a definition is followed once, and several changed definitions share each scan', async () => {
  // The job is an entry by its path, and calls itself: nothing is asked again.
  const loop = [
    anchor('Totals#round', 'app/models/totals.rb', [1, 9], [site('app/jobs/receipt_job.rb', 5), site('app/models/totals.rb', 20)]),
    anchor('Totals#sum', 'app/models/totals.rb', [15, 25], [site('app/models/totals.rb', 3)]),
    anchor('ReceiptJob#perform', 'app/jobs/receipt_job.rb', [3, 8], [site('app/jobs/receipt_job.rb', 6)]),
  ]
  const { scan, asked } = scanning(loop)
  const found = await entriesAbove({
    starts: [{ id: 'a', callers: [{ path: 'app/models/totals.rb', line: 3 }] }, { id: 'b', callers: [{ path: 'app/models/totals.rb', line: 3 }] }],
    isEntry: (path) => path.includes('/jobs/'),
    scan,
  })
  assert.deepEqual(named(found.entries), { a: [{ symbol: 'ReceiptJob#perform', path: 'app/jobs/receipt_job.rb', hops: 2 }], b: [{ symbol: 'ReceiptJob#perform', path: 'app/jobs/receipt_job.rb', hops: 2 }] })
  assert.deepEqual(asked, [['app/models/totals.rb:3'], ['app/jobs/receipt_job.rb:5', 'app/models/totals.rb:20']])
})

test('the walk stops at its limit of calls, when its time is used, and when a scan fails, and says so each time', async () => {
  const far = await entriesAbove({ starts: [start], isEntry, scan: scanning().scan, maxHops: 3 })
  assert.deepEqual(far.entries, { n1: [] })
  assert.deepEqual(far.notes, ['The way to an entry point was followed for 3 calls and goes on further: what is above that was not looked for.'])

  let at = 0
  const slow = await entriesAbove({ starts: [start], isEntry, scan: scanning().scan, now: () => (at += 40_000), budgetMs: 60_000 })
  assert.deepEqual(slow.entries, { n1: [] })
  assert.match(slow.notes[0] ?? '', /^The search for entry points used the time it had after \d+ calls?/)

  const failing: AnchorScan = async () => ({ ok: false, reason: 'agentic-search is not installed.' })
  const failed = await entriesAbove({ starts: [start], isEntry, scan: failing })
  assert.deepEqual([failed.entries, failed.notes], [{ n1: [] }, ['The search for entry points stopped: agentic-search is not installed.']])

  // Each way says why it stopped and how far it looked, for the part it starts from.
  assert.deepEqual(far.stops, { n1: { hops: 3, stopped: 'limit' } })
  assert.equal(slow.stops?.n1?.stopped, 'time')
  assert.deepEqual(failed.stops, { n1: { hops: 0, stopped: 'failed', reason: 'agentic-search is not installed.' } })
})

test('each entry point keeps the way to it: the origin first, every definition between, the changed part\'s caller last', async () => {
  const found = await entriesAbove({ starts: [start], isEntry, scan: scanning().scan })
  const [routed, byPath] = found.entries.n1!
  assert.deepEqual(
    routed!.chain!.map((step) => [step.symbol, step.line, step.call_line]),
    [
      ['TopicsController#show', 20, 26],
      ['topics/show.html.erb', 1, 26],
      ['posts/_post.html.erb', 1, 79],
      ['PostsHelper#escape_post_message', 4, 6],
      ['PostsHelper#render_post_message', 10, 23],
    ],
  )
  // The scan names the action a controller; the other is one by its path only.
  assert.deepEqual([routed!.kind, routed!.exact, routed!.by, routed!.line], ['controller', true, 'scan', 20])
  assert.deepEqual([byPath!.kind, byPath!.exact, byPath!.by], ['path', false, 'path'])
  assert.equal(byPath!.chain!.length, byPath!.hops)
  assert.deepEqual(found.stops, { n1: { hops: 5 } })
})

test('the path rule can name the kind of an entry point, and the scan\'s words and routes are its label', async () => {
  const definitions = [
    anchor('render', 'src/render.js', [1, 9], [site('src/handlers/topics.js', 4)]),
    anchor('showTopic', 'src/handlers/topics.js', [3, 5], []),
    anchor('OrdersController#show', 'app/controllers/orders_controller.rb', [2, 6], [], { kind: 'controller', exact: true, routes: [{ verbs: ['GET'], path: '/orders/:id', file: 'config/routes.rb', line: 3 }] }),
    anchor('reviewHandlers', 'host/src/review/seat.ts', [371, 399], [], { kind: 'handler', exact: true, label: 'review.prepare' }),
  ]
  const found = await entriesAbove({
    starts: [{ id: 'a', callers: [{ path: 'src/render.js', line: 2 }] }, { id: 'b', callers: [{ path: 'app/controllers/orders_controller.rb', line: 4 }] }, { id: 'c', callers: [{ path: 'host/src/review/seat.ts', line: 374, enqueue: true }] }],
    isEntry: (path) => (path.includes('/handlers/') ? 'handler' : false),
    scan: scanning(definitions).scan,
  })
  assert.deepEqual([found.entries.a![0]!.kind, found.entries.a![0]!.label, found.entries.a![0]!.by], ['handler', 'showTopic', 'path'])
  assert.deepEqual([found.entries.b![0]!.label, found.entries.b![0]!.route], ['GET /orders/:id', { verbs: ['GET'], path: '/orders/:id' }])
  // A routed action is reached by its route first, as the window shows it: the route line, then the action.
  assert.deepEqual([found.entries.b![0]!.kind, found.entries.b![0]!.hops, found.entries.b![0]!.chain![0]], ['route', 2, { symbol: 'GET /orders/:id', path: 'config/routes.rb', line: 3, call_line: 3, door: true }])
  assert.deepEqual([found.entries.c![0]!.kind, found.entries.c![0]!.label, found.entries.c![0]!.chain![0]!.enqueues], ['handler', 'review.prepare', true])
})

test('a way that ends where nothing calls the last definition says which one it is', async () => {
  const definitions = [anchor('renderPost', 'src/render.js', [1, 9], [site('src/topics.js', 4)]), anchor('showTopic', 'src/topics.js', [3, 5], [])]
  const found = await entriesAbove({ starts: [{ id: 'n1', callers: [{ path: 'src/render.js', line: 2 }] }], isEntry: () => false, scan: scanning(definitions).scan })
  assert.deepEqual(found.entries, { n1: [] })
  assert.deepEqual(found.stops, { n1: { hops: 2, top: 'showTopic' } })
})

test('a changed definition nothing calls needs no scan', async () => {
  const { scan, asked } = scanning()
  const found = await entriesAbove({ starts: [{ id: 'n1', callers: [] }], isEntry, scan })
  assert.deepEqual([found.entries, found.notes, found.stops], [{ n1: [] }, [], {}])
  assert.equal(asked.length, 0)
})

test('the walk keeps the tests the scan links to each definition it follows, so tests of a caller on the way can be run', async () => {
  const tested = (definition: ScanAnchor, tests: ScanAnchor['tests']) => ({ ...definition, tests })
  const definitions = [
    tested(anchor('findReview', 'src/services/reviews.js', [3, 5], [site('src/handlers/reviews.js', 4)]), [{ id: 't1', symbol: 'a review shows its score', path: 'test/services/reviews.test.js', line: 5 }]),
    anchor('showReview', 'src/handlers/reviews.js', [3, 5], [], { kind: 'route', exact: true }),
  ]
  const found = await entriesAbove({ starts: [{ id: 'n2', callers: [{ path: 'src/services/reviews.js', line: 4 }] }], isEntry: () => false, scan: scanning(definitions).scan })
  assert.deepEqual(found.tests, { 'src/services/reviews.js:3': [{ symbol: 'a review shows its score', path: 'test/services/reviews.test.js', line: 5 }] })
})

test('a call the scan names as a way in ends its way there, by its key, with no scan of the place it is in', async () => {
  const handlerSite: CallSite = {
    id: 'h1', symbol: 'handlers', path: 'src/commands.js', line: 4, guards: [], key: 'review.prepare',
    entry: { kind: 'handler', exact: true, doors: [{ kind: 'handler', title: 'review.prepare', file: 'src/commands.js', line: 4 }] },
  }
  const definitions = [
    anchor('prepareReview', 'src/services/reviews.js', [7, 9], [handlerSite]),
    anchor('handlers', 'src/commands.js', [3, 5], [site('src/commands.js', 8)]),
    anchor('dispatch', 'src/commands.js', [7, 9], []),
  ]
  const { scan, asked } = scanning(definitions)
  const found = await entriesAbove({ starts: [{ id: 'n2', callers: [{ path: 'src/services/reviews.js', line: 8 }] }], isEntry: () => false, scan })
  assert.deepEqual(found.entries.n2, [
    {
      symbol: 'handlers', path: 'src/commands.js', hops: 2, line: 4, kind: 'handler', label: 'review.prepare', exact: true, by: 'scan',
      chain: [
        { symbol: 'handlers', path: 'src/commands.js', line: 4, call_line: 4 },
        { symbol: 'prepareReview', path: 'src/services/reviews.js', line: 7, call_line: 8 },
      ],
    },
  ])
  assert.deepEqual(asked, [['src/services/reviews.js:8']], 'the handler map is not scanned for its own callers')
  assert.deepEqual(found.stops, { n2: { hops: 2 } })
})
