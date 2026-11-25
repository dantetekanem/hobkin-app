import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pullChecks } from '../src/review/pull-checks.ts'
import type { ApiCall, HostApi } from '../src/review/code-hosts.ts'
import type { GhCall } from '../src/review/gh.ts'

const head = 'a'.repeat(40)
const target = { kind: 'pull' as const, owner: 'owner', repo: 'repo', number: 7 }
const run = (status = 'completed', conclusion: string | null = 'success', head_sha = head) => ({ name: 'Tests', status, conclusion, head_sha })
const response = (check_runs: unknown[], total_count = check_runs.length): GhCall => async () => ({ kind: 'done', stdout: JSON.stringify({ total_count, check_runs }) })

test('reads one bounded GET at the candidate head and preserves failed, skipped and pending results', async () => {
  const gh: GhCall = async (args, input, options) => {
    assert.deepEqual(args, ['api', '--method', 'GET', `repos/owner/repo/commits/${head}/check-runs?per_page=100`])
    assert.equal(input, undefined)
    assert.equal(options?.timeoutMs, 10_000)
    return response([run(), run('completed', 'failure'), run('completed', 'skipped'), run('in_progress', null)])(args)
  }
  const evidence = await pullChecks({ target, head, gh })
  assert.equal(evidence.status, 'available')
  assert.deepEqual(evidence.checks.map((check) => check.conclusion), ['success', 'failure', 'skipped', null])
  assert.equal(evidence.truncated, false)
})

test('reports truncation and keeps returned check head identity', async () => {
  const evidence = await pullChecks({ target, head, gh: response([run('completed', 'success', 'b'.repeat(40))], 120) })
  assert.equal(evidence.truncated, true)
  assert.equal(evidence.checks[0]?.headSha, 'b'.repeat(40))
})

test('empty results are available, not proof that required checks passed', async () => {
  assert.equal((await pullChecks({ target, head, gh: response([]) })).status, 'available')
})

test('missing gh, failures, timeouts, malformed payloads and thrown errors are unknown', async () => {
  const calls: GhCall[] = [async () => ({ kind: 'missing' }), async () => ({ kind: 'timeout', ms: 10_000 }), async () => ({ kind: 'failed', code: 1, stdout: '', stderr: 'private error' }), async () => ({ kind: 'done', stdout: '{}' }), async () => ({ kind: 'done', stdout: 'invalid' }), response([{}]), async () => { throw new Error('private error') }]
  for (const gh of [undefined, ...calls]) {
    const evidence = await pullChecks({ target, head, gh })
    assert.equal(evidence.status, 'unknown')
    assert.deepEqual(evidence.checks, [])
    assert.ok(!JSON.stringify(evidence).includes('private error'))
  }
})

test("a named host's checks are read with one GET through its own API, and gh is never asked", async () => {
  const calls: ApiCall[] = []
  const api: HostApi = async (call) => {
    calls.push(call)
    return JSON.stringify({ total_count: 2, check_runs: [run(), run('completed', 'failure')] })
  }
  let asked = 0
  const gh: GhCall = async () => {
    asked += 1
    return { kind: 'missing' }
  }
  const named = { ...target, host: 'corp' }

  const evidence = await pullChecks({ target: named, head, gh, apiOf: () => api })

  assert.deepEqual(calls, [{ path: `repos/owner/repo/commits/${head}/check-runs?per_page=100` }])
  assert.deepEqual([evidence.status, evidence.checks.map((check) => check.conclusion), asked], ['available', ['success', 'failure'], 0])

  // A host that cannot be asked, or that fails, is unknown, and says nothing of what it answered.
  const failing: HostApi = async () => {
    throw new Error('private error')
  }
  for (const apiOf of [() => failing, () => null, () => { throw new Error('private error') }]) {
    const unknown = await pullChecks({ target: named, head, gh, apiOf })
    assert.equal(unknown.status, 'unknown')
    assert.ok(!JSON.stringify(unknown).includes('private error'))
  }
})

test('named hosts and invalid heads do not call GitHub', async () => {
  let calls = 0
  const gh: GhCall = async () => { calls += 1; return { kind: 'missing' } }
  for (const request of [{ target: { ...target, host: 'other' }, head }, { target, head: 'branch' }, { target, head: 'c'.repeat(41) }]) {
    assert.equal((await pullChecks({ ...request, gh })).status, 'unknown')
  }
  assert.equal(calls, 0)
})
