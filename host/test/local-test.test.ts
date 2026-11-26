import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inspectLocalTest } from '../src/local-test.ts'

test('local testing reads configured checkout guides and compares actual HEAD with preview of landing tip', async () => {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'local-test-')))
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim()
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.org')
    mkdirSync(join(repo, 'guides'))
    const setup = join(repo, 'guides/rpsleague-local-setup.md')
    const walkthrough = join(repo, 'guides/rpsleague-end-to-end.md')
    writeFileSync(setup, 'setup')
    writeFileSync(walkthrough, 'walkthrough')
    git('add', '.')
    git('commit', '-m', 'guides')
    const first = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', first)
    const lookup = () => repo
    const inspect = () => inspectLocalTest('rpsleague', lookup)
    assert.deepEqual(await inspect(), { repo, head: first, candidate: first, dirty: false, guides: [setup, walkthrough] })
    git('commit', '--allow-empty', '-m', 'new default')
    const second = git('rev-parse', 'HEAD')
    git('checkout', '--detach', first)
    writeFileSync(join(repo, 'extra'), 'dirty')
    assert.deepEqual(await inspect(), { repo, head: first, candidate: second, dirty: true, guides: [setup, walkthrough] })
    rmSync(setup)
    symlinkSync('/etc/hosts', setup)
    assert.deepEqual((await inspect()).guides, [null, walkthrough])
    rmSync(walkthrough)
    assert.deepEqual((await inspect()).guides, [null, null])
    assert.equal((await inspectLocalTest('rpsleague', () => null)).head, null)
    assert.equal((await inspectLocalTest('other', () => { throw Error('must not inspect unknown project') })).repo, null)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
