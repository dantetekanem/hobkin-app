import { GitPullRequest } from 'lucide-react'
import { GITHUB_UNKNOWN, sampleGitHub, type GitHubState } from './protocol.ts'
import type { WindowPart } from '@/integration/contract.ts'
import manifest from './integration.ts'
import { GitHubCard } from './window/GitHubCard.tsx'
import { GitHubScreen } from './window/GitHubScreen.tsx'
import { githubHome } from './window/home.ts'
import { githubSpotlight } from './window/spotlight.ts'

/** GitHub's part of the window (_specs/065-integration-drops): its page, its card on Integrations, its mark, and the pull requests Work reads. */
const part: WindowPart<GitHubState> = {
  manifest,
  unknown: GITHUB_UNKNOWN,
  sample: (now) => sampleGitHub(now),
  screens: [{ id: 'github', icon: GitPullRequest, component: GitHubScreen }],
  card: GitHubCard,
  mark: { symbol: 'Gh', hue: 162 },
  pulls: (state) => [...state.reviews, ...state.pulls],
  home: githubHome,
  spotlight: githubSpotlight,
}

export default part
