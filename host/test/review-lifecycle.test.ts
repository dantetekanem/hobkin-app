import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LIFE_CYCLE, type VicinityLink } from '#shared/review/vicinity.ts'
import { scanVicinity, type ScanRun } from '../src/review/vicinity-scan.ts'

/**
 * The life cycle from agentic-search's packs: each changed definition's ways out, a call at a time, to where a request
 * comes in. A route, Rails's exceptions app and what a package.json exposes are doors one step before the code they
 * reach; a view template is a caller, and what renders it is the template's.
 */
const node = (id: string, path: string, symbol: string, startLine: number, endLine: number, more: Record<string, unknown> = {}) => ({ id, path, symbol, kind: 'method', language: 'ruby', startLine, endLine, depth: 1, ...more })
const caller = (id: string, path: string, line: number, more: Record<string, unknown> = {}) => ({ id, symbol: id, path, line, text: '', context: '', test: false, changed: false, boundary: [], resolution: 'exact', guards: [], ...more })
const anchor = (definition: ReturnType<typeof node>, callers: unknown[], more: Record<string, unknown> = {}) => ({ ...definition, changedLines: [], callers, callerCount: { total: callers.length, shown: callers.length, complete: true }, ...more })
const pack = (nodes: unknown[], anchors: unknown[], edges: unknown[] = []) => ({ files: [], nodes, anchors, edges, coverage: { truncatedBy: 'none' } })
const routed = (line: number, path = '/users/:id') => ({ kind: 'controller', exact: true, routes: [{ verbs: ['GET'], path, file: 'config/routes.rb', line, text: `get "${path.slice(1)}"` }] })

function fakeScans(packs: unknown[]) {
  const calls: string[][] = []
  const run: ScanRun = async (args) => {
    calls.push([...args])
    const answer = packs[calls.length - 1]
    return answer === undefined ? { ok: false, reason: 'no pack for this scan' } : { ok: true, stdout: JSON.stringify({ details: answer }) }
  }
  return { run, calls }
}
const scan = (run: ScanRun, more: Partial<Parameters<typeof scanVicinity>[0]> = {}) => scanVicinity({ repo: '/repo.invalid', base: 'aaa1111', head: 'bbb2222', run, readHead: async () => null, readFolder: () => null, references: async () => [], ...more })
const anchorsOf = (args: string[]) => args.flatMap((arg, index) => (args[index - 1] === '--anchor' ? [arg] : []))
const shape = ({ other, hops, call, entry }: VicinityLink) => [other.symbol, hops, call.renders ?? null, call.routes ?? null, entry?.kind ?? null]

test('a controller action a changed model method reaches has its route one step further out, and nothing past it is looked for', async () => {
  const fullName = node('m1', 'app/models/user.rb', 'User#full_name', 2, 4)
  const show = node('c1', 'app/controllers/users_controller.rb', 'UsersController#show', 2, 4, { entry: routed(2) })
  const { run, calls } = fakeScans([pack([fullName, show], [anchor(fullName, [caller('c1', show.path, 3, { resolution: 'static_candidate' })], { changedLines: [3] })])])
  const found = await scan(run)
  assert.deepEqual(found.links.map(shape), [
    ['UsersController#show', 1, null, null, 'controller'],
    ['GET /users/:id', 2, null, 'get "users/:id"', 'route'],
  ])
  assert.deepEqual(found.links[1]!.entry, { kind: 'route', exact: true, route: { verbs: ['GET'], path: '/users/:id' } })
  assert.deepEqual(found.links[1]!.other, { path: 'config/routes.rb', symbol: 'GET /users/:id', startLine: 2, endLine: 2 })
  assert.deepEqual(found.reach, [{ changed: { path: 'app/models/user.rb', line: 3 }, symbol: 'User#full_name', hops: 1 }])
  assert.equal(calls.length, 1, 'where a request enters, nothing further out is looked for')
})

test('a helper is reached through the view that calls it and the action that renders that view by convention', async () => {
  const helper = node('h1', 'app/helpers/users_helper.rb', 'UsersHelper#display_name', 2, 4)
  const view = node('v1', 'app/views/users/show.html.erb', 'users/show.html.erb', 1, 12, { kind: 'template' })
  const show = node('c1', 'app/controllers/users_controller.rb', 'UsersController#show', 2, 4, { entry: routed(2) })
  const { run, calls } = fakeScans([
    pack([helper, view], [anchor(helper, [caller('v1', view.path, 5, { resolution: 'static_candidate' })], { changedLines: [3] })]),
    pack([{ ...view, id: 'v2' }, show], [anchor({ ...view, id: 'v2' }, [caller('c1', show.path, 2, { convention: true })])]),
  ])
  const found = await scan(run)
  assert.deepEqual(anchorsOf(calls[1]!), ['app/views/users/show.html.erb:1'], 'a template is looked into from its first line')
  assert.deepEqual(found.links.map(shape), [
    ['users/show.html.erb', 1, null, null, null],
    ['UsersController#show', 2, 'convention', null, 'controller'],
    ['GET /users/:id', 3, null, 'get "users/:id"', 'route'],
  ])
  assert.equal(found.links[0]!.call.name, 'display_name')
})

