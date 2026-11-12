import assert from 'node:assert/strict'
import { test } from 'node:test'
import { captureChange } from '../review/capture.ts'
import { lines, memoryReader, type Tree } from '../review/memory.ts'
import { prepareReview } from '../review/prepare.ts'
import type { Review, ReviewLifecycle } from '../review/types.ts'
import { validateReview } from '../review/validate.ts'
import type { Vicinity } from '../review/vicinity.ts'

// A Rails app in a few files: GET /users/:id reaches UsersController#show, which shows the user's full name, and the
// change puts Mr or Ms before it.
const unchanged: Tree = {
  'config/routes.rb': lines('Rails.application.routes.draw do', '  resources :users, only: [:show]', 'end'),
  'app/controllers/users_controller.rb': lines('class UsersController < ApplicationController', '  def show', '    @name = User.find(params[:id]).full_name', '  end', 'end'),
}
const base: Tree = { ...unchanged, 'app/models/user.rb': lines('class User < ApplicationRecord', '  def full_name', '    "#{first} #{last}"', '  end', 'end') }
const head: Tree = { ...unchanged, 'app/models/user.rb': lines('class User < ApplicationRecord', '  def full_name', '    "#{title} #{first} #{last}"', '  end', 'end') }

async function prepared(vicinity?: Vicinity): Promise<Review> {
  return prepareReview({
    id: 'r1',
    change: { project: 'shop', item: 'a1b2c3', title: 'Say Mr or Ms first', branch: 'hobkin/a1b2c3-say-mr-or-ms-first' },
    capture: await captureChange(memoryReader(base, head), 'base', 'head'),
    spec: null,
    readHead: async (path) => (typeof head[path] === 'string' ? (head[path] as string) : null),
    ...(vicinity ? { vicinity } : {}),
  })
}

test('a story of units tells the change alone: tests and context in no step still make a valid review', async () => {
  const review = await prepared({
    links: [{ near: { changed: { path: 'app/models/user.rb', line: 3 } }, other: { path: 'app/controllers/users_controller.rb', symbol: 'UsersController#show', startLine: 2, endLine: 4 }, direction: 'caller', hops: 1, call: { line: 3, name: 'full_name' }, proven: true, entry: { kind: 'controller', exact: true } }],
  })
  const fullName = review.nodes.find((node) => node.title === 'full_name')!
  assert.ok(review.nodes.some((node) => node.kind === 'context'), 'the controller that calls it')
  const story: Review['story'] = [
    { id: 's1', kind: 'outcome', title: 'Say Mr or Ms first', text: 'A full name starts with a title.', focus: [], criteria: [] },
    { id: 's2', kind: 'walk', title: 'The full name', text: 'It puts the title first.', focus: [fullName.id], criteria: [], unit: 'u1' },
  ]
  assert.deepEqual(validateReview({ ...review, story }), [])
})

test('changed code says how far its entry is and the way a request takes; only context is a caller or a callee', async () => {
  const review = await prepared()
  const fullName = review.nodes.find((node) => node.title === 'full_name')!
  const placed = (lifecycle: unknown) => validateReview({ ...review, nodes: review.nodes.map((node) => (node === fullName ? { ...node, lifecycle } : node)) })

  assert.deepEqual(placed({ role: 'changed', hops: 2, path: 'GET /users/:id → UsersController#show → full_name' } satisfies ReviewLifecycle), [])
  assert.deepEqual(placed({ role: 'changed', hops: 0 }), [], 'the entry itself, with no words')
  for (const wrong of [{ role: 'caller', hops: 1 }, { role: 'changed', hops: -1 }, { role: 'changed', hops: 2, path: '' }, { role: 'changed', hops: 2, path: 'GET\u0007/users' }]) {
    assert.equal(placed(wrong).length, 1, JSON.stringify(wrong))
  }
})
