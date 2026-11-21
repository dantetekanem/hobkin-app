import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { runProgram } from '../../packages/change-review/src/git.ts'

const PRIORITY = 'ps -o pri= -p $$'

test("change review's test runs and other group runs start through taskpolicy at utility priority on macOS, and the rest as they are", async () => {
  const priority = async (group: boolean) => {
    const run = await runProgram('/bin/sh', ['-c', PRIORITY], { cwd: tmpdir(), timeoutMs: 5_000, group })
    return run.started ? run.stdout.toString('utf8').trim() : run.reason
  }
  const plain = execFileSync('/bin/sh', ['-c', PRIORITY], { encoding: 'utf8' }).trim()
  assert.equal(await priority(false), plain, 'git and other single programs')
  if (process.platform !== 'darwin') return assert.equal(await priority(true), plain)
  assert.equal(await priority(true), execFileSync('/usr/sbin/taskpolicy', ['-c', 'utility', '/bin/sh', '-c', PRIORITY], { encoding: 'utf8' }).trim())

  const missing = await runProgram('/no/such/program', [], { cwd: tmpdir(), timeoutMs: 5_000, group: true })
  assert.match(missing.started ? '' : missing.reason, /ENOENT/, 'a program that is not there still fails to start, as before')
})