test('a job is where a request enters, and the way goes on through what enqueues it to the route of that', async () => {
  const total = node('m1', 'app/models/cart.rb', 'Cart#total', 2, 4)
  const job = node('j1', 'app/jobs/receipt_job.rb', 'ReceiptJob#perform', 2, 4, { entry: { kind: 'job', exact: true } })
  const checkout = node('k1', 'app/models/checkout.rb', 'Checkout#complete', 2, 4)
  const create = node('c1', 'app/controllers/orders_controller.rb', 'OrdersController#create', 2, 4, { entry: routed(2, '/orders') })
  const { run, calls } = fakeScans([
    pack([total, job], [anchor(total, [caller('j1', job.path, 3)], { changedLines: [3] })]),
    pack([job, checkout], [anchor(job, [caller('k1', checkout.path, 3, { enqueue: true })])]),
    pack([checkout, create], [anchor(checkout, [caller('c1', create.path, 3)])]),
  ])
  const found = await scan(run)
  assert.equal(calls.length, 3)
  assert.deepEqual(found.links.map((link) => [link.other.symbol, link.hops, link.call.enqueues ?? false, link.entry?.kind ?? null]), [
    ['ReceiptJob#perform', 1, false, 'job'],
    ['Checkout#complete', 2, true, null],
    ['OrdersController#create', 3, false, 'controller'],
    ['GET /orders', 4, false, 'route'],
  ])
})

test('a template rendered by name is called by the line that renders it, as that line names it', async () => {
  const partial = node('p1', 'app/views/posts/_post.html.erb', 'posts/_post.html.erb', 1, 9, { kind: 'template' })
  const page = node('t1', 'app/views/topics/show.html.erb', 'topics/show.html.erb', 1, 30, { kind: 'template' })
  const { run } = fakeScans([pack([partial, page], [anchor(partial, [caller('t1', page.path, 26, { name: 'posts/post' })], { changedLines: [2] })])])
  const [link] = (await scan(run)).links
  assert.deepEqual([link?.other.symbol, link?.call.name, link?.call.renders, link?.call.line], ['topics/show.html.erb', 'posts/post', true, 26])
})

test(`the ways out go a call at a time up to ${LIFE_CYCLE.hops}, and a changed definition says when its scans stopped there`, async () => {
  const chain = Array.from({ length: LIFE_CYCLE.hops + 2 }, (_, index) => node(`a${index}`, `app/services/step${index}.rb`, `Step${index}#call_next`, 2, 4))
  const packs = chain.slice(0, -1).map((step, index) => pack([step, chain[index + 1]], [anchor(step, [caller(chain[index + 1]!.id, chain[index + 1]!.path, 3)], index === 0 ? { changedLines: [3] } : {})]))
  const { run, calls } = fakeScans(packs)
  const found = await scan(run)
  assert.equal(calls.length, LIFE_CYCLE.hops, 'the first scan and one for each call further out')
  assert.deepEqual(found.links.map((link) => link.hops), Array.from({ length: LIFE_CYCLE.hops }, (_, index) => index + 1))
  assert.deepEqual(found.reach, [{ changed: { path: 'app/services/step0.rb', line: 3 }, symbol: 'Step0#call_next', hops: LIFE_CYCLE.hops, stopped: 'limit' }])
  assert.equal(found.left?.further, 1)
})

test(`each changed definition keeps its ${LIFE_CYCLE.ways} best ways out, the nearest entry first, and ways that share a caller join there`, async () => {
  const root = node('r', 'app/models/order.rb', 'Order#total', 2, 4)
  const [p1, p2, p3] = [1, 2, 3].map((index) => node(`p${index}`, `app/services/p${index}.rb`, `P${index}#run`, 2, 4))
  const entries = [1, 2, 3].map((index) => node(`e${index}`, `app/controllers/e${index}_controller.rb`, `E${index}Controller#create`, 2, 4, { entry: { kind: 'controller', exact: true } }))
  const { run } = fakeScans([
    pack([root, p1, p2, p3], [anchor(root, [p1, p2, p3].map((step) => caller(step!.id, step!.path, 3)), { changedLines: [3] })]),
    pack([p1, p2, p3, ...entries], [anchor(p1!, [caller('e1', entries[0]!.path, 3), caller('e2', entries[1]!.path, 3)]), anchor(p2!, [caller('e3', entries[2]!.path, 3)]), anchor(p3!, [])]),
  ])
  const found = await scan(run)
  assert.deepEqual(found.links.map((link) => link.other.symbol), ['P1#run', 'E1Controller#create', 'E2Controller#create', 'P2#run', 'E3Controller#create'])
  assert.equal(found.left?.aside, 1, 'P3#run leads nowhere a request enters, and three ways that do are kept')
})

