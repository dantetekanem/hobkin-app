/**
 * Where the review screen gets a review and its files when no host is connected. Sample data: one real hobkin commit
 * and a made-up stress change, both written by `scripts/review-sample.ts`, and a made-up pull request with its change
 * review (`sample/pull.ts`), which every sample pull request of the GitHub page opens. The host's `review.get` and
 * `review.file` commands take this interface's place when it is connected.
 */
import type { ChangeAssessment } from '#shared/review/assessment.ts'
import type { Review, ReviewFileContents, ReviewSource } from '#shared/review/types.ts'
import { openReview, ReviewRefused, staleAnchors } from '#shared/review/validate.ts'
import { isSamplePull } from './sample/pull-id.ts'
// The data is fetched as files, not bundled: it is large, and the screen should not wait on it to start.
import filesUrl from './sample/files.json?url'
import reviewUrl from './sample/review.json?url'
import stressFilesUrl from './sample/stress-files.json?url'
import stressReviewUrl from './sample/stress-review.json?url'

const SAMPLES: Record<string, { review: string; files: string }> = {
  sample: { review: reviewUrl, files: filesUrl },
  stress: { review: stressReviewUrl, files: stressFilesUrl },
}

interface Loaded {
  review: Review
  files: Map<string, ReviewFileContents>
  assessment: ChangeAssessment | null
}

const loading = new Map<string, Promise<Loaded>>()

async function json(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The sample data did not load (${response.status}).`)
  return response.json()
}

const readerOf = (files: ReadonlyMap<string, ReviewFileContents>) => (fileId: string, side: 'added' | 'deleted') =>
  (side === 'added' ? files.get(fileId)?.head : files.get(fileId)?.base) ?? null

/** The same check the host will run: a review whose anchors no longer match its files is refused. */
function opened(raw: unknown, contents: readonly ReviewFileContents[]): Loaded {
  const files = new Map(contents.map((file) => [file.fileId, file]))
  return { review: openReview(raw, readerOf(files)), files, assessment: null }
}

/**
 * The sample pull request is told as the host tells a change review's story, a step per unit and none for a test, which
 * the validator learns from the host's side (spec 032). Until it does, the sample's own test holds it to every other
 * rule, and here its bytes are checked as any review's are.
 */
async function openPull(id: string): Promise<Loaded> {
  // Built in code from its file texts, and only when a sample pull request is opened.
  const { pullAssessment, pullFiles, pullReview } = await import('./sample/pull.ts')
  const review = pullReview(id)
  const files = new Map(pullFiles().map((file) => [file.fileId, file]))
  const stale = staleAnchors(review, readerOf(files))
  if (stale.length > 0) throw new ReviewRefused('The sample pull request no longer matches its files.', stale)
  return { review, files, assessment: pullAssessment() }
}

async function read(id: string): Promise<Loaded> {
  if (isSamplePull(id)) return openPull(id)
  const sample = SAMPLES[id]
  if (!sample) throw new Error(`There is no review named ${id}.`)
  const [raw, contents] = await Promise.all([json(sample.review), json(sample.files)])
  return opened(raw, contents as ReviewFileContents[])
}

function load(id: string): Promise<Loaded> {
  let pending = loading.get(id)
  if (!pending) {
    pending = read(id)
    // A failed load is not kept, so opening the review again tries again.
    pending.catch(() => loading.delete(id))
    loading.set(id, pending)
  }
  return pending
}

export const sampleSource: ReviewSource = {
  async getReview(id) {
    return (await load(id)).review
  },
  async getFile(reviewId, fileId) {
    const file = (await load(reviewId)).files.get(fileId)
    if (!file) throw new Error(`${fileId} is not a file of this review.`)
    return file
  },
  async getAssessment(id) {
    return (await load(id)).assessment
  },
}

/** The named samples. A sample pull request is told by its id instead (`isSamplePull`). */
export const SAMPLE_REVIEWS = Object.keys(SAMPLES)
