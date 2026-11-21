/**
 * What the change review (spec 032) says, in the words the Review screen uses: what the change does, its overall risk,
 * and the unit of what is in focus, which the code panel explains beside its code. Nothing here draws, so all of it
 * can be tested without a screen.
 */
import { DEPLOY_WORDS, deployOf, deployWhy, sinceLastReview, type AssessmentStatus, type ChangeAssessment, type Deploy, type Level, type RiskFix, type Unit } from '#shared/review/assessment.ts'
import type { Review, ReviewLevel } from '#shared/review/types.ts'

/**
 * What a part of the change is, said of the part and never as a risk of its own: risk is the whole change's, and the
 * header says it once. A part can break, was not shown by a test, or is shown to work.
 */
export const PART_WORDS: Record<Level, string> = { high: 'Can break', mid: 'Not shown by a test', safe: 'Shown to work' }

/** What the code panel says about a unit (`packages/change-review`, its `units.json`), in the screen's words. */
export interface StepUnit {
  /** The unit's claim, such as "round_money changes its rounding mode for every caller". */
  title?: string
  level: ReviewLevel
  critical?: boolean
  /** The four facts, a few words each: what it does, what proves it, who runs it, what undoes it. */
  facts: { name: string; text: string }[]
  /** Why it has this level, a reason a line. */
  why: string[]
  /** What would change the level, and to which. */
  wouldChange: { text: string; level: ReviewLevel }[]
  questions: { text: string; why?: string }[]
}

const RANK: Record<Level, number> = { safe: 0, mid: 1, high: 2 }

/** The sentence the change review's story opens with on what the change does: `**Does:** …`. */
const DOES = /^\*\*Does:\*\*\s+(.+)$/m
/** Written from the facts alone, that sentence only names the kind of change and how the story tells it. */
const GENERATED_DOES = /told below as \d+ units?\.$/
const plain = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * What the change does, in one paragraph that stays the same for the whole review: the sentence the change review's
 * model wrote, else the review's own summary. Null when neither says more than the title.
 */
export function changeDescription(review: Pick<Review, 'summary' | 'change'>, assessment: Pick<ChangeAssessment, 'story' | 'summary'> | null | undefined): string | null {
  const does = assessment?.summary.storyBy === 'model' ? DOES.exec(assessment.story)?.[1]?.trim() : undefined
  if (does && !GENERATED_DOES.test(does)) return does
  const summary = review.summary.trim()
  return summary && plain(summary) !== plain(review.change.title) ? summary : null
}

/**
 * The review's one answer for the whole change, as the badge under the title. `rated`: risky or safe to deploy, why,
 * what happened since the review before this one when there was one, and whether anything is critical; `again` while
 * it is reviewed once more; `fix`, for hobkin's own change found risky, what hobkin does about it. `rating`: none yet, and how far along the first one is. `failed`: it stopped, and why.
 * Null when no change review is coming, as for a pull request nobody asked to review. Risk is said here, once, for the
 * change: a node or a step has none of its own.
 */
export type RiskBadge =
  | { kind: 'rated'; deploy: Deploy; label: string; why: string; since: string | null; critical: boolean; again: boolean; fix?: RiskFix }
  | { kind: 'rating'; percent: number | null; now: string | null; queued: boolean }
  | { kind: 'failed'; error: string | null }

export function riskBadge(assessment: Pick<ChangeAssessment, 'summary'> | null | undefined, status: AssessmentStatus | null | undefined): RiskBadge | null {
  const summary = assessment?.summary ?? (status?.state === 'ready' ? status.summary : undefined)
  const underWay = status?.state === 'queued' || status?.state === 'running'
  if (summary) {
    const deploy = deployOf(summary)
    const fix = deploy === 'risky' && status?.state === 'ready' ? status.fix : undefined
    return { kind: 'rated', deploy, label: DEPLOY_WORDS[deploy], why: deployWhy(summary), since: sinceLastReview(summary, status?.head), critical: summary.critical, again: underWay, ...(fix ? { fix } : {}) }
  }
  if (underWay) {
    return { kind: 'rating', percent: status.state === 'running' && status.percent != null ? Math.round(status.percent) : null, now: status.now ?? null, queued: status.state === 'queued' }
  }
  if (status?.state === 'failed') return { kind: 'failed', error: status.error ?? null }
  return null
}

/** One fact in a line: its value, then the evidence for it. */
function factText({ value, evidence }: { value: string; evidence: string }): string {
  if (!evidence) return value
  const sentence = `${evidence.charAt(0).toUpperCase()}${evidence.slice(1).replace(/\.+$/, '')}.`
  return `${value}. ${sentence}`
}

/** What the code panel says about a unit: its level, the four facts, why this level, what would change it, its questions. */
export function toStepUnit(unit: Unit): StepUnit {
  return {
    title: unit.title,
    level: unit.level,
    critical: unit.critical,
    facts: [
      { name: 'Does', text: factText(unit.facts.effect) },
      { name: 'Proven', text: factText(unit.facts.proof) },
      { name: 'Runs for', text: factText(unit.facts.exposure) },
      { name: 'Undone by', text: factText(unit.facts.undo) },
    ],
    why: unit.why_level,
    wouldChange: unit.would_change,
    questions: unit.questions.map(({ text, why }) => ({ text, why })),
  }
}

/** The unit of what is in focus: the node the reviewer is on, else the most worrying of the focus. */
export function unitInFocus(units: readonly Unit[] | null | undefined, nodes: readonly { id: string; unit?: string }[], pointed: string | null): Unit | undefined {
  if (!units?.length) return undefined
  const byId = new Map(units.map((unit) => [unit.id, unit]))
  const of = (node: { unit?: string } | undefined) => (node?.unit ? byId.get(node.unit) : undefined)
  const chosen = of(nodes.find((node) => node.id === pointed))
  if (chosen) return chosen
  return nodes
    .map(of)
    .filter((unit): unit is Unit => unit != null)
    .reduce<Unit | undefined>((worst, unit) => (!worst || RANK[unit.level] > RANK[worst.level] ? unit : worst), undefined)
}
