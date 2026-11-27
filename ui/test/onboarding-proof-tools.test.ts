import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lineAfterProofTools } from '../src/features/onboarding/proof-tools-line.ts'

test('once the TLA+ tools are set up the story says nothing more, whatever hobkin reported', () => {
  const report =
    'Installed Java 21.0.13.1+2 into /tmp/home/tools/java and TLC 1.7.4 into /tmp/home/tools/tla/tla2tools.jar, each checked by its pinned checksum. The download of TLAPS 1.6.0-pre failed with HTTP 404. hobkin kept no TLAPS.'
  assert.equal(lineAfterProofTools({ ok: true, message: report }), null)
})

test('a failed setup is one short line with no paths, versions or checksums, and says where to try again', () => {
  const line = lineAfterProofTools({ ok: false, message: 'The download of Java 21.0.13.1+2 failed: fetch failed into /tmp/home/tools/java.' })
  assert.ok(line)
  assert.doesNotMatch(line, /\/|\d+\.\d+|checksum|sha/i)
  assert.match(line, /Check this Mac/)
  assert.ok(line.length <= 110, `${line.length} characters`)
})
