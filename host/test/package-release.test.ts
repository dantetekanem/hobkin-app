import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FEED, releaseCommand, releaseNames, releaseTag, REPOSITORY, repositoryFrom, shellLine, updateFeed } from '../../scripts/package/feed.ts'

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
  const published = { repository: 'someone/hobkin-client', version: '0.1.19', notes: 'First alpha.', publishedAt: '2026-11-14T03:00:00.000Z' }
  const assets = 'https://github.com/someone/hobkin-client/releases/download/v0.1.19'

  assert.deepEqual(updateFeed({ ...published, signatures: { aarch64: ' c2lnLWFybQ==\n', x86_64: 'c2lnLWludGVs' } }), {
    version: '0.1.19',
    notes: 'First alpha.',
    pub_date: '2026-11-14T03:00:00.000Z',
    platforms: {
      'darwin-aarch64': { url: `${assets}/hobkin-0.1.19-aarch64.app.tar.gz`, signature: 'c2lnLWFybQ==' },
      'darwin-x86_64': { url: `${assets}/hobkin-0.1.19-x86_64.app.tar.gz`, signature: 'c2lnLWludGVs' },
    },
  })
  assert.deepEqual(Object.keys(updateFeed({ ...published, signatures: { aarch64: 'c2ln' } }).platforms), ['darwin-aarch64'], 'a chip that was not built is left out')
})

test('a feed is never written for a version that is not three numbers, with an empty signature, or for no chip at all', () => {
  const good = { repository: 'someone/hobkin-client', version: '0.1.19', notes: '', publishedAt: '2026-11-14T03:00:00.000Z', signatures: { aarch64: 'c2ln' } }

  assert.throws(() => updateFeed({ ...good, version: 'v0.1' }), /version/)
  assert.throws(() => releaseNames('../0.1.19', 'aarch64'), /version/)
  assert.throws(() => updateFeed({ ...good, signatures: { aarch64: '  ' } }), /signature/)
  assert.throws(() => updateFeed({ ...good, signatures: {} }), /no chip/)
})

test("the updater's one endpoint names the GitHub repository whose latest release carries the feed", () => {
  assert.equal(REPOSITORY, 'dantetekanem/hobkin-app')
  const endpoint = (url: string) => ({ plugins: { updater: { endpoints: [url] } } })
  assert.equal(repositoryFrom(endpoint('https://github.com/someone/hobkin-client/releases/latest/download/latest.json')), 'someone/hobkin-client')
  assert.throws(() => repositoryFrom(endpoint('https://hobkin.example.invalid/downloads/latest.json')), /releases\/latest\/download\/latest\.json/)
  assert.throws(() => repositoryFrom(endpoint('https://github.com/someone/hobkin-client/releases/download/v0.1.19/latest.json')), /releases\/latest/, "one version's feed would never move on")
  const two = { plugins: { updater: { endpoints: ['https://github.com/a/b/releases/latest/download/latest.json', 'https://github.com/c/d/releases/latest/download/latest.json'] } } }
  assert.throws(() => repositoryFrom(two), /one endpoint/)
  assert.throws(() => repositoryFrom({}), /one endpoint/)
})

test('a version is released as tag v<version>, by a gh command that marks it the latest release', () => {
  assert.equal(releaseTag('0.2.2'), 'v0.2.2')
  assert.throws(() => releaseTag('0.2'), /version/)

  const command = releaseCommand({
    repository: 'someone/hobkin-client',
    version: '0.2.2',
    commit: '3167f599',
    notesFile: 'dist/release/notes.md',
    files: ['dist/release/hobkin-alpha-0.2.2.dmg', 'dist/release/latest.json'],
  })

  assert.deepEqual(command, [
    'gh', 'release', 'create', 'v0.2.2',
    '--repo', 'someone/hobkin-client',
    '--target', '3167f599',
    '--title', 'hobkin 0.2.2',
    '--notes-file', 'dist/release/notes.md',
    '--latest',
    'dist/release/hobkin-alpha-0.2.2.dmg', 'dist/release/latest.json',
  ])
  assert.equal(shellLine(command.slice(0, 10)), "gh release create v0.2.2 --repo someone/hobkin-client --target 3167f599 --title 'hobkin 0.2.2'")
  assert.equal(shellLine(['echo', "it's"]), `echo 'it'\\''s'`)
})
