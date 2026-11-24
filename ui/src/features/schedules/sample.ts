import type { AgentSchedule } from '#shared/protocol/schedules.ts'

/**
 * Made-up schedules in the host's shape (`shared/protocol/schedules.ts`), so the line and its list show with no host:
 * the main chat's own, one for the sample agent with steps (`a1`, ui/src/app/running-agents.ts), and two for a durable
 * hobkin, whichever page is open. One of each state the list draws: running, waiting, paused and ended.
 */

/** The owner id the sample hobkin's schedules carry, given the id of the hobkin page that shows them. */
export const SAMPLE_HOBKIN = 'sample-hobkin'

const SECOND = 1000
const MINUTE = 60 * SECOND

export function sampleSchedules(now: number): readonly AgentSchedule[] {
  const at = (ms: number) => new Date(now + ms).toISOString()
  return [
    {
      id: 'sample:watch-ci',
      owner: { kind: 'run', id: 'a1' },
      ownerTitle: 'Fix the login redirect loop',
      name: 'Watch CI for #412',
      does: 'shell',
      command: 'gh pr checks 412 --repo storefront/web --required',
      note: 'Come back when the checks pass or fail, and fix a red one.',
      every: 120,
      state: 'waiting',
      nextAt: at(102 * SECOND),
      until: at(88 * MINUTE),
      runs: 7,
      maxRuns: 30,
      wakes: 0,
      maxWakes: 12,
      last: { at: at(-18 * SECOND), outcome: 'pending', exitCode: 8, woke: false, line: '3 checks pending' },
    },
    {
      id: 'sample:preview',
      owner: { kind: 'main' },
      ownerTitle: 'hobkin',
      name: 'Preview is up',
      does: 'shell',
      command: 'curl -fsS https://preview.storefront.invalid/health',
      note: 'Tell the user the preview answers, or what it said.',
      every: 300,
      state: 'running',
      until: at(41 * MINUTE),
      runs: 3,
      wakes: 0,
      maxWakes: 12,
      last: { at: at(-5 * MINUTE), outcome: 'failed', exitCode: 7, woke: false, line: 'curl: (7) Failed to connect' },
    },
    {
      id: 'sample:release-notes',
      owner: { kind: 'hobkin', id: SAMPLE_HOBKIN },
      ownerTitle: 'Release helper',
      name: 'Read the release notes again',
      does: 'wake',
      note: 'Read the release notes draft again and send it to the user.',
      state: 'paused',
      until: at(3 * 60 * MINUTE),
      runs: 0,
      wakes: 0,
      maxWakes: 12,
    },
    {
      id: 'sample:deploy',
      owner: { kind: 'hobkin', id: SAMPLE_HOBKIN },
      ownerTitle: 'Release helper',
      name: 'Watch the deploy',
      does: 'shell',
      command: 'kubectl rollout status deploy/storefront --timeout=20s',
      note: 'Come back when the rollout finishes or stalls.',
      every: 600,
      state: 'waiting',
      nextAt: at(4 * MINUTE + 10 * SECOND),
      until: at(70 * MINUTE),
      runs: 2,
      maxRuns: 12,
      wakes: 0,
      maxWakes: 12,
      last: { at: at(-(5 * MINUTE + 50 * SECOND)), outcome: 'pending', exitCode: 1, woke: false },
    },
    {
      // A daily one its agent gave no end and no cap on wakes (056, 2026-11-24).
      id: 'sample:nightly',
      owner: { kind: 'main' },
      ownerTitle: 'hobkin',
      name: 'Check the nightly export',
      does: 'shell',
      command: 'bin/export-status --last',
      note: 'Say only when the export failed or is late.',
      every: 24 * 60 * 60,
      state: 'waiting',
      nextAt: at(9 * 60 * MINUTE + 20 * MINUTE),
      runs: 3,
      wakes: 1,
      last: { at: at(-(14 * 60 * MINUTE + 40 * MINUTE)), outcome: 'passed', exitCode: 0, woke: false, line: 'export ok, 1,204 rows' },
    },
    {
      id: 'sample:flaky',
      owner: { kind: 'main' },
      ownerTitle: 'hobkin',
      name: 'Rerun the flaky test',
      does: 'shell',
      command: 'pnpm test --filter checkout -- --grep "applies the coupon"',
      note: 'Say whether it failed again.',
      every: 180,
      state: 'done',
      runs: 4,
      maxRuns: 4,
      wakes: 1,
      maxWakes: 12,
      last: { at: at(-12 * MINUTE), outcome: 'passed', exitCode: 0, woke: true },
      endedWhy: 'it ran its 4 runs',
    },
  ]
}

/**
 * The sample as it stands at `now`: a repeating one that came due has run, and waits for its next time, so the sample's
 * countdowns go round instead of stopping at "due now". The same list when nothing came due.
 */
export function rollSample(list: readonly AgentSchedule[], now: number): readonly AgentSchedule[] {
  let changed = false
  const rolled = list.map((schedule) => {
    const next = schedule.nextAt ? Date.parse(schedule.nextAt) : NaN
    if (schedule.state !== 'waiting' || !schedule.every || !(next <= now)) return schedule
    changed = true
    const every = schedule.every * SECOND
    const passed = Math.floor((now - next) / every) + 1
    const nextAt = next + passed * every
    return {
      ...schedule,
      nextAt: new Date(nextAt).toISOString(),
      runs: (schedule.runs ?? 0) + passed,
      ...(schedule.last ? { last: { ...schedule.last, at: new Date(nextAt - every).toISOString() } } : {}),
    }
  })
  return changed ? rolled : list
}

/** The soonest a sample comes due, to roll it then, or null when none waits. */
export function nextSampleDue(list: readonly AgentSchedule[]): number | null {
  const times = list.flatMap(({ state, every, nextAt }) => (state === 'waiting' && every && nextAt ? [Date.parse(nextAt)] : []))
  return times.length ? Math.min(...times) : null
}
