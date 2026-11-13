import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setupWanted } from '../src/features/onboarding/first-run.ts'

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
