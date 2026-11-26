import type { AnswerTo } from './items.ts'
import type { CommandResults } from '#shared/commands/registry.ts'

export type LocalTest = CommandResults['work.local-test']

export function localTestGuides(to: AnswerTo | null | undefined) {
  if (to?.kind !== 'deploy' || to.slug !== 'rpsleague') return null
  return ['Prepare, start and stop locally', 'Browser walkthrough']
}

export function revisionComparison(info: LocalTest | null): string {
  if (!info?.head || !info.candidate || info.dirty === null) return 'Comparison unavailable.'
  if (info.head !== info.candidate) return 'Local HEAD differs from the proposed deploy tip.'
  return info.dirty ? 'HEAD matches, but the local checkout has uncommitted changes.' : 'Local HEAD matches the proposed deploy tip; checkout is clean.'
}
