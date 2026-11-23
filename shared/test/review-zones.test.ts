import assert from 'node:assert/strict'
import { test } from 'node:test'
import { zoneOf } from '../../packages/change-review/src/zones.ts'
import { captureChange } from '../review/capture.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'
import type { Review, ReviewEdge, ReviewNode } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import type { Vicinity, VicinityDefinition } from '../review/vicinity.ts'
import { withZones } from '../review/zones.ts'

async function prepared(trees: { base: Tree; head: Tree }, vicinity?: Vicinity): Promise<Review> {
  return prepareReview({
    id: 'r1',
    change: { project: 'shop', item: 'a1b2c3', title: 'Say Mr or Ms first', branch: 'hobkin/a1b2c3' },
    capture: await captureChange(memoryReader(trees.base, trees.head), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof trees.head[path] === 'string' ? (trees.head[path] as string) : null),
    ...(vicinity ? { vicinity } : {}),
  })
}

const definition = (path: string, symbol: string, startLine: number, endLine: number): VicinityDefinition => ({ path, symbol, startLine, endLine })

// GET /users/:id reaches UsersController#show, which renders users/show.html.erb, whose helper asks the user's full name.
const unchanged: Tree = {
  'config/routes.rb': lines('Rails.application.routes.draw do', '  resources :users, only: [:show]', 'end'),
  'app/controllers/users_controller.rb': lines('class UsersController < ApplicationController', '  def show', '    @user = User.find(params[:id])', '  end', 'end'),
  'app/views/users/show.html.erb': lines('<h1><%= display_name(@user) %></h1>'),
}
const rails = {
  base: {
    ...unchanged,
    'app/models/user.rb': lines('class User < ApplicationRecord', '  def full_name', '    "#{first} #{last}"', '  end', 'end'),
    'app/helpers/users_helper.rb': lines('module UsersHelper', '  def display_name(user)', '    user.name', '  end', 'end'),
    'test/models/user_test.rb': lines('class UserTest < ActiveSupport::TestCase', '  def test_full_name', '    assert_equal "Ada Lovelace", users(:ada).full_name', '  end', 'end'),
  },
  head: {
    ...unchanged,
    'app/models/user.rb': lines('class User < ApplicationRecord', '  def full_name', '    "#{title} #{first} #{last}"', '  end', 'end'),
    'app/helpers/users_helper.rb': lines('module UsersHelper', '  def display_name(user)', '    user.full_name', '  end', 'end'),
    'test/models/user_test.rb': lines('class UserTest < ActiveSupport::TestCase', '  def test_full_name', '    assert_equal "Ms Ada Lovelace", users(:ada).full_name', '  end', 'end'),
  },
}

test('every node names its zone, and the review lists its zones in the order a request passes them, a test after the code it mirrors', async () => {
  const show = definition('app/controllers/users_controller.rb', 'UsersController#show', 2, 4)
  const view = definition('app/views/users/show.html.erb', 'users/show.html.erb', 1, 1)
  const review = await prepared(rails, {
    links: [
      { near: { changed: { path: 'app/helpers/users_helper.rb', line: 3 } }, other: view, direction: 'caller', hops: 1, call: { line: 1, name: 'display_name' }, proven: false },
      { near: { definition: view }, other: show, direction: 'caller', hops: 2, call: { line: 2, name: 'users/show.html.erb', renders: 'convention' }, proven: true, entry: { kind: 'controller', exact: true } },
      { near: { definition: show }, other: definition('config/routes.rb', 'GET /users/:id', 2, 2), direction: 'caller', hops: 3, call: { line: 2, name: 'UsersController#show', routes: 'resources :users, only: [:show]' }, proven: true, entry: { kind: 'route', exact: true, route: { verbs: ['GET'], path: '/users/:id' } } },
      { near: { changed: { path: 'app/models/user.rb', line: 3 } }, other: definition('app/helpers/users_helper.rb', 'UsersHelper#display_name', 2, 4), direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: false },
    ],
  })
  assert.deepEqual(validateReview(review), [])
  // The change review's rule names each zone; the request passes them from the route to the model, then its test.
  const inOrder = ['config/routes.rb', 'app/controllers/users_controller.rb', 'app/views/users/show.html.erb', 'app/helpers/users_helper.rb', 'app/models/user.rb', 'test/models/user_test.rb']
  assert.deepEqual(review.zones?.map((zone) => [zone.id, zone.label]), inOrder.map((path) => [zoneOf(path).id, zoneOf(path).label]))
  const zonesAt = (path: string) => review.nodes.filter((node) => node.subtitle === path).map((node) => node.zone)
  assert.deepEqual(zonesAt('app/models/user.rb'), [zoneOf('app/models/user.rb').id])
  assert.deepEqual(zonesAt('test/models/user_test.rb'), [zoneOf('test/models/user_test.rb', 'test').id])
  assert.ok(review.nodes.every((node) => node.zone && review.zones!.some((zone) => zone.id === node.zone)), 'every node')
})

