import { useEffect, useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import { sampleAgents, sampleModels, sampleProjects, sampleSessions, sampleStatus, type SampleAgent, type SampleProject, type SampleSession } from '@/app/sample.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { ProofsState } from '#shared/protocol/proofs.ts'
import type { LudicrousState } from '#shared/protocol/ludicrous.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { hostStore, watchJob } from './client.ts'
import { listStore, screenStore } from './screen.ts'
import { actionItemCountFrom, agentsFrom, connectionFrom, hasHost, keepEachEqual, keepEqual, mainModelFrom, projectsFrom, sameAgentsQuietly, type Connection } from './frame.ts'
import { canUseModel, type HostState } from './state.ts'

/** Holds `job` watched while the component is mounted, so a host that takes watching sends its whole steps (`watch.ts`). */
export function useWatchJob(job: string | null): void {
  useEffect(() => (job ? watchJob(job) : undefined), [job])
}

/**
 * Reads the host's state as the screen draws it, once per animation frame and not while the window is hidden
 * (`screen.ts`). The component draws again only when what it selected changes.
 */
export function useHost<Selected>(selector: (state: HostState) => Selected): Selected {
  return useStore(screenStore, selector)
}

/** Like `useHost`, for a reader that lists agents: it takes the host's state at most five times a second. */
export function useListHost<Selected>(selector: (state: HostState) => Selected): Selected {
  return useStore(listStore, selector)
}

/**
 * Reads the host's state, for a selection that is made anew from each message (a list, an agent, a control): the
 * component draws again only when the selection no longer says the same by `same`, not for every message the host sends.
 */
export function useHostEqual<Selected>(selector: (state: HostState) => Selected, same: (a: Selected, b: Selected) => boolean): Selected {
  return useHostKept(selector, (held, next) => keepEqual(held, next, same))
}

/** Like `useHostEqual`, with `keep` choosing what stays of the value held: a list can keep each of its items that says the same. */
export function useHostKept<Selected>(selector: (state: HostState) => Selected, keep: (held: Selected, next: Selected) => Selected): Selected {
  return useKept(screenStore, selector, keep)
}

/** Like `useHostKept`, for a reader that lists agents: it takes the host's state at most five times a second. */
export function useListHostKept<Selected>(selector: (state: HostState) => Selected, keep: (held: Selected, next: Selected) => Selected): Selected {
  return useKept(listStore, selector, keep)
}

function useKept<Selected>(store: StoreApi<HostState>, selector: (state: HostState) => Selected, keep: (held: Selected, next: Selected) => Selected): Selected {
  const held = useRef<{ value: Selected } | null>(null)
  return useStore(store, (state) => {
    const value = held.current ? keep(held.current.value, selector(state)) : selector(state)
    held.current = { value }
    return value
  })
}

/** Whether this window has a host (`hasHost`): always in the Mac window. Without one the frame draws sample data, labelled as such. */
export function useHasHost(): boolean {
  return useHost(hasHost)
}

/** Where the data on screen comes from: sample, a live host, or a host that is starting or went away. */
export function useConnection(): Connection {
  const link = useHost((state) => state.link)
  const home = useHost((state) => state.home)
  const owner = useHost((state) => state.owner)
  const model = useHost((state) => state.model)
  return useMemo(() => connectionFrom({ ...hostStore.getState(), link, home, owner, model }), [link, home, owner, model])
}

const hostAgents = (state: HostState) => agentsFrom(state.snapshot)
const keepQuietly = (held: SampleAgent[], next: SampleAgent[]) => keepEachEqual(held, next, sameAgentsQuietly) as SampleAgent[]

/**
 * Every agent and routine running now, at most five times a second. Each agent stays the one held while it says the
 * same apart from its latest words (`update`), and the list while every agent does, so a reader draws again when an
 * agent starts or ends, or starts a tool, not for each word the agents stream. A reader that draws `update` reads
 * `useRunningAgents({ withUpdate: true })`.
 */
export function useAgents(): SampleAgent[] {
  const live = useHasHost()
  const hosted = useListHostKept(hostAgents, keepQuietly)
  return live ? hosted : sampleAgents
}

export function useRunningCount(): number {
  return useAgents().length
}

/** The model hobkin's main conversation uses, and how hard it thinks. */
export function useMainModel(): { model: string; effort: string } {
  const live = useHasHost()
  const main = useHost((state) => state.snapshot.main)
  return useMemo(() => (live ? mainModelFrom({ main }) : { model: sampleStatus.model, effort: sampleStatus.effort }), [live, main])
}

export function useProjects(): SampleProject[] {
  const live = useHasHost()
  const work = useHost((state) => state.snapshot.work)
  return useMemo(() => (live ? projectsFrom({ work }) : sampleProjects), [live, work])
}

/** Earlier conversations. A live host has none to give until `014-continuity`. */
export function useSessions(): SampleSession[] {
  return useHasHost() ? NO_SESSIONS : sampleSessions
}

const NO_SESSIONS: SampleSession[] = []

/** The model providers and models, with whether the conversation can go on. */
export interface Models extends ModelsState {
  /** Pi can use at least one model. */
  ready: boolean
  /** No host has answered, so this is the frame's sample data. */
  sample: boolean
}

const NO_MODELS: ModelsState = { providers: [], models: [] }

/**
 * Every provider Pi knows, how each connects and whether it is connected, and the models Pi can use now, with
 * their thinking levels and context size. Sample data until a host answers.
 */
export function useModels(): Models {
  const live = useHasHost()
  const models = useHost((state) => state.models)
  const ready = useHost(canUseModel)
  return useMemo(() => (live ? { ...(models ?? NO_MODELS), ready, sample: false } : { ...sampleModels, ready: true, sample: true }), [live, models, ready])
}

/**
 * The question hobkin is asking now, or null. hobkin asks one at a time, oldest first, so this is always the
 * oldest one unanswered. Answer it with `answerQuestion` or put it off with `deferQuestion`.
 */
export function usePendingQuestion(): PendingQuestion | null {
  return useHost((state) => state.question)
}

/** How many things wait on the user, for the badge on Action items. */
export function useActionItemCount(): number {
  const live = useHasHost()
  const decisions = useHost((state) => state.snapshot.decisions)
  const waiting = useHost((state) => state.snapshot.waiting)
  return live ? actionItemCountFrom({ decisions, waiting }) : sampleStatus.actionItems
}

/**
 * Work mode as the host reads it from hobkin's snapshot, with hobkin's own rules: its switch, its queue, its
 * projects and the finished changes in its groups (011-work). Null without a host, from a host that has not said,
 * and while hobkin's snapshot has none. The Work screen draws its own sample when there is no host at all.
 */
export function useWork(): WorkState | null {
  return useHost((state) => state.work)
}

/**
 * TLA+ proof runs as the host reads them from hobkin's home (050-tla-proofs): the ones running and the 20 most recent,
 * newest first, with their latest counts, and the tools found. Null without a host and from a host from before them.
 * The whole of a run comes from `proof.get`.
 */
export function useProofs(): ProofsState | null {
  return useHost((state) => state.proofs ?? null)
}

/** Ludicrous mode's one run and the machine tiers this computer fits (076-ludicrous-mode). Null without a host and from a host from before it. */
export function useLudicrous(): LudicrousState | null {
  return useHost((state) => state.ludicrous ?? null)
}
