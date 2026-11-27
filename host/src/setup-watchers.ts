import { goalCards } from 'hobkin/src/cli/routine-templates.mjs'
import type { SetupWatchers } from '#shared/protocol/setup.ts'
import type { HostHandlers } from './commands.ts'

/**
 * The routine cards of the setup (044-goal-first-setup): for each goal asked for, its starters and its more, read by
 * hobkin's own `goalCards` from its templates and the user's own. It only reads.
 */
export function setupWatcherHandlers({ root }: { root: () => string }): Pick<HostHandlers, 'setup.watchers'> {
  return {
    'setup.watchers': ({ goals }): SetupWatchers => ({ goals: goalCards(root(), goals) }),
  }
}
