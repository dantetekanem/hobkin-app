import assert from 'node:assert/strict'
import { test } from 'node:test'
import { endedAs, setupMark, setupWanted, tourFollows, unfinishedStart } from '../src/features/onboarding/first-run.ts'

test('the setup shows on the first run, and not once it has been seen', () => {
  assert.equal(setupWanted(null, ''), true)
  assert.equal(setupWanted('seen', ''), false)
  assert.equal(setupWanted('something else', ''), true, 'only the setup\'s own mark counts')
})

test('?setup=1 in the address shows it whatever was saved', () => {
  assert.equal(setupWanted('seen', '?setup=1'), true)
  assert.equal(setupWanted('seen', '?theme=dark&setup=1'), true)
  assert.equal(setupWanted('seen', '?setup=0'), false)
  assert.equal(setupWanted('seen', '?other=1'), false)
})

test('a setup told to the end with no account comes back, keeping whose computer it is, and skipping or an account finishes it', () => {
  assert.equal(endedAs('done', false), 'unfinished')
  assert.equal(endedAs('done', true), 'finished')
  assert.equal(endedAs('skipped', false), 'finished')
  assert.equal(endedAs('skipped', true), 'finished')

  assert.equal(setupMark('unfinished', 'work'), 'unfinished:work')
  assert.equal(setupMark('unfinished', undefined), 'unfinished')
  assert.equal(setupMark('finished', 'work'), 'seen')
  assert.equal(setupWanted('unfinished:work', ''), true)
  assert.equal(setupWanted('unfinished', ''), true)
})

test("a setup that ends while Pi is missing is unfinished, told to the end or skipped, so it comes back and no tour starts", () => {
  // "if pi is not installed it cant move": Pi is the one step the setup cannot do without.
  for (const ended of ['done', 'skipped'] as const) {
    for (const account of [true, false]) assert.equal(endedAs(ended, account, false), 'unfinished', `${ended}, account ${account}`)
    assert.equal(tourFollows(ended, endedAs(ended, true, false)), false)
  }
  // With Pi there, the account decides as before.
  assert.equal(endedAs('done', true, true), 'finished')
  assert.equal(endedAs('skipped', false, true), 'finished')
})

test('an unfinished setup opens again at the account step, with the kind of computer it was', () => {
  assert.deepEqual(unfinishedStart('unfinished:work'), { computer: 'work' })
  assert.deepEqual(unfinishedStart('unfinished:personal'), { computer: 'personal' })
  assert.deepEqual(unfinishedStart('unfinished'), { computer: null })
  assert.equal(unfinishedStart('seen'), null)
  assert.equal(unfinishedStart(null), null)
  assert.equal(unfinishedStart('unfinished:other'), null, 'a mark that is not the setup\'s own is not trusted')
})

test('the tour starts only for a finished setup that was told to the end', () => {
  assert.equal(tourFollows('done', 'finished'), true)
  assert.equal(tourFollows('done', 'unfinished'), false)
  assert.equal(tourFollows('skipped', 'finished'), false)
})
