import { dismissActionItems } from 'hobkin/src/cli/pending-read.mjs'
import type { HostHandlers } from './commands.ts'

/**
 * Dismissing Action Items from the window, through hobkin's own dismissal (`dismissActionItems` in its
 * `src/cli/pending-read.mjs`, the one its hobkin_action_items tool uses). A dismissed card is not answered: whoever asked
 * hears nothing. hobkin's list is read again before the answer goes back, so the window's next snapshot has already
 * dropped the card when the answer reaches it.
 */
export function actionDismissalHandlers({ root, refresh }: { root: () => string; refresh: () => Promise<unknown> }): Pick<HostHandlers, 'action.dismiss'> {
  return {
    'action.dismiss': async ({ ids }) => {
      const result = dismissActionItems(root(), { ids })
      await refresh()
      return result
    },
  }
}
