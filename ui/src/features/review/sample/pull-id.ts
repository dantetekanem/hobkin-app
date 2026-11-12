/**
 * Which reviews the sample pull request answers for: the pull requests of the GitHub page's sample, as
 * `pr:hobkin-sample/<repo>/<number>`. Kept apart from `pull.ts`, so telling an id needs none of the sample's data.
 */

/** The pull request the GitHub page's sample lists first. */
export const SAMPLE_PULL = 'pr:hobkin-sample/storefront/482'

const SAMPLE_PULL_ID = /^pr:hobkin-sample\/[\w.-]+\/\d+$/

/** True for every sample pull request: each opens the sample pull request, under its own id. */
export const isSamplePull = (id: string): boolean => SAMPLE_PULL_ID.test(id)
