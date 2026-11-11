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

export interface AgentStopTarget { id: string; title: string; project: string; kind: string; source?: string }
export function createStopConfirmationAuthority(target: AgentStopTarget, current: () => AgentStopTarget | undefined, send: (how: 'for-now' | 'not-approved') => void) {
  let consumed = false
  return (how: 'for-now' | 'not-approved' | null) => {
    if (consumed) return
    consumed = true
    if (!how) return
    const agent = current()
    if (agent?.id === target.id && agent.title === target.title && agent.project === target.project && agent.kind === target.kind && agent.source === target.source) send(how)
  }
}

export interface AgentControlState {
  target: AgentStopTarget | null
  busy: boolean
  result: { id: string; text: string } | null
}

/** A confirmation belongs to one selected execution, never the row that later takes its place. */
export function createAgentControls({ selected, send, changed }: {
  selected: () => AgentStopTarget | undefined
  send: (id: string) => Promise<string>
  changed: (state: AgentControlState) => void
}) {
  let state: AgentControlState = { target: null, busy: false, result: null }
  const pending = new Map<string, symbol>()
  let latest: symbol | undefined
  const identity = (target: AgentStopTarget) => `${target.source ?? ''}\0${target.id}`
  const update = (next: Partial<AgentControlState>) => { state = { ...state, ...next }; changed(state) }
  const current = (id: string) => { const agent = selected(); return agent?.id === id ? agent : undefined }
  return {
    reset() {
      pending.clear()
      latest = undefined
      update({ target: null, busy: false, result: null })
    },
    pending: (id: string | null) => { const target = id === null ? undefined : current(id); return target !== undefined && pending.has(identity(target)) },
    request(id: string) {
      const target = current(id)
      if (target && pending.has(identity(target))) return
      if (state.target && state.target.source === target?.source) return
      latest = Symbol(id)
      update({ target: target ? { ...target } : null, busy: false, result: target ? null : { id, text: 'This agent has changed or finished. Nothing was stopped.' } })
    },
    cancel() { update({ target: null }) },
    interrupt(id: string) {
      update({ result: { id, text: current(id) ? 'hobkin cannot interrupt one tool command without stopping this agent. Nothing was interrupted.' : 'This agent has finished. Nothing was interrupted.' } })
    },
    async confirm() {
      const target = state.target
      if (!target || pending.has(identity(target))) return
      const now = current(target.id)
      if (!now || now.title !== target.title || now.project !== target.project || now.kind !== target.kind || now.source !== target.source) {
        update({ target: null, result: { id: target.id, text: 'This agent has changed or finished. Nothing was stopped.' } })
        return
      }
      const token = latest = Symbol(target.id)
      const key = identity(target)
      pending.set(key, token)
      update({ target: null, busy: true })
      let text: string
      try {
        text = await send(target.id)
      } catch (error) {
        text = error instanceof Error ? error.message : String(error)
      }
      if (pending.get(key) !== token) return
      pending.delete(key)
      if (selected()?.source !== target.source) return
      const active = selected()
      update({
        busy: active !== undefined && pending.has(identity(active)),
        ...(latest === token ? { result: { id: target.id, text } } : {}),
      })
    },
  }
}

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
