import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DOWNLOADS, downloadsFrom, FEED, releaseNames, updateFeed } from '../../scripts/package/feed.ts'

test('a release is published under names that carry its version and, for Intel, its chip', () => {
  assert.deepEqual(releaseNames('0.1.19', 'aarch64'), {
    dmg: 'hobkin-alpha-0.1.19.dmg',
    archive: 'hobkin-0.1.19-aarch64.app.tar.gz',
  })
  assert.deepEqual(releaseNames('0.1.19', 'x86_64'), {
    dmg: 'hobkin-alpha-0.1.19-intel.dmg',
    archive: 'hobkin-0.1.19-x86_64.app.tar.gz',
  })
  assert.equal(FEED, 'latest.json')
})

test("the feed names the version and, for each chip built, where its archive is and the archive's signature", () => {
  const published = { version: '0.1.19', notes: 'First alpha.', publishedAt: '2026-11-14T03:00:00.000Z' }

  assert.deepEqual(updateFeed({ ...published, signatures: { aarch64: ' c2lnLWFybQ==\n', x86_64: 'c2lnLWludGVs' } }), {
    version: '0.1.19',
    notes: 'First alpha.',
    pub_date: '2026-11-14T03:00:00.000Z',
    platforms: {
      'darwin-aarch64': { url: `${DOWNLOADS}/hobkin-0.1.19-aarch64.app.tar.gz`, signature: 'c2lnLWFybQ==' },
      'darwin-x86_64': { url: `${DOWNLOADS}/hobkin-0.1.19-x86_64.app.tar.gz`, signature: 'c2lnLWludGVs' },
    },
  })
  assert.deepEqual(Object.keys(updateFeed({ ...published, signatures: { aarch64: 'c2ln' } }).platforms), ['darwin-aarch64'], 'a chip that was not built is left out')
})

test('a feed is never written for a version that is not three numbers, with an empty signature, or for no chip at all', () => {
  const good = { version: '0.1.19', notes: '', publishedAt: '2026-11-14T03:00:00.000Z', signatures: { aarch64: 'c2ln' } }

  assert.throws(() => updateFeed({ ...good, version: 'v0.1' }), /version/)
  assert.throws(() => releaseNames('../0.1.19', 'aarch64'), /version/)
  assert.throws(() => updateFeed({ ...good, signatures: { aarch64: '  ' } }), /signature/)
  assert.throws(() => updateFeed({ ...good, signatures: {} }), /no chip/)
})

test("the files are published beside the feed the release config's updater reads, its one endpoint", () => {
  assert.equal(DOWNLOADS, 'https://hobkin.dev/downloads')
  assert.equal(downloadsFrom({ plugins: { updater: { endpoints: ['https://downloads.example.invalid/hobkin/latest.json'] } } }), 'https://downloads.example.invalid/hobkin')
  assert.throws(() => downloadsFrom({ plugins: { updater: { endpoints: ['https://example.invalid/feed.json'] } } }), /latest\.json/)
  assert.throws(() => downloadsFrom({ plugins: { updater: { endpoints: ['https://a.example.invalid/latest.json', 'https://b.example.invalid/latest.json'] } } }), /one endpoint/)
  assert.throws(() => downloadsFrom({}), /one endpoint/)
})
