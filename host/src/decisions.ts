import type { HostHandlers } from './commands.ts'
import type { WorkApp } from './work.ts'

/**
 * Action Items answered from the window, each through hobkin's own action (012-reports-actions): `decide` for one
 * of a decision's choices and `words` for the user's own words, as hobkin's Decisions tab answers them, and
 * `learning` for one of its learning proposals. What an answer then does (a merge, a note to the routine that
 * asked, a hand-off to the main agent) is hobkin's, and a refusal comes back in hobkin's words.
 */

interface Said {
  message?: unknown
  handOff?: unknown
}

const messageOf = (result: unknown) => String((result as Said | null)?.message ?? '')

export function decisionHandlers({ app }: { app: () => Pick<WorkApp, 'workAction'> }): Pick<HostHandlers, 'decision.answer' | 'learning.answer'> {
  return {
    'decision.answer': async ({ id, value, typed }) => {
      const result = (await (typed === undefined ? app().workAction('decide', id, value) : app().workAction('words', id, typed))) as Said | null
      // Doing it with hobkin hands the item to the main agent in Chat, and it stays in Action Items until it is done.
      return { message: messageOf(result), handedOff: Boolean(result?.handOff) }
    },
    'learning.answer': async ({ id, value }) => ({ message: messageOf(await app().workAction('learning', id, value)) }),
  }
}
