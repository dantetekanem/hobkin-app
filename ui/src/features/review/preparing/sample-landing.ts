import type { NoteEntry } from '#shared/review/notes.ts'
import { IDLE_STATUS, type OpenedReview, type ReviewLanding, type ReviewNotes, type ReviewStatus, type VerdictPreview } from '#shared/review/status.ts'
import type { Review, ReviewSource } from '#shared/review/types.ts'
import type { Verdict } from '#shared/review/verdict.ts'
import type { ReviewCommands } from '../loader.ts'
import type { VerdictCommands } from '../verdict.ts'

/**
 * A made-up host for the sample finished change, so a window shows how a finished change lands, with nothing sent
 * anywhere (spec 032). Approve and merge conflicts with main: an agent brings it up to date for a few seconds, its
 * branch moving as it does, and then it is merged. It stays merged while the window is open, so opening it again
 * shows a change that is merged already, until the window reloads. The review, its files and its change review are
 * the sample source's.
 */

/** The sample finished change: the review every sample card of the Work screen opens. */
export const SAMPLE_CHANGE = 'sample'
/** How long the made-up agent takes to bring it up to date, in milliseconds. */
export const SAMPLE_REFRESH_MS = 6000
const INTO = 'main'
/** The commit the made-up agent brings it up to date as, which is the one it merges as. */
const REFRESHED = 'e44106a7c2f94d1b8a3e6c05d9b27f4a81c3e6d0'
const PREPARED_AT = '2026-11-12T16:00:00.000Z'
/** What a preview answers for the second click. A sample sends nothing, so it checks nothing. */
const CONFIRM = '0'.repeat(64)
const NOTHING_SENT = 'Sample: nothing is sent from here.'
const REFRESHING = `An agent is bringing it up to date with ${INTO}, and hobkin merges it once that run ends well.`
const MERGED = `Merged into ${INTO} at ${REFRESHED.slice(0, 7)}.`

interface Sample {
  /** When Approve and merge was confirmed (ms), or null before. */
  yes: number | null
  notes: ReviewNotes
}

const iso = (ms: number) => new Date(ms).toISOString()

/** The sample finished change's host, one for the window. `clock` is in milliseconds; tests pass their own. */
export function sampleLandings(clock: () => number = Date.now) {
  const samples = new Map<string, Sample>()
  const sampleOf = (id: string): Sample => {
    let sample = samples.get(id)
    if (!sample) samples.set(id, (sample = { yes: null, notes: { entries: [], draft: null } }))
    return sample
  }
  const landingOf = ({ yes }: Sample): ReviewLanding | null => {
    if (yes == null) return null
    if (clock() - yes < SAMPLE_REFRESH_MS) return { state: 'refreshing', at: iso(yes), into: INTO, message: REFRESHING }
    return { state: 'merged', sha: REFRESHED, at: iso(yes + SAMPLE_REFRESH_MS), into: INTO, message: MERGED }
  }

  /** The commands for one sample review. `windowNotes` reads the notes the window keeps for it, which are the window's own. */
  return (id: string, source: ReviewSource, windowNotes?: (review: Review) => ReviewNotes): ReviewCommands & VerdictCommands => {
    const statusOf = async (): Promise<ReviewStatus> => {
      const { change } = await source.getReview(id)
      const landing = landingOf(sampleOf(id))
      return { ...IDLE_STATUS(id), state: 'ready', head: landing ? REFRESHED : change.head, preparedAt: PREPARED_AT, ...(landing ? { landing } : {}) }
    }
    const previewOf = (verdict: Verdict, head: string): VerdictPreview => {
      const landing = landingOf(sampleOf(id))
      if (landing?.state === 'merged') return { verdict, lines: [`Already merged into ${INTO} at ${REFRESHED.slice(0, 7)}.`], confirm: CONFIRM }
      if (verdict !== 'approve-merge') return { verdict, lines: [NOTHING_SENT], confirm: CONFIRM }
      if (landing) return { verdict, lines: [REFRESHING], confirm: CONFIRM }
      return {
        verdict,
        lines: [`It conflicts with ${INTO}: an agent brings it up to date, then hobkin merges it.`, `At commit ${head.slice(0, 7)}, the one this review was built from.`, NOTHING_SENT],
        confirm: CONFIRM,
      }
    }

    return (async (name: string, args: { fileId?: string; entries?: NoteEntry[]; draft?: ReviewNotes['draft']; verdict?: Verdict; head?: string }) => {
      const sample = sampleOf(id)
      switch (name) {
        case 'review.status':
        case 'review.prepare':
          return statusOf()
        case 'review.get': {
          const review = await source.getReview(id)
          return { review, notes: windowNotes?.(review) ?? sample.notes, status: await statusOf(), assessment: (await source.getAssessment?.(id)) ?? null } satisfies OpenedReview
        }
        case 'review.file':
          return source.getFile(id, args.fileId ?? '')
        case 'review.notes':
          sample.notes = { entries: args.entries ?? [], draft: args.draft ?? null }
          return { ok: true }
        case 'review.preview':
          return previewOf(args.verdict ?? 'approve', args.head ?? (await source.getReview(id)).change.head)
        case 'review.verdict': {
          const landing = landingOf(sample)
          if (landing?.state === 'merged') return { message: `Already merged into ${INTO} at ${REFRESHED.slice(0, 7)}.` }
          if (args.verdict !== 'approve-merge') return { message: NOTHING_SENT }
          sample.yes ??= clock()
          return { message: REFRESHING }
        }
        default:
          throw new Error(`A sample review has no ${name}.`)
      }
    }) as ReviewCommands & VerdictCommands
  }
}

const landings = sampleLandings()

/**
 * The made-up host of the sample finished change, for a review that is not live. A live review's commands are always
 * the connected host's own: it never gets these, whatever it is called.
 */
export function sampleLanding(id: string, live: boolean, source: ReviewSource, windowNotes?: (review: Review) => ReviewNotes): (ReviewCommands & VerdictCommands) | null {
  return !live && id === SAMPLE_CHANGE ? landings(id, source, windowNotes) : null
}
