import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { hashLines } from '../review/lines.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'
import type { Review, ReviewLifecycle, ReviewNode } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import { LIFE_CYCLE, type Vicinity, type VicinityDefinition, type VicinityLink } from '../review/vicinity.ts'

// A Rails app in a few files: GET /users/:id reaches UsersController#show, which shows the user's full name and
// renders users/show.html.erb, whose helper shows it too. The change puts Mr or Ms before the name.
const unchanged: Tree = {
  'config/routes.rb': lines('Rails.application.routes.draw do', '  resources :users, only: [:show]', 'end'),
  'config/application.rb': lines('module Shop', '  class Application < Rails::Application', '    config.exceptions_app = ->(env) {', '      ErrorsController.action(:show).call(env)', '    }', '  end', 'end'),
  'app/controllers/users_controller.rb': lines('class UsersController < ApplicationController', '  def show', '    @name = User.find(params[:id]).full_name', '  end', 'end'),
  'app/views/users/show.html.erb': lines('<h1><%= display_name(@user) %></h1>', '<p>Welcome back.</p>'),
  'app/helpers/legacy_helper.rb': lines('module LegacyHelper', '  def legacy_name(user)', '    user.full_name', '  end', 'end'),
}
const base: Tree = {
  ...unchanged,
  'app/models/user.rb': lines('class User < ApplicationRecord', '  def full_name', '    "#{first} #{last}"', '  end', 'end'),
  'app/helpers/users_helper.rb': lines('module UsersHelper', '  def display_name(user)', '    user.name', '  end', 'end'),
  'app/controllers/errors_controller.rb': lines('class ErrorsController < ApplicationController', '  def show', '    render "404"', '  end', 'end'),
}
const head: Tree = {
  ...unchanged,
  'app/models/user.rb': lines('class User < ApplicationRecord', '  def full_name', '    "#{title} #{first} #{last}"', '  end', 'end'),
  'app/helpers/users_helper.rb': lines('module UsersHelper', '  def display_name(user)', '    user.full_name', '  end', 'end'),
  'app/controllers/errors_controller.rb': lines('class ErrorsController < ApplicationController', '  def show', '    head 404', '  end', 'end'),
}

async function prepared(vicinity?: Vicinity, trees: { base: Tree; head: Tree } = { base, head }): Promise<Review> {
  return prepareReview({
    id: 'r1',
    change: { project: 'shop', item: 'a1b2c3', title: 'Say Mr or Ms first', branch: 'hobkin/a1b2c3-say-mr-or-ms-first' },
    capture: await captureChange(memoryReader(trees.base, trees.head), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof trees.head[path] === 'string' ? (trees.head[path] as string) : null),
    ...(vicinity ? { vicinity } : {}),
  })
}

const definition = (path: string, symbol: string, startLine: number, endLine: number): VicinityDefinition => ({ path, symbol, startLine, endLine })
const show = definition('app/controllers/users_controller.rb', 'UsersController#show', 2, 4)
const view = definition('app/views/users/show.html.erb', 'users/show.html.erb', 1, 2)
const fullNameLine = { changed: { path: 'app/models/user.rb', line: 3 } }
const helperLine = { changed: { path: 'app/helpers/users_helper.rb', line: 3 } }
/** The route that draws GET /users/:id, as the scan read it in a folder where routes.rb had two lines more above it. */
const route = (near: VicinityLink['near'], hops: number): VicinityLink => ({
  near, other: definition('config/routes.rb', 'GET /users/:id', 4, 4), direction: 'caller', hops, call: { line: 4, name: 'UsersController#show', routes: 'resources :users, only: [:show]' }, proven: true, entry: { kind: 'route', exact: true, route: { verbs: ['GET'], path: '/users/:id' } },
})
const titled = (review: Review, title: string): ReviewNode => {
  const node = review.nodes.find((entry) => entry.title === title)
  assert.ok(node, `a node titled ${title}: ${review.nodes.map((entry) => entry.title).join(', ')}`)
  return node
}
const wire = (review: Review, from: string, to: string) => {
  const edge = review.edges.find((entry) => entry.from === titled(review, from).id && entry.to === titled(review, to).id)
  return edge && [edge.kind, edge.label]
}

