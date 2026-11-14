import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOWNLOADS, releaseNames, updateFeed } from '../../scripts/package/feed.ts'

test('a release is published under names that carry its version', () => {
  assert.deepEqual(releaseNames('0.1.19'), {
    dmg: 'hobkin-alpha-0.1.19.dmg',
    archive: 'hobkin-0.1.19-aarch64.app.tar.gz',
    feed: 'latest.json',
  })
})

test("the feed names the version, where its archive is and the archive's signature", () => {
  const feed = updateFeed({ version: '0.1.19', notes: 'First alpha.', publishedAt: '2026-11-14T03:00:00.000Z', signature: ' c2lnbmF0dXJl\n' })

  assert.deepEqual(feed, {
    version: '0.1.19',
    notes: 'First alpha.',
    pub_date: '2026-11-14T03:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        url: `${DOWNLOADS}/hobkin-0.1.19-aarch64.app.tar.gz`,
        signature: 'c2lnbmF0dXJl',
      },
    },
  })
  assert.equal(DOWNLOADS, 'https://api.hobkin.dev/downloads')
})

test('a feed is never written for a version that is not three numbers, or without a signature', () => {
  const good = { version: '0.1.19', notes: '', publishedAt: '2026-11-14T03:00:00.000Z', signature: 'c2ln' }

  assert.throws(() => updateFeed({ ...good, version: 'v0.1' }), /version/)
  assert.throws(() => releaseNames('../0.1.19'), /version/)
  assert.throws(() => updateFeed({ ...good, signature: '  ' }), /signature/)
})
