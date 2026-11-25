import type { ReviewTarget } from '#shared/review/ids.ts'
import type { HostedChecks } from '../../../packages/change-review/src/types.ts'
import type { GhCall } from './gh.ts'

const FULL_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

/** One bounded snapshot, not required-check completeness or evidence of any individual test running. */
export async function pullChecks({ target, head, gh }: { target: Extract<ReviewTarget, { kind: 'pull' }>; head: string; gh?: GhCall }): Promise<HostedChecks> {
  const unknown = (reason: string): HostedChecks => ({ status: 'unknown', headSha: head, checks: [], truncated: false, reason })
  if (target.host) return unknown('Hosted checks are unavailable for this code host.')
  if (!gh) return unknown('GitHub CLI is unavailable.')
  if (!FULL_SHA.test(head)) return unknown('An exact commit SHA is required.')
  try {
    const result = await gh(['api', '--method', 'GET', `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/commits/${head}/check-runs?per_page=100`], undefined, { timeoutMs: 10_000 })
    if (result.kind !== 'done') return unknown(`GitHub checks could not be read (${result.kind}).`)
    // Reject unexpected responses rather than turn a partial/malformed result into apparent green CI.
    if (result.stdout.length > 2_000_000) return unknown('GitHub checks response exceeded the evidence limit.')
    const data = JSON.parse(result.stdout)
    if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || !Array.isArray(data.check_runs) || data.check_runs.length > 100 || data.total_count < data.check_runs.length) return unknown('GitHub checks response was malformed.')
    const checks: HostedChecks['checks'] = []
    for (const run of data.check_runs) {
      if (!run || typeof run.name !== 'string' || !run.name || typeof run.status !== 'string' || !run.status || !(run.conclusion === null || typeof run.conclusion === 'string') || typeof run.head_sha !== 'string' || !FULL_SHA.test(run.head_sha)) return unknown('GitHub checks response was malformed.')
      checks.push({ name: run.name.slice(0, 240), status: run.status.slice(0, 80), conclusion: run.conclusion?.slice(0, 80) ?? null, headSha: run.head_sha })
    }
    return { status: 'available', headSha: head, checks, truncated: data.total_count > checks.length }
  } catch {
    return unknown('GitHub checks could not be read.')
  }
}
