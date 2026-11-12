/**
 * What a step's card says about its unit, in plain words (the user, 2026-11-12: a card that only says "4 lines added" is
 * useless): how the change is proven, who it reaches, how it is undone, and what to watch once it ships. Pure.
 */
import type { Unit } from '#shared/review/assessment.ts'
import type { ReviewNode } from '#shared/review/types.ts'
import type { TestCounts } from '../graph/arrange.ts'

type Facts = Unit['facts']

const PROOF: Record<Facts['proof']['value'], string> = {
  'lifecycle-observed': 'Proven end to end, and seen running',
  lifecycle: 'Proven end to end',
  isolated: 'Proven by tests of this code alone',
  mocked: 'Proven against stand-ins',
  none: 'No test proves it',
  unknown: 'Not known what proves it',
  'not-applicable': 'Nothing to prove: it does not run',
}
const EXPOSURE: Record<Facts['exposure']['value'], string> = {
  'nobody-yet': 'Nobody runs it yet',
  subset: 'Runs for some requests',
  everyone: 'Runs for everyone',
  'at-load': 'Runs as the app loads',
}
const UNDO: Record<Facts['undo']['value'], string> = {
  flag: 'A flag turns it off',
  'flag-with-residue': 'A flag turns it off, and leaves some of it behind',
  rollback: 'Undone by a rollback',
  none: 'Nothing undoes it',
}
const SIGNAL: Record<'metric' | 'log' | 'trace' | 'error-report', string> = { metric: 'a metric', log: 'a log line', trace: 'a trace', 'error-report': 'an error report' }

/** A fact as a sentence: what it means, then the evidence for it. */
function said(words: string, evidence: string): string {
  const reason = evidence.trim().replace(/\.+$/, '')
  return reason ? `${words}: ${reason}.` : `${words}.`
}

export const proofWords = (facts: Facts): string => said(PROOF[facts.proof.value], facts.proof.evidence)
export const exposureWords = (facts: Facts): string => said(EXPOSURE[facts.exposure.value], facts.exposure.evidence)
export const undoWords = (facts: Facts): string => said(UNDO[facts.undo.value], facts.undo.evidence)

/** What to watch once it ships, for a unit that needs a look: each signal, each gap nothing watches, and the way back. */
export function watchWords(unit: Pick<Unit, 'level' | 'watch'>): string[] {
  if (unit.level === 'safe' || unit.watch === 'not assessed') return []
  const { signals, gaps, undo } = unit.watch
  return [
    ...signals.map((signal) => `Watch ${signal.name}, ${SIGNAL[signal.kind]} at ${signal.at}.`),
    ...gaps.map((gap) => `Not watched: ${gap.trim().replace(/\.+$/, '')}.`),
    ...(undo ? [`If it goes wrong: ${undo.trim().replace(/\.+$/, '')}.`] : []),
  ]
}

/**
 * What the tests that cover these nodes did: the tests whose wires lead to them first (`Arranged.covers`), however they
 * are folded. Null when no test covers them.
 */
export function testsOf(nodes: readonly string[], covers: Readonly<Record<string, string>>, nodeOf: ReadonlyMap<string, ReviewNode>): (TestCounts & { total: number; failing: string[] }) | null {
  const covered = new Set(nodes)
  const tests = Object.entries(covers)
    .filter(([, subject]) => covered.has(subject))
    .map(([test]) => nodeOf.get(test))
    .filter((test): test is ReviewNode => test != null)
  if (tests.length === 0) return null
  const counts = { total: tests.length, ran: 0, failed: 0, notRun: 0, proves: 0, failing: [] as string[] }
  for (const test of tests) {
    if (test.status === 'passed' || test.status === 'failed' || test.status === 'proves-change') counts.ran += 1
    else counts.notRun += 1
    if (test.status === 'failed') {
      counts.failed += 1
      counts.failing.push(test.title)
    }
    if (test.status === 'proves-change') counts.proves += 1
  }
  return counts
}

/** How the tests went, in a line: "5 of 5 tests ran; 3 prove the change." */
export function testsWords(tests: NonNullable<ReturnType<typeof testsOf>>): string {
  const ran = `${tests.ran} of ${tests.total} ${tests.total === 1 ? 'test' : 'tests'} ran`
  const parts = [tests.failed > 0 ? `${tests.failed} failed` : '', tests.notRun > 0 ? `${tests.notRun} not run` : ''].filter(Boolean)
  const proves = tests.proves > 0 ? `; ${tests.proves} ${tests.proves === 1 ? 'proves' : 'prove'} the change` : ''
  return `${ran}${parts.length > 0 ? `, ${parts.join(', ')}` : ''}${proves}.`
}
