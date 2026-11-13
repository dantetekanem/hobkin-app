import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { hostCode } from '../src/code-age.ts'
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
