import assert from 'node:assert/strict'
import { test } from 'node:test'
import { packOrigins, runsFromOf } from '../src/origins.ts'
import type { Scan, ScanAnchor } from '../src/types.ts'

const anchor: ScanAnchor = { id: 'n1', symbol: 'PostsHelper#link_user_tags', kind: 'method', path: 'app/helpers/posts_helper.rb', startLine: 3, endLine: 9, changedLines: [4], tests: [] }

/** A pack where the helper is called by a render method, which a routed controller action and a job both call. */
const scan = (): Scan => ({
  anchors: [anchor],
  nodes: {
    n1: { id: 'n1', symbol: anchor.symbol, kind: 'method', path: anchor.path, startLine: 3, endLine: 9 },
    n2: { id: 'n2', symbol: 'PostsHelper#render_post', kind: 'method', path: 'app/helpers/posts_helper.rb', startLine: 12, endLine: 20 },
    n3: { id: 'n3', symbol: 'TopicsController#show', kind: 'method', path: 'app/controllers/topics_controller.rb', startLine: 5, endLine: 11, entry: { kind: 'controller', exact: true, routes: [{ verbs: ['GET'], path: '/t/:id', file: 'config/routes.rb', line: 3 }] } },
    n4: { id: 'n4', symbol: 'DigestJob#perform', kind: 'method', path: 'app/jobs/digest_job.rb', startLine: 2, endLine: 8 },
  },
  edges: [
    { from: 'n2', to: 'n1', relationship: 'called_by', resolution: 'exact', line: 14, guards: [{ line: 13, text: 'if post.mentions?', branch: 'then' }] },
    { from: 'n3', to: 'n2', relationship: 'called_by', resolution: 'exact', line: 7 },
    { from: 'n4', to: 'n2', relationship: 'called_by', resolution: 'static_candidate', line: 4, note: 'enqueue' },
    { from: 'n9', to: 'n1', relationship: 'called_by', resolution: 'exact', line: 2, note: 'test' },
  ],
  dangling: [],
  tests: [],
  files: [],
  coverage: { truncated: false, truncatedBy: 'none', skippedAnchors: 0, unresolved: 0, notes: [] },
})

const jobs = (path: string) => (path.includes('/jobs/') ? 'job' : undefined)

test('the pack shows the ways in it holds: the scan\'s entry with its route, and a path rule\'s, each with the way down to the part', () => {
  const { origins, hops } = packOrigins(scan(), anchor, jobs)
  assert.equal(hops, 2)
  assert.deepEqual(origins, [
    {
      kind: 'controller', label: 'GET /t/:id', route: { verbs: ['GET'], path: '/t/:id' }, exact: true, by: 'scan', symbol: 'TopicsController#show', hops: 2,
      chain: [
        { symbol: 'TopicsController#show', path: 'app/controllers/topics_controller.rb', line: 5, call_line: 7 },
        { symbol: 'PostsHelper#render_post', path: 'app/helpers/posts_helper.rb', line: 12, call_line: 14, guard: 'if post.mentions?' },
      ],
    },
    {
      kind: 'job', label: 'DigestJob#perform', exact: false, by: 'path', symbol: 'DigestJob#perform', hops: 2,
      chain: [
        { symbol: 'DigestJob#perform', path: 'app/jobs/digest_job.rb', line: 2, call_line: 4, enqueues: true },
        { symbol: 'PostsHelper#render_post', path: 'app/helpers/posts_helper.rb', line: 12, call_line: 14, guard: 'if post.mentions?' },
      ],
    },
  ])
})

test('a part that is itself where work enters is its own origin, with no way to it', () => {
  const action = { ...anchor, entry: { kind: 'handler', exact: true, label: 'review.prepare' } }
  assert.deepEqual(packOrigins({ ...scan(), edges: [] }, action, () => undefined).origins, [{ kind: 'handler', label: 'review.prepare', exact: true, by: 'scan', symbol: anchor.symbol, chain: [], hops: 0 }])
})

test('more than three origins are counted, the nearest kept, and a cut walk is said beside them', () => {
  const origin = (hops: number, line: number) => ({ kind: 'job', label: `J${line}`, exact: true, by: 'scan' as const, symbol: `J${line}`, hops, chain: [{ symbol: `J${line}`, path: 'app/jobs/j.rb', line }] })
  const said = runsFromOf({ origins: [origin(3, 1), origin(1, 2), origin(2, 3), origin(4, 4)], looked: 1, callers: 2, testCallers: 0, testRefs: 0, listed: true, walked: { stop: { hops: 6, stopped: 'limit' } } })
  assert.deepEqual(said.found === 'origins' && said.origins.map((entry) => entry.label), ['J2', 'J3', 'J1'])
  assert.deepEqual(said.found === 'origins' && [said.more, said.cut], [1, '1 more way in was found. Other ways out were followed for 6 calls, and the way goes on further: what is above that was not looked for.'])
})

test('a part no production code calls and tests refer to is one only tests call, as a pack lists tests apart from callers', () => {
  assert.deepEqual(runsFromOf({ origins: [], looked: 0, callers: 0, testCallers: 0, testRefs: 3, listed: true }), { found: 'only-tests', tests: 3 })
  assert.deepEqual(runsFromOf({ origins: [], looked: 0, callers: 0, testCallers: 0, testRefs: 0, listed: true }), { found: 'none', hops: 0, why: 'The scan found nothing that calls it.' })
})
