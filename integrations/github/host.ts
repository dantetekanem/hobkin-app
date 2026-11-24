import type { GitHubState } from '#shared/protocol/github.ts'
import type { HostContext, HostPart, HostPartFactory } from '#host/integration-contract.ts'
import { GH_TIMEOUT_MS, ghSource } from './host/gh.ts'
import { GitHub, type GitHubSource } from './host/github.ts'
import { issueHandlers, issueWorkReader } from './host/issues.ts'
import { sampleGitHubSource } from './host/sample.ts'

/**
 * GitHub's part of the host (_specs/024-github, _specs/064-integration-drops): the GitHub reader and the issue
 * commands. It reads through gh when the host has gh and shows made-up data otherwise.
 */

/** The commands whose end brings a pull request or an issue closing, so GitHub is read again once they are done. */
const READ_AFTER = ['work.change', 'work.group']

const githubPart: HostPartFactory = (context: HostContext): HostPart => {
  const given = context.options.source as GitHubSource | undefined
  // gh runs for real only when the host was given gh.
  const { gh } = context
  const source = given ?? (gh ? ghSource((args) => gh(args, undefined, { timeoutMs: GH_TIMEOUT_MS })) : sampleGitHubSource())
  const github = new GitHub({ source, onChange: context.changed, wanted: context.connected, log: context.log })
  const issueWork = issueWorkReader(context.dataRoot)

  const handlers = issueHandlers({ app: context.hobkin, root: context.dataRoot, gh, refreshGitHub: () => github.refresh() })

  return {
    state: (): GitHubState => issueWork(github.state, context.snapshotWork()),
    handlers: { 'github.refresh': () => github.refresh(), ...handlers },
    start: () => github.start(),
    close: () => github.close(),
    afterCommand: ({ name, outcome }) => {
      if (READ_AFTER.includes(name) && outcome.ok) github.readSoon()
    },
    onMerged: (pull) => (pull.url || pull.repo ? github.closed(pull) : github.readSoon()),
    pulls: () => ({ mine: github.state.pulls, waiting: github.state.reviews, sample: github.state.sample }),
  }
}

export default githubPart
