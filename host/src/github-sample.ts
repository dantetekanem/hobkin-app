import { SAMPLE_GITHUB_LOGIN, sampleGitHub } from '#shared/protocol/github.ts'
import type { GitHubSource } from './github.ts'

/**
 * Made-up GitHub for the scripted host, so the GitHub page can be seen without reaching GitHub: gh never runs.
 * A read takes a moment, as a real one does, and every second read brings one more review request.
 */
export function sampleGitHubSource({ delayMs = 600, now = Date.now }: { delayMs?: number; now?: () => number } = {}): GitHubSource {
  let round = 0
  return {
    sample: true,
    read: async () => {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs).unref())
      const { reviews, pulls, issues, more } = sampleGitHub(now(), round++)
      return { found: 'connected', login: SAMPLE_GITHUB_LOGIN, lists: { reviews, pulls, issues, more }, note: null }
    },
  }
}
