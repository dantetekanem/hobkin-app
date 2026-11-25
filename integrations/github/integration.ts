import { Type } from 'typebox'
import { defineIntegration } from '#shared/integration/manifest.ts'
import type { GitHubState } from './protocol.ts'

/**
 * GitHub, through the user's own gh, with the login gh already has (_specs/024-github). Its page lists the pull
 * requests waiting for the user's review, the user's own pull requests and their issues; an issue can be added to
 * hobkin's work queue or closed. It only writes on the user's word.
 */

const repo = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9_.-]+$', maxLength: 200 })
const number = Type.Integer({ minimum: 1, maximum: 1000000000 })

export default defineIntegration({
  id: 'github',
  name: 'GitHub',
  line: 'Pull requests and issues, through gh',
  screens: [{ id: 'github', label: 'GitHub', line: 'Pull requests and issues, through gh', keywords: ['pull requests', 'issues', 'reviews', 'gh'] }],
  commands: {
    'github.refresh': {
      description:
        "Read the user's GitHub again through gh, with the login gh already has: the pull requests waiting for their review, their own open pull requests, and their open issues. It only reads. A read already under way answers this one too.",
      runs: 'host',
      args: Type.Object({}, { additionalProperties: false }),
    },
    'github.issue.add': {
      description:
        "Add a GitHub issue to hobkin's work queue, by its repository `owner/name` and its number: the host finds the hobkin project whose repository is github.com/owner/name, reads the issue through gh, only reading, and files it with hobkin's own `issue` work action, first in the queue. A bug label makes it a fix, a security label security work. Adding it again changes nothing and says so. With `again: true`, once the work hobkin filed for the issue last is finished, hobkin files a follow-up item for it (\"Follow-up: …\"), first in the queue; while that work is still open, running or waiting, nothing changes and hobkin says so. Refused with the reason when no hobkin project is that repository.",
      runs: 'host',
      args: Type.Object({ repo, number, again: Type.Optional(Type.Literal(true)) }, { additionalProperties: false }),
    },
    'github.issue.close': {
      description:
        "Close a GitHub issue through gh, as the user and only on their word from the GitHub page, by its repository `owner/name` and its number: `reason` is `completed` or `not-planned`. When hobkin has work filed for the issue that is not finished, hobkin's own work actions decline that item too, and a run going on it stops as not approved. GitHub's lists are read again after, so the issue leaves them.",
      runs: 'host',
      args: Type.Object(
        { repo, number, reason: Type.Union([Type.Literal('completed'), Type.Literal('not-planned')]) },
        { additionalProperties: false },
      ),
    },
  },
})

/** What each command answers. */
export interface GitHubResults {
  'github.refresh': GitHubState
  /** What hobkin said: the issue was added, or it was already filed; with `again`, the follow-up it filed, or that the work is still under way. */
  'github.issue.add': { message: string }
  /** What was done, in plain words: the issue closed on GitHub, and what hobkin said of its item, when it had one to decline. */
  'github.issue.close': { message: string }
}
