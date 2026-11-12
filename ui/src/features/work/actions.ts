import type { CommandArgs, ExecutionTarget, StartupTarget, StartupForceReceipt, StopExecutionArgs, StopExecutionReceipt } from '#shared/commands/registry.ts'
import type { HostState } from '../../lib/host/state.ts'
import type { StopControlTarget } from '#shared/protocol/snapshot.ts'
import type { ChangeChoice, FinishedChange, FinishedGroup, Grade, PrMode } from '#shared/protocol/work.ts'

/**
 * What the Work screen asks for. Each is one of hobkin's own work actions, carried out by the host
 * (`host/src/work.ts`). Pure, so the mapping is tested without a window. Spec: 011-work.
 */

/** A card's choice that hobkin carries out. "Show the diff" (Change Review) and "Open the PR" stay in the window. `changes` is a typed note. */
export type HobkinChoice = Exclude<ChangeChoice, 'diff' | 'open'> | 'changes'

export type WorkAction =
  | { do: 'mode'; on: boolean; folder?: string }
  | { do: 'queue'; key: string; action: 'run' | 'now' | 'skip' | 'back' }
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

export type ExecutionControl = ExecutionTarget & StopControlTarget
export const executionKey = (target: ExecutionTarget, mode?: StopExecutionArgs['mode']) => JSON.stringify([target.home, target.epoch, target.kind, target.runId, target.agentId ?? null, mode ?? null])
let disconnected: string | undefined
const sourceOf = (state: Pick<HostState, 'home' | 'epoch'>) => JSON.stringify([state.home, state.epoch])
export function observeExecutionBoundary(state: HostState, previous: HostState) {
  if (state.link !== 'open' && previous.link === 'open') disconnected = sourceOf(state)
  if (state.home !== previous.home || state.epoch !== previous.epoch) disconnected = undefined
}
export function executionTargets(state: Pick<HostState, 'link' | 'home' | 'owner' | 'snapshot' | 'epoch'>): ExecutionControl[] {
  const controls = state.snapshot.stopControls
  if (
    state.link !== 'open' ||
    state.owner?.state !== 'live' ||
    !controls ||
    controls.home !== state.home ||
    disconnected === sourceOf(state)
  ) return []
  return controls.targets.map(target => ({ ...target, home: controls.home, epoch: controls.epoch }))
}
export function confirmExecution(target: ExecutionControl, current: () => ExecutionControl[], send: () => void) {
  let consumed = false
  return (yes: boolean) => {
    if (consumed) return
    consumed = true
    if (
      yes &&
      current().some(
        now =>
          executionKey(now) === executionKey(target) &&
          now.label === target.label &&
          now.rootId === target.rootId &&
          now.parentId === target.parentId,
      )
    ) send()
  }
}
export const startupKey = (target: StartupTarget | null) => target ? JSON.stringify([target.home, target.epoch, target.token, target.sessionId]) : null
export function startupTarget(state: HostState): StartupTarget | null {
  const target = state.owner?.startup?.target
  return state.link === 'open' && disconnected !== sourceOf(state) && target?.home === state.home ? target : null
}
export function confirmStartup(target: StartupTarget, current: () => StartupTarget | null, send: () => void) {
  let consumed = false
  return (yes: boolean) => {
    if (consumed) return
    consumed = true
    if (yes && startupKey(current()) === startupKey(target)) send()
  }
}
export function startupReceiptText(receipt: StartupForceReceipt): string {
  return `Force: fence ${receipt.fence.status}; captured closure ${receipt.closure.status}; opening ${receipt.opening.status}; outer cleanup ${receipt.cleanup.status}; persistence ${receipt.persistence.status}; detached cleanup ${receipt.detachedCleanup}; queue recovery ${receipt.queueRecovery}.`
}
export function receiptText(receipt: StopExecutionReceipt): string {
  return `${receipt.mode === 'force' ? 'Force' : 'Stop'}: cancellation ${receipt.stop.status}; captured closure ${receipt.closure.status}; descendants ${receipt.descendants.status} (${receipt.descendants.cleanupScope}); detached cleanup ${receipt.descendants.detachedCleanup}.${receipt.message ? ` ${receipt.message}` : ''}`
}

export interface ExecutionResult {
  target: ExecutionControl
  text: string
  receipt?: StopExecutionReceipt
  order: number
}
export function executionFeedbackRows(targets: ExecutionControl[], results: Record<string, ExecutionResult>) {
  const live = new Set(targets.map(target => executionKey(target)))
  const rows = targets.map(target => ({ target, active: true, result: results[executionKey(target)] }))
  for (const [key, result] of Object.entries(results)) {
    if (live.has(key) || executionKey(result.target) !== key) continue
    rows.push({ target: result.target, active: false, result })
  }
  return rows
}
export function latestMainExecutionResult(main: ExecutionControl | undefined, results: Record<string, ExecutionResult>) {
  if (main) return results[executionKey(main)]
  return Object.values(results)
    .filter(result => result.target.kind === 'main')
    .reduce<ExecutionResult | undefined>((latest, result) => !latest || result.order > latest.order ? result : latest, undefined)
}

export interface AgentStopTarget { id: string; title: string; project: string; kind: string; source?: string; mode?: StopExecutionArgs['mode'] }
export function createStopConfirmationAuthority(target: AgentStopTarget, current: () => AgentStopTarget | undefined, send: (how: 'for-now' | 'not-approved') => void) {
  let consumed = false
  return (how: 'for-now' | 'not-approved' | null) => {
    if (consumed) return
    consumed = true
    if (!how) return
    const agent = current()
    if (
      agent?.id === target.id &&
      agent.title === target.title &&
      agent.project === target.project &&
      agent.kind === target.kind &&
      agent.source === target.source
    ) send(how)
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
  send: (id: string, mode?: StopExecutionArgs['mode']) => Promise<string>
  changed: (state: AgentControlState) => void
}) {
  let state: AgentControlState = { target: null, busy: false, result: null }
  const pending = new Map<string, symbol>()
  let latest: symbol | undefined
  const identity = (target: AgentStopTarget) => `${target.source ?? ''}\0${target.id}\0${target.mode ?? 'stop'}`
  const update = (next: Partial<AgentControlState>) => { state = { ...state, ...next }; changed(state) }
  const current = (id: string) => { const agent = selected(); return agent?.id === id ? agent : undefined }
  return {
    reset() {
      pending.clear()
      latest = undefined
      update({ target: null, busy: false, result: null })
    },
    pending: (id: string | null, mode: StopExecutionArgs['mode'] = 'stop') => { const target = id === null ? undefined : current(id); return target !== undefined && pending.has(identity({ ...target, mode })) },
    request(id: string, mode?: StopExecutionArgs['mode']) {
      const selected = current(id)
      const target = selected && mode ? { ...selected, mode } : selected
      if (target && pending.has(identity(target))) return
      if (state.target && state.target.source === target?.source && state.target.mode === target?.mode) return
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
      if (
        !now ||
        now.title !== target.title ||
        now.project !== target.project ||
        now.kind !== target.kind ||
        now.source !== target.source
      ) {
        update({ target: null, result: { id: target.id, text: 'This agent has changed or finished. Nothing was stopped.' } })
        return
      }
      const token = latest = Symbol(target.id)
      const key = identity(target)
      pending.set(key, token)
      update({ target: null, busy: true })
      let text: string
      try {
        text = await send(target.id, target.mode)
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
