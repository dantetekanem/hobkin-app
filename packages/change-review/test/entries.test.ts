import assert from 'node:assert/strict'
import { test } from 'node:test'
import { entriesAbove, type AnchorScan } from '../src/entries.ts'
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

test('the way up from a changed definition goes a caller at a time, through templates, to every entry point', async () => {
  const { scan, asked } = scanning()
  const found = await entriesAbove({ starts: [start], isEntry, scan })
  assert.deepEqual(found.entries, {
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
  assert.deepEqual(found.entries, { a: [{ symbol: 'ReceiptJob#perform', path: 'app/jobs/receipt_job.rb', hops: 2 }], b: [{ symbol: 'ReceiptJob#perform', path: 'app/jobs/receipt_job.rb', hops: 2 }] })
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
  assert.deepEqual(failed, { entries: { n1: [] }, notes: ['The search for entry points stopped: agentic-search is not installed.'] })
})

test('a changed definition nothing calls needs no scan', async () => {
  const { scan, asked } = scanning()
  assert.deepEqual(await entriesAbove({ starts: [{ id: 'n1', callers: [] }], isEntry, scan }), { entries: { n1: [] }, notes: [] })
  assert.equal(asked.length, 0)
})
