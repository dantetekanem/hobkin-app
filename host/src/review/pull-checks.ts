import type { ReviewTarget } from '#shared/review/ids.ts'
import type { HostedChecks } from '../../../packages/change-review/src/types.ts'
import type { HostApi } from './code-hosts.ts'
import type { GhCall } from './gh.ts'

type PullTarget = Extract<ReviewTarget, { kind: 'pull' }>

const FULL_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i

/**
 * One bounded snapshot, not required-check completeness or evidence of any individual test running. A pull request on
 * GitHub is read through gh; one on a named code host through that host's API, which answers GitHub's paths.
 */
export async function pullChecks({ target, head, gh, apiOf }: { target: PullTarget; head: string; gh?: GhCall; apiOf?: (target: PullTarget) => HostApi | null }): Promise<HostedChecks> {
  const unknown = (reason: string): HostedChecks => ({ status: 'unknown', headSha: head, checks: [], truncated: false, reason })
  const where = target.host ?? 'GitHub'
  if (!target.host && !gh) return unknown('GitHub CLI is unavailable.')
  if (!FULL_SHA.test(head)) return unknown('An exact commit SHA is required.')
  const path = `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/commits/${head}/check-runs?per_page=100`

  try {
    let stdout: string
    if (target.host) {
      const api = apiOf?.(target)
      if (!api) return unknown(`Hosted checks are unavailable for ${target.host}.`)
      stdout = await api({ path })
    } else {
      const result = await gh!(['api', '--method', 'GET', path], undefined, { timeoutMs: 10_000 })
      if (result.kind !== 'done') return unknown(`GitHub checks could not be read (${result.kind}).`)
      stdout = result.stdout
    }

    // Reject unexpected responses rather than turn a partial/malformed result into apparent green CI.
    if (stdout.length > 2_000_000) return unknown(`${where} checks response exceeded the evidence limit.`)
    const data = JSON.parse(stdout)
    if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || !Array.isArray(data.check_runs) || data.check_runs.length > 100 || data.total_count < data.check_runs.length) return unknown(`${where} checks response was malformed.`)
    const checks: HostedChecks['checks'] = []
    for (const run of data.check_runs) {
      if (!run || typeof run.name !== 'string' || !run.name || typeof run.status !== 'string' || !run.status || !(run.conclusion === null || typeof run.conclusion === 'string') || typeof run.head_sha !== 'string' || !FULL_SHA.test(run.head_sha)) return unknown(`${where} checks response was malformed.`)
      checks.push({ name: run.name.slice(0, 240), status: run.status.slice(0, 80), conclusion: run.conclusion?.slice(0, 80) ?? null, headSha: run.head_sha })
    }
    return { status: 'available', headSha: head, checks, truncated: data.total_count > checks.length }
  } catch {
    return unknown(`${where} checks could not be read.`)
  }
}
