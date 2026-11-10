/**
 * Where the review screen gets a review and its files. Sample data for now: one real hobkin commit and a
 * made-up stress change, both written by `scripts/review-sample.ts`. The host's `review.get` and
 * `review.file` commands take this interface's place when they exist (005 S6).
 */
import type { Review, ReviewFileContents, ReviewSource } from '#shared/review/types.ts'
import { openReview } from '#shared/review/validate.ts'
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
}

const loading = new Map<string, Promise<Loaded>>()

async function json(url: string): Promise<unknown> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`The sample data did not load (${response.status}).`)
  return response.json()
}

function load(id: string): Promise<Loaded> {
  const sample = SAMPLES[id]
  if (!sample) return Promise.reject(new Error(`There is no review named ${id}.`))
  let pending = loading.get(id)
  if (!pending) {
    pending = Promise.all([json(sample.review), json(sample.files)]).then(([raw, contents]) => {
      const files = new Map((contents as ReviewFileContents[]).map((file) => [file.fileId, file]))
      // The same check the host will run: a review whose anchors no longer match its files is refused.
      const review = openReview(raw, (fileId, side) => (side === 'added' ? files.get(fileId)?.head : files.get(fileId)?.base) ?? null)
      return { review, files }
    })
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
}

export const SAMPLE_REVIEWS = Object.keys(SAMPLES)
