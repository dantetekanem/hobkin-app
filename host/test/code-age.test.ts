import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { hostCode, ownRoots, shouldRestart } from '../src/code-age.ts'
import { temporaryDirectory } from './support.ts'

test('a host says when the code on disk is newer than the code it started with, and how many files changed', (t) => {
  const folder = temporaryDirectory(t)
  mkdirSync(join(folder, 'review'), { recursive: true })
  mkdirSync(join(folder, 'node_modules', 'x'), { recursive: true })
  const at = (name: string, when: number) => {
    writeFileSync(join(folder, name), '')
    utimesSync(join(folder, name), when / 1000, when / 1000)
  }
  const started = Date.parse('2026-11-12T20:56:00Z')
  at('host.ts', started - 60_000)
  at('review/floor.ts', started + 60_000)
  at('review/prompt.md', started + 120_000)
  // Not code the host runs.
  at('notes.txt', started + 300_000)
  at('node_modules/x/index.js', started + 300_000)

  assert.deepEqual(hostCode(started, [folder]), { startedAt: '2026-11-12T20:56:00.000Z', changed: 2, newestAt: '2026-11-12T20:58:00.000Z' })
  assert.deepEqual(hostCode(started + 600_000, [folder]), { startedAt: '2026-11-12T21:06:00.000Z', changed: 0, newestAt: null }, 'a host started after the last change runs what is on disk')
  assert.equal(hostCode(started, [join(folder, 'missing')]).changed, 0)
})

test("an integration's host code counts as the host's own, and its window code does not", (t) => {
  const repo = temporaryDirectory(t)
  const started = Date.parse('2026-11-12T20:56:00Z')
  const at = (path: string, when: number) => {
    const file = join(repo, path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '')
    utimesSync(file, when / 1000, when / 1000)
  }
  at('integrations/forge/host.ts', started + 60_000)
  at('integrations/forge/host/pulls.ts', started + 120_000)
  at('integrations/forge/integration.ts', started - 60_000)
  // The window loads these itself, and a host never runs them.
  at('integrations/forge/window/home.ts', started + 300_000)
  at('integrations/forge/test/home.test.ts', started + 300_000)

  assert.deepEqual(hostCode(started, ownRoots(repo)), { startedAt: '2026-11-12T20:56:00.000Z', changed: 2, newestAt: '2026-11-12T20:58:00.000Z' })
})

test('a host restarts itself for newer code only when it is kept by the app, nothing is running, and the code has settled', () => {
  const quiet = { changed: 3, newestAt: '2026-11-12T22:00:00.000Z', kept: true, busy: false, now: Date.parse('2026-11-12T22:02:00.000Z') }
  assert.equal(shouldRestart(quiet), true)
  assert.equal(shouldRestart({ ...quiet, changed: 0, newestAt: null }), false, 'it runs what is on disk')
  assert.equal(shouldRestart({ ...quiet, busy: true }), false, 'an agent, a review or a chat turn is running: nothing is stopped for this')
  assert.equal(shouldRestart({ ...quiet, kept: false }), false, 'a host somebody runs by hand would not come back')
  assert.equal(shouldRestart({ ...quiet, now: Date.parse('2026-11-12T22:00:30.000Z') }), false, 'files are still being changed')
})
