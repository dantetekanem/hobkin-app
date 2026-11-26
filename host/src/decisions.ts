import type { HostHandlers } from './commands.ts'
import type { WorkApp } from './work.ts'

/**
 * Action Items answered from the window, each through hobkin's own action (012-reports-actions): `decide` for one
 * of a decision's choices, `words` for the user's own words, and `actionItem` for a particular generated card.
 * The runtime owns dispatch and its durable fallback; the command reports whether the choice was received,
 * not whether the underlying operation succeeded.
 */

interface Said {
  message?: unknown
  handOff?: unknown
}

const messageOf = (result: unknown) => String((result as Said | null)?.message ?? '')

export function decisionHandlers({ app }: { app: () => Pick<WorkApp, 'workAction'> }): Pick<HostHandlers, 'decision.answer' | 'action.answer' | 'learning.answer'> {
  return {
    'decision.answer': async ({ id, value, typed }) => {
      const action = typed === undefined ? 'decide' : 'words'
      const result = await app().workAction(action, id, typed ?? value, { actionItem: true }) as Said | null
      // Doing it with hobkin hands the item to the main agent in Chat, and it leaves Action Items.
      return { message: messageOf(result), handedOff: Boolean(result?.handOff) }
    },
    'action.answer': async ({ id, value }) => ({ message: messageOf(await app().workAction('actionItem', id, value)) }),
    'learning.answer': async ({ id, value }) => ({ message: messageOf(await app().workAction('learning', id, value)) }),
  }
}
