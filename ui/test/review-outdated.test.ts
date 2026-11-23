import assert from 'node:assert/strict'
import { test } from 'node:test'
import { outdatedNotice } from '../src/features/review/panel/outdated.ts'

const BASE = 'a66f8c2'.padEnd(40, '0')
const HEAD = 'c38b753'.padEnd(40, '0')
const built = { base: BASE, head: HEAD }
const standing = { phase: null, head: HEAD }

test('a review of its change as it stands says nothing', () => {
  assert.equal(outdatedNotice(built, standing), null)
  assert.equal(outdatedNotice(built, { ...standing, startsAt: BASE }), null, 'built from where the change starts')
  assert.equal(outdatedNotice(built, { phase: null, head: null }), null, 'nothing is known of where the change is')
})

test('a review built for an older commit says so, with both commits', () => {
  const moved = outdatedNotice(built, { phase: null, head: '06740a3'.padEnd(40, '0') })

  assert.deepEqual(moved, { rebuilding: false, words: 'Outdated. Built for c38b753, and the change is now at 06740a3.' })
})

test('a review built from another start than its change has now says so, with both commits', () => {
  const elsewhere = outdatedNotice(built, { ...standing, startsAt: 'e61c0fb'.padEnd(40, '0') })

  assert.deepEqual(elsewhere, { rebuilding: false, words: 'Outdated. Built from a66f8c2, and the change starts at e61c0fb, so it does not show the change as it is.' })
})

test('while a newer review is being built, the notice says that instead', () => {
  const rebuilding = outdatedNotice(built, { phase: 'reading', head: HEAD, startsAt: 'e61c0fb'.padEnd(40, '0') })

  assert.deepEqual(rebuilding, { rebuilding: true, words: 'Building the review again for c38b753. This one stays open until it is ready.' })
})