test('a model method a controller calls is reached from the route one step before that controller', async () => {
  const review = await prepared({
    links: [{ near: fullNameLine, other: show, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: false, entry: { kind: 'controller', exact: true } }, route({ definition: show }, 2)],
    reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 1 }],
  })
  assert.deepEqual(validateReview(review), [])
  const chain = [titled(review, 'GET /users/:id').id, titled(review, 'UsersController#show').id]
  assert.deepEqual(titled(review, 'full_name').lifecycle, { role: 'changed', hops: 1, path: 'GET /users/:id → UsersController#show → User#full_name', origin: { kind: 'route', label: 'GET /users/:id', exact: true, chain } } satisfies ReviewLifecycle)

  // The route is a node of its own, unchanged, where routes.rb draws it at this commit.
  const drawn = titled(review, 'GET /users/:id')
  const routes = head['config/routes.rb'] as string
  assert.deepEqual(
    [drawn.kind, drawn.change, drawn.subtitle, drawn.entry, drawn.lifecycle, drawn.anchors],
    ['context', 'unchanged', 'config/routes.rb', { kind: 'route', exact: true, route: { verbs: ['GET'], path: '/users/:id' } }, { role: 'caller', hops: 2 }, [{ fileId: 'config/routes.rb', side: 'added', startLine: 2, endLine: 2, hash: hashLines(routes, 2, 2) }]],
  )
  assert.equal(drawn.summary, 'Unchanged. A request enters here: config/routes.rb sends GET /users/:id to UsersController#show.')
  for (const route of [{ verbs: [], path: '/users/:id' }, { verbs: ['get'], path: '/users/:id' }, { verbs: ['GET'], path: 'users' }]) {
    const broken = { ...review, nodes: review.nodes.map((node) => (node === drawn ? { ...node, entry: { ...node.entry!, route } } : node)) }
    assert.equal(validateReview(broken).length, 1, JSON.stringify(route))
  }
  assert.equal(titled(review, 'UsersController#show').change, 'unchanged')
  assert.deepEqual(wire(review, 'full_name', 'UsersController#show'), ['called-by', 'from line 3, found by name'])
  assert.deepEqual(wire(review, 'UsersController#show', 'GET /users/:id'), ['called-by', 'routes it from line 2'])
})

test('a helper a view calls is reached through the view, the action that renders it by convention, and its route', async () => {
  const review = await prepared({
    links: [
      { near: helperLine, other: view, direction: 'caller', hops: 1, call: { line: 1, name: 'display_name' }, proven: false },
      { near: { definition: view }, other: show, direction: 'caller', hops: 2, call: { line: 2, name: 'users/show.html.erb', renders: 'convention' }, proven: true, entry: { kind: 'controller', exact: true } },
      route({ definition: show }, 3),
    ],
    reach: [{ changed: helperLine.changed, symbol: 'UsersHelper#display_name', hops: 2 }],
  })
  assert.deepEqual(validateReview(review), [])
  const chain = ['GET /users/:id', 'UsersController#show', 'users/show.html.erb'].map((title) => titled(review, title).id)
  assert.deepEqual(titled(review, 'display_name').lifecycle, { role: 'changed', hops: 2, path: 'GET /users/:id → UsersController#show → users/show.html.erb → UsersHelper#display_name', origin: { kind: 'route', label: 'GET /users/:id', exact: true, chain } })
  // The view is one definition: the whole file.
  assert.deepEqual(titled(review, 'users/show.html.erb').anchors.map(({ startLine, endLine }) => [startLine, endLine]), [[1, 2]])
  assert.deepEqual(wire(review, 'display_name', 'users/show.html.erb'), ['called-by', 'from line 1, found by name'])
  assert.deepEqual(wire(review, 'users/show.html.erb', 'UsersController#show'), ['called-by', 'renders it by convention'])
})

test('changed code says how far the scan looked when no route reaches it, on the node and, with nothing wired, as why', async () => {
  const legacy = definition('app/helpers/legacy_helper.rb', 'LegacyHelper#legacy_name', 2, 4)
  const limited = await prepared({
    links: [{ near: fullNameLine, other: legacy, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: false }],
    reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: LIFE_CYCLE.hops, stopped: 'limit' }],
  })
  assert.deepEqual(titled(limited, 'full_name').lifecycle, { role: 'changed', hops: 1, path: `No route reaches it within ${LIFE_CYCLE.hops} calls: the way out stops at LegacyHelper#legacy_name.`, none: 'limit' })

  const ended = await prepared({
    links: [{ near: fullNameLine, other: legacy, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: false }],
    reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 1 }],
  })
  assert.deepEqual(titled(ended, 'full_name').lifecycle, { role: 'changed', hops: 1, path: 'No route reaches it: nothing the scan could find calls LegacyHelper#legacy_name.', none: 'no-callers' })

  const alone = await prepared({ links: [], reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 0 }] })
  const fullName = titled(alone, 'full_name')
  assert.deepEqual(fullName.lifecycle, { role: 'changed', hops: 0, path: 'No route reaches it: the scan found nothing that calls it.', none: 'no-callers' })
  assert.equal(fullName.unwired, 'No route reaches it: the scan found nothing that calls it, and no test in this change reaches it.')
  assert.deepEqual(validateReview(alone), [])
})

