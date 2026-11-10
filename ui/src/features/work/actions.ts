import type { CommandArgs } from '#shared/commands/registry.ts'
import type { ChangeChoice, FinishedChange, FinishedGroup, Grade, PrMode } from '#shared/protocol/work.ts'

/**
 * What the Work screen asks for. Each is one of hobkin's own work actions, carried out by the host
 * (`host/src/work.ts`). Pure, so the mapping is tested without a window. Spec: 011-work.
 */

/** A card's choice that hobkin carries out. "Show the diff" (Change Review) and "Open the PR" stay in the window. `changes` is a typed note. */
export type HobkinChoice = Exclude<ChangeChoice, 'diff' | 'open'> | 'changes'

export type WorkAction =
  | { do: 'mode'; on: boolean; folder?: string }
  | { do: 'queue'; key: string; action: 'run' | 'skip' | 'back' }
  | { do: 'priority'; slug: string; priority: Grade }
  | { do: 'prs'; slug: string; prs: PrMode }
  | { do: 'proposal'; slug: string; answer: 'take' | 'skip' }
  | { do: 'agents'; agents: number }
  | { do: 'change'; change: FinishedChange; choice: HobkinChoice; note?: string }
  | { do: 'group'; group: FinishedGroup }
  | { do: 'stop'; run: string; how: 'for-now' | 'not-approved' }

type WorkCommand = 'work.mode' | 'work.queue' | 'work.project' | 'work.proposal' | 'work.agents' | 'work.change' | 'work.group' | 'agent.stop'

/** A host command with its arguments. */
export type WorkCall = { [Name in WorkCommand]: { name: Name; args: CommandArgs<Name> } }[WorkCommand]

const CHANGE_ACTION = { merge: 'merge', mergePr: 'merge-pr', refreshMerge: 'refresh-merge', review: 'review', decline: 'decline' } as const

export function commandFor(action: WorkAction): WorkCall {
  switch (action.do) {
    case 'mode':
      return { name: 'work.mode', args: { on: action.on, ...(action.folder ? { folder: action.folder } : {}) } }
    case 'queue':
      return { name: 'work.queue', args: { row: action.key, action: action.action } }
    case 'priority':
      return { name: 'work.project', args: { slug: action.slug, priority: action.priority } }
    case 'prs':
      return { name: 'work.project', args: { slug: action.slug, prs: action.prs } }
    case 'proposal':
      return { name: 'work.proposal', args: { slug: action.slug, answer: action.answer } }
    case 'agents':
      return { name: 'work.agents', args: { agents: action.agents } }
    case 'change': {
      const { slug, item, head } = action.change
      const { choice } = action
      // "Have an agent rebase it" is a note with no words, and typed changes are the note (`cardRequest` in hobkin's `src/cli/ui.mjs`).
      if (choice === 'rebase' || choice === 'changes') return { name: 'work.change', args: { slug, item, action: 'ask', note: choice === 'changes' ? (action.note ?? '') : '' } }
      // A landing is pinned to the commit the card showed, so a change that moved since is refused.
      const lands = choice === 'merge' || choice === 'mergePr' || choice === 'refreshMerge'
      return { name: 'work.change', args: { slug, item, action: CHANGE_ACTION[choice], ...(lands && head ? { head } : {}) } }
    }
    case 'group':
      return { name: 'work.group', args: { rows: action.group.changes.map(({ slug, item, landing, head }) => ({ slug, item, how: landing, ...(head ? { head } : {}) })) } }
    case 'stop':
      return { name: 'agent.stop', args: { run: action.run, how: action.how } }
  }
}