test('a test zone no code mirrors follows the code its tests cover', async () => {
  const doing = (body: string) => lines("import { remember } from './notes.ts';", 'export function doingAfter(previous: string) {', `  remember(${body});`, '  return previous;', '}')
  const flow = lines("import { doingAfter } from '../../src/doing.ts';", "test('a turn says what it does', () => {", "  expect(doingAfter('idle')).toBe('idle');", '});')
  const notes = lines('export function remember(text: string) {', '  return text;', '}')
  const review = await prepared(
    { base: { 'src/doing.ts': doing('previous'), 'src/notes.ts': notes }, head: { 'src/doing.ts': doing('`was ${previous}`'), 'src/notes.ts': notes, 'test/e2e/flow.test.ts': flow } },
    { links: [{ near: { changed: { path: 'src/doing.ts', line: 3 } }, other: definition('src/notes.ts', 'remember', 1, 3), direction: 'callee', hops: 1, call: { line: 3, name: 'remember' }, proven: true }] },
  )
  assert.deepEqual(validateReview(review), [])
  assert.deepEqual(review.zones?.map((zone) => zone.id), ['src/doing.ts', 'test/e2e/flow.test.ts', 'src/notes.ts'].map((path) => zoneOf(path).id))
})

test("a node's zone is one of the review's, each zone is listed once, and a review from before zones is still valid", async () => {
  const review = await prepared(rails)
  const zones = review.zones!
  assert.deepEqual(validateReview({ ...review, zones: undefined, nodes: review.nodes.map(({ zone: _zone, ...node }) => node) }), [])
  assert.equal(validateReview({ ...review, nodes: review.nodes.map((node, index) => (index === 0 ? { ...node, zone: 'nowhere' } : node)) }).length, 1)
  assert.equal(validateReview({ ...review, zones: [...zones, zones[0]!] }).length, 1)
  assert.equal(validateReview({ ...review, zones: [{ ...zones[0]!, label: '' }, ...zones.slice(1)] }).length, 1)
})

test('zones follow the ways in, one way to its end before the next, even when a zone is reached at several depths', () => {
  const node = (id: string, kind: ReviewNode['kind'], subtitle: string, entry?: ReviewNode['entry']): ReviewNode => ({ id, kind, title: id, subtitle, change: kind === 'context' ? 'unchanged' : 'modified', summary: '', anchors: [], position: { x: 0, y: 0 }, ...(entry ? { entry } : {}) })
  const wire = (kind: ReviewEdge['kind'], from: string, to: string): ReviewEdge => ({ id: `${kind}:${from}>${to}`, from, to, kind, certainty: 'host' })
  const order = (nodes: ReviewNode[], edges: ReviewEdge[]) => withZones(nodes, edges).zones.map((zone) => zone.id)
  const zonesOf = (...paths: string[]) => paths.map((path) => zoneOf(path).id)

  // Rails: a route reaches the controller and the model; a job and a mailer reach the model too; the model calls a helper.
  const rails = [
    node('u1', 'code', 'app/models/review.rb'),
    node('u2', 'code', 'app/models/review.rb'),
    node('v1', 'context', 'app/controllers/reviews_controller.rb', { kind: 'controller', exact: true }),
    node('v2', 'context', 'config/routes.rb', { kind: 'route', exact: true }),
    node('v3', 'context', 'app/jobs/rebuild_labels_job.rb', { kind: 'job', exact: true }),
    node('v4', 'context', 'app/helpers/score_helper.rb'),
    node('v5', 'context', 'app/mailers/review_mailer.rb', { kind: 'mailer', exact: true }),
  ]
  const railsWires = [wire('uses', 'u2', 'u1'), wire('called-by', 'u1', 'v1'), wire('called-by', 'v1', 'v2'), wire('called-by', 'u2', 'v3'), wire('calls', 'u1', 'v4'), wire('called-by', 'u1', 'v5')]
  assert.deepEqual(order(rails, railsWires), zonesOf('config/routes.rb', 'app/controllers/reviews_controller.rb', 'app/jobs/rebuild_labels_job.rb', 'app/mailers/review_mailer.rb', 'app/models/review.rb', 'app/helpers/score_helper.rb'))

  // Node: an import line in the helper's own file uses the changed constant, so the helper is also reached first.
  const js = [
    node('u1', 'code', 'src/config.js'),
    node('u2', 'code', 'src/helpers/score.js'),
    node('u3', 'code', 'src/legacy.js'),
    node('u4', 'code', 'src/services/sync.js'),
    node('v1', 'context', 'src/services/reviews.js'),
    node('v2', 'context', 'src/handlers/reviews.js'),
    node('v3', 'context', 'src/server.js', { kind: 'route', exact: true }),
    node('v4', 'context', 'src/events.js', { kind: 'listener', exact: false }),
    node('v5', 'context', 'src/helpers/score.js'),
  ]
  const jsWires = [wire('uses', 'u2', 'u1'), wire('called-by', 'u2', 'v1'), wire('called-by', 'v1', 'v2'), wire('called-by', 'v2', 'v3'), wire('called-by', 'u4', 'v4'), wire('called-by', 'u1', 'v5')]
  assert.deepEqual(order(js, jsWires), zonesOf('src/server.js', 'src/handlers/reviews.js', 'src/services/reviews.js', 'src/helpers/score.js', 'src/config.js', 'src/events.js', 'src/services/sync.js', 'src/legacy.js'))
})