test('a changed action Rails sends failing requests to has its exceptions app one step before it', async () => {
  const changed = { changed: { path: 'app/controllers/errors_controller.rb', line: 3 } }
  const review = await prepared({
    links: [{
      near: changed, other: definition('config/application.rb', 'config.exceptions_app', 3, 5), direction: 'caller', hops: 1, call: { line: 3, name: 'ErrorsController#show', routes: 'config.exceptions_app = ->(env) {' }, proven: true, entry: { kind: 'exceptions-app', exact: true },
    }],
    entries: [{ ...changed, entry: { kind: 'controller', exact: true } }],
    reach: [{ ...changed, symbol: 'ErrorsController#show', hops: 0 }],
  })
  assert.deepEqual(validateReview(review), [])
  const action = review.nodes.find((node) => node.subtitle === 'app/controllers/errors_controller.rb')!
  const app = titled(review, 'config.exceptions_app')
  // The action is its own way in, so its chain holds only the door one step before it.
  assert.deepEqual(action.lifecycle, { role: 'changed', hops: 0, path: 'A failing request → config.exceptions_app → ErrorsController#show', origin: { kind: 'exceptions-app', label: 'config.exceptions_app', exact: true, chain: [app.id] } })
  assert.deepEqual([app.entry, app.anchors.map(({ startLine, endLine }) => [startLine, endLine])], [{ kind: 'exceptions-app', exact: true }, [[3, 5]]])
  assert.equal(app.summary, 'Unchanged. A request enters here: Rails sends a request that raised to its exceptions app, ErrorsController#show.')
})

test('a schema a Pi extension registers is reached from where its package.json lists the extension', async () => {
  const manifest = lines('{', '  "name": "search",', '  "pi": {', '    "extensions": [', '      "./index.ts"', '    ]', '  }', '}')
  const extension = (intent: string) => lines('const SearchParams = Type.Object({', `  intent: ${intent},`, '});', '', 'export default function searchExtension(pi) {', '  pi.registerTool({ name: "search", parameters: SearchParams });', '}')
  const trees = { base: { 'package.json': manifest, 'src/extension.ts': extension('StringEnum(["a"])') }, head: { 'package.json': manifest, 'src/extension.ts': extension('Type.Enum(["a"])') } }
  const changed = { changed: { path: 'src/extension.ts', line: 2 } }
  const searchExtension = definition('src/extension.ts', 'searchExtension', 5, 7)
  const review = await prepared(
    {
      links: [
        { near: changed, other: searchExtension, direction: 'caller', hops: 1, call: { line: 6, name: 'SearchParams', reference: true }, proven: true },
        { near: { definition: searchExtension }, other: definition('package.json', './index.ts', 5, 5), direction: 'caller', hops: 2, call: { line: 5, name: 'searchExtension', routes: '"./index.ts"' }, proven: true, entry: { kind: 'extension', exact: true } },
      ],
      reach: [{ ...changed, symbol: 'SearchParams', hops: 1 }],
    },
    trees,
  )
  assert.deepEqual(validateReview(review), [])
  assert.deepEqual(titled(review, 'SearchParams').lifecycle, { role: 'changed', hops: 1, path: 'Pi extension ./index.ts → searchExtension → SearchParams', origin: { kind: 'extension', label: 'Pi extension ./index.ts', exact: true, chain: [titled(review, './index.ts').id, titled(review, 'searchExtension').id] } })
  assert.deepEqual(wire(review, 'searchExtension', './index.ts'), ['called-by', 'loads it from line 5'])
  assert.equal(titled(review, './index.ts').summary, 'Unchanged. A request enters here: Pi loads ./index.ts as an extension, as package.json says, and calls searchExtension.')
})

test('changed code counts the other ways in beside the nearest, each a door or an entry with no door', async () => {
  const review = await prepared({
    links: [
      { near: fullNameLine, other: show, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: true, entry: { kind: 'controller', exact: true } },
      route({ definition: show }, 2),
      { near: { definition: show }, other: definition('config/application.rb', 'config.exceptions_app', 3, 5), direction: 'caller', hops: 2, call: { line: 3, name: 'UsersController#show', routes: 'config.exceptions_app = ->(env) {' }, proven: true, entry: { kind: 'exceptions-app', exact: true } },
    ],
    reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 1 }],
  })
  assert.deepEqual(validateReview(review), [])
  assert.deepEqual(titled(review, 'full_name').lifecycle?.origin, { kind: 'route', label: 'GET /users/:id', exact: true, chain: [titled(review, 'GET /users/:id').id, titled(review, 'UsersController#show').id], more: 1 })
})

