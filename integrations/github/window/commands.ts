import { runnerFor } from '@/integration/commands.ts'
import manifest, { type GitHubResults } from '../integration.ts'

/** GitHub's own commands, typed from its manifest. */
export const run = runnerFor<GitHubResults>()(manifest)
