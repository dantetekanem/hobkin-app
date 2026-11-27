import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { test } from 'node:test'
import { claudeStatus, findClaude } from '../src/claude-code/install.ts'
import { temporaryDirectory } from './support.ts'

type Answer = { stdout: string } | { error: Error }
const fakeRun = (answers: Record<string, Answer>, calls: string[][] = []) => (file: string, args: readonly string[], _options: unknown, done: (error: Error | null, stdout: string, stderr: string) => void) => {
  calls.push([file, ...args])
  const answer = answers[args.join(' ')] ?? { error: new Error('unexpected') }
  if ('error' in answer) done(answer.error, '', '')
  else done(null, answer.stdout, '')
}

test('finds claude, its version and its sign-in', async (t) => {
  const folder = temporaryDirectory(t)
  const bin = join(folder, 'bin')
  const other = join(folder, 'other')
  mkdirSync(bin)
  mkdirSync(other)
  const claude = join(bin, 'claude')
  writeFileSync(claude, '#!/bin/sh\n')
  chmodSync(claude, 0o755)
  // A file that is not executable, and a folder named claude, are not it.
  writeFileSync(join(other, 'claude'), '')
  mkdirSync(join(folder, 'dir', 'claude'), { recursive: true })

  assert.equal(findClaude({ path: [join(folder, 'dir'), other, bin].join(delimiter), home: folder, places: [] }), claude)
  // The places an app launched by the system looks in when the PATH is short.
  const local = join(folder, '.local', 'bin')
  mkdirSync(local, { recursive: true })
  writeFileSync(join(local, 'claude'), '')
  chmodSync(join(local, 'claude'), 0o755)
  assert.equal(findClaude({ path: '', home: folder }), join(local, 'claude'))
  assert.equal(findClaude({ path: '', home: join(folder, 'nobody'), places: [bin] }), claude)
  assert.equal(findClaude({ path: '', home: join(folder, 'nobody'), places: [] }), null)

  const calls: string[][] = []
  const run = fakeRun(
    {
      '--version': { stdout: '2.1.323 (Claude Code)\n' },
      'auth status --json': { stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'someone@example.invalid', orgId: 'org-1', subscriptionType: 'pro', planTier: 'pro' }) },
    },
    calls,
  )
  const status = await claudeStatus({ find: () => claude, run })
  assert.deepEqual(status, { installed: true, version: '2.1.323', signedIn: true, authMethod: 'claude.ai', plan: 'pro' })
  assert.deepEqual(calls, [[claude, '--version'], [claude, 'auth', 'status', '--json']])

  // Not installed.
  assert.deepEqual(await claudeStatus({ find: () => null, run }), { installed: false, version: null, signedIn: null, authMethod: null, plan: null })

  // Signed out: no method, no plan.
  const out = fakeRun({ '--version': { stdout: '2.1.323 (Claude Code)' }, 'auth status --json': { stdout: JSON.stringify({ loggedIn: false }) } })
  assert.deepEqual(await claudeStatus({ find: () => claude, run: out }), { installed: true, version: '2.1.323', signedIn: false, authMethod: null, plan: null })

  // A failing or unreadable sign-in check says nothing about it, and the version still shows.
  const failing = fakeRun({ '--version': { stdout: '2.1.323 (Claude Code)' }, 'auth status --json': { error: new Error('boom') } })
  assert.deepEqual(await claudeStatus({ find: () => claude, run: failing }), { installed: true, version: '2.1.323', signedIn: null, authMethod: null, plan: null })
  const garbled = fakeRun({ '--version': { error: new Error('boom') }, 'auth status --json': { stdout: 'not json' } })
  assert.deepEqual(await claudeStatus({ find: () => claude, run: garbled }), { installed: true, version: null, signedIn: null, authMethod: null, plan: null })
})

test('signed out as Claude Code says it: `auth status` exits 1 and still prints its answer', async () => {
  // What Claude Code 2.1.332 does on a Mac that never signed in, as its docs say: exit code 1 when not logged in.
  const run = (_file: string, args: readonly string[], _options: unknown, done: (error: Error | null, stdout: string, stderr: string) => void) => {
    if (args[0] === '--version') return done(null, '2.1.332 (Claude Code)\n', '')
    done(Object.assign(Error('Command failed'), { code: 1 }), `${JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' }, null, 2)}\n`, '')
  }
  assert.deepEqual(await claudeStatus({ find: () => '/bin.invalid/claude', run }), { installed: true, version: '2.1.332', signedIn: false, authMethod: null, plan: null })
})