test('changed code only tests call says so, in its reason and its words', async () => {
  const review = await prepared({ links: [], reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 0, callers: 0, testCallers: 2 }] })
  assert.deepEqual(titled(review, 'full_name').lifecycle, { role: 'changed', hops: 0, path: 'No route reaches it: only tests call it.', none: 'only-tests' })
  // Code outside tests calls it too, though none the review can show: that is no caller found, not only tests.
  const both = await prepared({ links: [], reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 0, callers: 3, testCallers: 2 }] })
  assert.equal(titled(both, 'full_name').lifecycle?.none, 'no-callers')
})

test('a way in stopped by the time the scans had says so as its reason', async () => {
  const review = await prepared({
    links: [{ near: fullNameLine, other: definition('app/helpers/legacy_helper.rb', 'LegacyHelper#legacy_name', 2, 4), direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: false }],
    reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 1, stopped: 'time' }],
  })
  assert.equal(titled(review, 'full_name').lifecycle?.none, 'time')
})

test('changed code the scan did not look around says nothing was looked for, and a review with no scan says nothing at all', async () => {
  const review = await prepared({ links: [], reach: [{ changed: fullNameLine.changed, symbol: 'User#full_name', hops: 0 }] })
  assert.deepEqual(titled(review, 'display_name').lifecycle, { role: 'changed', hops: 0, none: 'not-looked' })
  assert.deepEqual(validateReview(review), [])
  const unscanned = await prepared()
  assert.ok(unscanned.nodes.every((node) => node.lifecycle === undefined))
})

test('a way in names nodes of the review, and why none was found is one of the reasons', async () => {
  const review = await prepared({
    links: [{ near: fullNameLine, other: show, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: true, entry: { kind: 'controller', exact: true } }, route({ definition: show }, 2)],
  })
  const fullName = titled(review, 'full_name')
  const placed = (lifecycle: unknown) => validateReview({ ...review, nodes: review.nodes.map((node) => (node === fullName ? { ...node, lifecycle } : node)) })
  const origin = fullName.lifecycle!.origin!
  assert.deepEqual(placed({ role: 'changed', hops: 1, none: 'only-tests' }), [])
  for (const wrong of [
    { role: 'changed', hops: 1, origin: { ...origin, chain: ['nowhere'] } },
    { role: 'changed', hops: 1, origin: { ...origin, kind: 'Route!' } },
    { role: 'changed', hops: 1, origin: { ...origin, more: -1 } },
    { role: 'changed', hops: 1, none: 'gave-up' },
    { role: 'changed', hops: 1, origin, none: 'limit' },
  ]) {
    assert.equal(placed(wrong).length, 1, JSON.stringify(wrong))
  }
})

test('a story of units tells the change alone: tests and context in no step still make a valid review', async () => {
  const review = await prepared({
    links: [{ near: fullNameLine, other: show, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: true, entry: { kind: 'controller', exact: true } }],
  })
  const fullName = titled(review, 'full_name')
  assert.ok(review.nodes.some((node) => node.kind === 'context'), 'the controller that calls it')
  const story: Review['story'] = [
    { id: 's1', kind: 'outcome', title: 'Say Mr or Ms first', text: 'A full name starts with a title.', focus: [], criteria: [] },
    { id: 's2', kind: 'walk', title: 'The full name', text: 'It puts the title first.', focus: [fullName.id], criteria: [], unit: 'u1' },
  ]
  assert.deepEqual(validateReview({ ...review, story }), [])
})

test('changed code says how far its entry is and the way a request takes; only context is a caller or a callee', async () => {
  const review = await prepared()
  const fullName = titled(review, 'full_name')
  const placed = (lifecycle: unknown) => validateReview({ ...review, nodes: review.nodes.map((node) => (node === fullName ? { ...node, lifecycle } : node)) })

  assert.deepEqual(placed({ role: 'changed', hops: 2, path: 'GET /users/:id → UsersController#show → full_name' } satisfies ReviewLifecycle), [])
  assert.deepEqual(placed({ role: 'changed', hops: 0 }), [], 'the entry itself, with no words')
  for (const wrong of [{ role: 'caller', hops: 1 }, { role: 'changed', hops: -1 }, { role: 'changed', hops: 2, path: '' }, { role: 'changed', hops: 2, path: 'GET\u0007/users' }]) {
    assert.equal(placed(wrong).length, 1, JSON.stringify(wrong))
  }
})
