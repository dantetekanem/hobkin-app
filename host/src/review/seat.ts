/**
 * Change Review's place in the host: where its changes are read from, who arranges their stories, what is prepared
 * in the background, and the commands the window runs. Specs: 005-review-model (S6), 009-review-notes, 024-github.
 */
import { existsSync } from 'node:fs'
import { paths, readProject } from 'hobkin/src/cli/work/store.mjs'
import { defaultBranch } from 'hobkin/src/cli/work/tree.mjs'
import type { GitHubState } from '#shared/protocol/github.ts'
import type { FinishedChange, WorkState } from '#shared/protocol/work.ts'
import { reviewIdOf, targetOfReviewId } from '#shared/review/ids.ts'
import type { HostHandlers } from '../commands.ts'
import type { PiModelRuntime } from '../pi.ts'
import { reviewChange } from '../../../packages/change-review/src/pipeline.ts'
import { noReviewAgent, piModelRunner, piReviewAgent } from './agent.ts'
import { Assessments } from './assessment.ts'
import { reviewCode, reviewMap } from './guide.ts'
import type { GhCall } from './gh.ts'
import { Reviews, type Watched } from './reviews.ts'
import { sampleReviewSource } from './sample-source.ts'
import { gitPublisher } from './publish.ts'
import { changeSource, pullSource } from './sources.ts'
import { reviewStore } from './store.ts'
import { scanVicinity } from './vicinity-scan.ts'

export interface ReviewSeat {
  root: string
  /** The real model arranges the stories. Otherwise the host does alone, and nothing is spent. */
  live: boolean
  /** hobkin's data folder. Throws, with the reason, while hobkin is not open in this host. */
  data: () => string
  /** Work mode as the Work screen has it, with the finished changes. */
  work: () => WorkState | null
  /** hobkin's work actions. Throws, with the reason, while hobkin is not open in this host. */
  app: () => { workAction(action: string, slug?: unknown, value?: unknown, extra?: unknown): Promise<unknown> }
  runtime: () => Promise<PiModelRuntime | undefined>
  /** gh, to read pull requests. Without it a pull request reads as the sample change, as the GitHub page shows sample data. */
  gh?: GhCall
  log?: (line: string) => void
}

/** How many pull requests waiting for the user's review the background prepares: the most recently updated. */
export const BACKGROUND_PULLS = 10

const finishedIn = (work: WorkState | null): FinishedChange[] => (work?.finished ?? []).flatMap((group) => group.changes)

export function hostReviews(seat: ReviewSeat): Reviews {
  const find = (slug: string, item: string) => finishedIn(seat.work()).find((change) => change.slug === slug && change.item === item) ?? null
  // hobkin's own rule: the folder the project was chosen from, or hobkin's own copy of it.
  const repoOf = (slug: string) => {
    const data = seat.data()
    const repo = readProject(data, slug)?.path ?? paths(data, slug).clone
    return existsSync(repo) ? repo : null
  }
  // The change review of each finished change (spec 032): its own tests run in a review worktree, and the careful pass
  // and the blind check go to the tiers. Only a live host runs it: the scripted one runs no tests and asks no model.
  const assessments = seat.live
    ? new Assessments({
        root: seat.root,
        repoOf,
        run: async (request) => {
          const model = piModelRunner({ root: seat.root, data: seat.data, runtime: seat.runtime })
          const result = await reviewChange({ ...request, model })
          for (const problem of result.problems) seat.log?.(`Change review at ${request.head.slice(0, 7)}: ${problem}`)
          return { units: result.units, storyBy: result.storyBy }
        },
        log: seat.log,
      })
    : undefined
  return new Reviews({
    ...(assessments ? { assessments } : {}),
    store: reviewStore(seat.root),
    sources: {
      change: changeSource({
        find: (slug, item) => {
          const change = find(slug, item)
          return change && { project: change.project, title: change.title, branch: change.branch, head: change.head }
        },
        repoOf,
        baseOf: defaultBranch,
        // The call-graph scan runs only where reviews are real, never for the scripted host.
        ...(seat.live ? { vicinity: (repo: string, base: string, head: string) => scanVicinity({ repo, base, head }) } : {}),
      }),
      pull: seat.gh ? pullSource({ gh: seat.gh }) : sampleReviewSource(),
    },
    agent: seat.live ? piReviewAgent({ root: seat.root, data: seat.data, runtime: seat.runtime }) : noReviewAgent,
    work: seat.app,
    // A finished change's commit is on its card already. A pull request's is asked of GitHub when its review is open.
    head: (target) => (target.kind === 'change' ? (find(target.slug, target.item)?.head ?? null) : null),
    card: (slug, item) => {
      const change = find(slug, item)
      return change && { landing: change.landing, yes: change.yes, branch: change.branch, pr: change.pr }
    },
    // Only a live host posts to GitHub or opens a pull request, and only for a verdict the user confirmed.
    ...(seat.live && seat.gh ? { gh: seat.gh, publish: gitPublisher({ repoOf, baseOf: defaultBranch, gh: seat.gh }) } : {}),
    log: seat.log,
  })
}

/**
 * What the background prepares: every finished change at its commit, then the pull requests waiting for the user's
 * review. Made-up GitHub data is never prepared in the background.
 */
export function toPrepare(work: WorkState | null, github: GitHubState): Watched[] {
  const changes = finishedIn(work).map((change) => ({ id: reviewIdOf({ kind: 'change', slug: change.slug, item: change.item }), head: change.head }))
  const pulls = github.sample
    ? []
    : github.reviews.slice(0, BACKGROUND_PULLS).flatMap((pull) => {
        const target = targetOfReviewId(pull.url)
        return target ? [{ id: reviewIdOf(target), updatedAt: pull.updatedAt }] : []
      })
  return [...changes, ...pulls]
}

type ReviewCommand = 'review.prepare' | 'review.status' | 'review.get' | 'review.file' | 'review.notes' | 'review.map' | 'review.code' | 'review.show' | 'review.note' | 'review.preview' | 'review.verdict'

export function reviewHandlers(reviews: Reviews): Pick<HostHandlers, ReviewCommand> {
  return {
    'review.prepare': ({ id, refresh }) => reviews.prepare(id, { refresh }),
    'review.status': ({ id }) => {
      // An open review asks now and then, so it can say when its change has moved on.
      void reviews.lookAgain(id)
      return reviews.status(id)
    },
    'review.get': ({ id }) => reviews.get(id),
    'review.file': ({ id, fileId }) => reviews.file(id, fileId),
    'review.notes': ({ id, entries, draft }) => {
      reviews.saveNotes(id, { entries, draft })
      return { ok: true }
    },
    'review.map': ({ id }) => reviewMap(reviews, id),
    'review.code': ({ id, node }) => reviewCode(reviews, id, node),
    'review.show': ({ id, step, node }) => reviews.show(id, { step, node }),
    'review.note': ({ id, ...note }) => ({ id: reviews.note(id, note).id }),
    // `head` is the commit of the review on the user's screen: a verdict never acts on another one.
    'review.preview': ({ id, verdict, summary, head }) => reviews.preview(id, verdict, summary, head),
    'review.verdict': ({ id, verdict, summary, confirm, head }) => reviews.verdict(id, verdict, summary, confirm, head),
  }
}
