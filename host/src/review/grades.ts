/**
 * The bridge from a finished Change Review to hobkin (spec 063): the five ratings, with their kind, go to the runtime's
 * `recordGrades` so YOLO mode reads the numbers the user sees. They go only from a review this host built, made at the
 * commit the change is at, and only complete. Nothing an agent's run writes can pass for them: the runtime's `item`
 * command takes none, and no command or tool of this app names the door, which only the host walks through.
 */
import { NEED_NAMES, type NeedKind, type NeedName, type NeedScore, type ReviewNeeds } from '#shared/review/needs.ts'
import { reviewIdOf, type ReviewTarget } from '#shared/review/ids.ts'

/** What `recordGrades` takes (`assertReview` in hobkin's `classified.mjs`): a kind, the full commit, and each score with its line. No rate. */
export interface Grades {
  kind: NeedKind
  head: string
  scores: Record<NeedName, NeedScore>
}

/** hobkin's door for them, when it has one. Looked up on the module, since an older hobkin has none. */
export interface GradesRuntime {
  recordGrades?: (root: string, slug: string, item: string, grades: Grades) => unknown
}

/** How a send ended: recorded, refused in the runtime's words, no door in this hobkin, or not a record the host sends at all. */
export type GradeOutcome = { state: 'recorded' } | { state: 'refused'; why: string } | { state: 'unavailable' } | { state: 'skipped'; why: string }

/** The ratings as the runtime takes them, or null when they are not the change review's own, complete, and at this commit. */
export function gradesOf(needs: ReviewNeeds | null | undefined, head: string | null): Grades | null {
  if (!needs || needs.by !== 'change-review' || !needs.kind || !head || needs.head !== head) return null
  const scores = {} as Record<NeedName, NeedScore>
  for (const name of NEED_NAMES) {
    const given = needs.scores[name]
    // hobkin takes a score only with its line of evidence, so one without is not whole yet.
    if (!given || !given.evidence.trim()) return null
    scores[name] = { score: given.score, evidence: given.evidence }
  }
  return { kind: needs.kind, head: needs.head, scores }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** hobkin's own door, found when it is wanted: a hobkin that gains it while the host runs is used from then on. */
export async function hobkinGradesRuntime(): Promise<GradesRuntime> {
  try {
    const module = (await import('hobkin/src/cli/work/review-grades.mjs')) as GradesRuntime
    return { recordGrades: module.recordGrades }
  } catch {
    return {}
  }
}

export interface GradesBridgeOptions {
  root: () => string
  runtime?: () => Promise<GradesRuntime>
  log?: (line: string) => void
}

export class GradesBridge {
  private readonly options: GradesBridgeOptions
  /** Refreshes repeat the same grades; a rebuilt review at the same commit can have new evidence. */
  private readonly done = new Map<string, { evidence: string; outcome: GradeOutcome }>()

  constructor(options: GradesBridgeOptions) {
    this.options = options
  }

  /** What became of this change's grades at this commit, when the host sent or refused to send them. */
  outcomeOf(target: ReviewTarget, head: string): GradeOutcome | undefined {
    return this.done.get(`${reviewIdOf(target)}@${head}`)?.outcome
  }

  /** Send a finished review's grades once; reconsider them when the evidence changes. */
  async send(target: ReviewTarget, needs: ReviewNeeds | null | undefined, current: string | null): Promise<GradeOutcome> {
    if (target.kind !== 'change') return { state: 'skipped', why: 'Only a hobkin change has grades to record.' }
    const grades = gradesOf(needs, current)
    if (!grades) return { state: 'skipped', why: 'Its ratings are not the change review\'s complete ratings at the commit the change is at.' }
    const key = `${reviewIdOf(target)}@${grades.head}`
    const evidence = JSON.stringify(grades)
    const known = this.done.get(key)
    if (known?.evidence === evidence && known.outcome.state !== 'unavailable') return known.outcome

    const { recordGrades } = await (this.options.runtime ?? hobkinGradesRuntime)()
    if (!recordGrades) {
      // Not kept: once hobkin has the door, the same review goes.
      const none: GradeOutcome = { state: 'unavailable' }
      this.done.set(key, { evidence, outcome: none })
      return none
    }
    try {
      await recordGrades(this.options.root(), target.slug, target.item, grades)
      const recorded: GradeOutcome = { state: 'recorded' }
      this.done.set(key, { evidence, outcome: recorded })
      return recorded
    } catch (error) {
      const refused: GradeOutcome = { state: 'refused', why: messageOf(error) }
      this.done.set(key, { evidence, outcome: refused })
      this.options.log?.(`Grades of ${reviewIdOf(target)} at ${grades.head.slice(0, 7)} were not recorded: ${refused.why}`)
      return refused
    }
  }
}