test('a Ruby call on a local or tied only to a class goes nowhere known, and is not what the change calls', async () => {
  const mentions = node('m1', 'app/helpers/posts_helper.rb', 'PostsHelper#link_user_tags', 2, 9)
  const scanner = node('s1', 'lib/easy_rpg/scanner.rb', 'EasyRpg::Scanner#scan', 2, 4)
  const helpers = node('k1', 'app/helpers/application_helper.rb', 'ApplicationHelper', 1, 40, { kind: 'module' })
  const where = node('u1', 'app/models/user.rb', 'User.where_active', 2, 4, { kind: 'singleton_method' })
  const { run } = fakeScans([pack([mentions, scanner, helpers, where], [anchor(mentions, [], { changedLines: [3, 4, 5] })], [
    { from: 'm1', to: 's1', name: 'text.scan', relationship: 'calls', resolution: 'static_candidate', via: 'name_only', line: 3 },
    { from: 'm1', to: 'k1', name: 'content_tag', relationship: 'calls', resolution: 'static_candidate', line: 4 },
    { from: 'm1', to: 'u1', name: 'User.where_active', relationship: 'calls', resolution: 'static_candidate', via: 'name_only', line: 5 },
  ])])
  const found = await scan(run)
  assert.deepEqual(found.links.filter((link) => link.direction === 'callee').map((link) => link.other.symbol), ['User.where_active'])
})

test('what a package exposes is a door: a schema its extension registers is reached from where package.json lists it', async () => {
  const extensionText = ['const SearchParams = Type.Object({});', '', 'export default function searchExtension(pi) {', '  pi.registerTool({ parameters: SearchParams });', '}', ''].join('\n')
  const params = node('n1', 'src/extension.ts', 'SearchParams', 1, 1, { kind: 'constant', language: 'typescript' })
  const exposed = node('n2', 'src/extension.ts', 'searchExtension', 3, 5, { kind: 'function', language: 'typescript', entry: { kind: 'extension', exact: true, doors: [{ kind: 'extension', title: './index.ts', file: 'package.json', line: 5, text: '"./index.ts"' }] } })
  const { run, calls } = fakeScans([
    pack([params], [anchor(params, [], { changedLines: [1], callerCount: { total: 0, shown: 0, complete: false } })]),
    pack([exposed], [anchor(exposed, [caller('n9', 'src/loader.ts', 4)])]),
  ])
  const read = (path: string) => (path === 'src/extension.ts' ? extensionText : null)
  const found = await scan(run, { readHead: async (path) => read(path), readFolder: read, references: async () => [{ path: 'src/extension.ts', line: 4 }] })
  assert.deepEqual(anchorsOf(calls[1]!), ['src/extension.ts:3'])
  assert.deepEqual(found.links.map(shape), [
    ['searchExtension', 1, null, null, null],
    ['./index.ts', 2, null, '"./index.ts"', 'extension'],
  ])
  assert.equal(calls.length, 2, 'past what its package exposes, nothing is looked for')
})

test('a changed caller is on the way in, and its own callers are the change’s own, not looked for again', async () => {
  const fullName = node('m1', 'app/models/user.rb', 'User#full_name', 2, 4)
  const show = node('c1', 'app/controllers/users_controller.rb', 'UsersController#show', 2, 4, { entry: routed(2) })
  const { run, calls } = fakeScans([pack([fullName, show], [
    anchor(fullName, [caller('c1', show.path, 3, { changed: true })], { changedLines: [3] }),
    anchor(show, [], { changedLines: [3] }),
  ])])
  const found = await scan(run)
  assert.deepEqual(found.links.map(shape), [
    ['UsersController#show', 1, null, null, 'controller'],
    ['GET /users/:id', 1, null, 'get "users/:id"', 'route'],
  ])
  assert.deepEqual(found.links[1]!.near, { changed: { path: 'app/controllers/users_controller.rb', line: 3 } }, 'the changed action keeps its route as its own')
  assert.equal(calls.length, 1)
})
