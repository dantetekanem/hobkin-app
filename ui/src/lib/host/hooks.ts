import { useMemo, useRef } from 'react'
import { useStore } from 'zustand'
import { sampleAgents, sampleModels, sampleProjects, sampleSessions, sampleStatus, type SampleAgent, type SampleProject, type SampleSession } from '@/app/sample.ts'
import { GITHUB_UNKNOWN, sampleGitHub, type GitHubState } from '#shared/protocol/github.ts'
import type { ModelsState } from '#shared/protocol/models.ts'
import type { PendingQuestion } from '#shared/protocol/question.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { hostStore } from './client.ts'
import { actionItemCountFrom, agentsFrom, connectionFrom, hasHost, keepEqual, mainModelFrom, projectsFrom, type Connection } from './frame.ts'
import { canUseModel, type HostState } from './state.ts'

/** Reads the host's state. The component draws again only when what it selected changes. */
export function useHost<Selected>(selector: (state: HostState) => Selected): Selected {
  return useStore(hostStore, selector)
}

/**
 * Reads the host's state, for a selection that is made anew from each message (a list, an agent, a control): the
 * component draws again only when the selection no longer says the same by `same`, not for every message the host sends.
 */
export function useHostEqual<Selected>(selector: (state: HostState) => Selected, same: (a: Selected, b: Selected) => boolean): Selected {
  const held = useRef<{ value: Selected } | null>(null)
  return useStore(hostStore, (state) => {
    const value = held.current ? keepEqual(held.current.value, selector(state), same) : selector(state)
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

/** Every agent and routine running now. */
export function useAgents(): SampleAgent[] {
  const live = useHasHost()
  const runs = useHost((state) => state.snapshot.runs)
  const jobActivity = useHost((state) => state.snapshot.jobActivity)
  return useMemo(() => (live ? agentsFrom({ runs, jobActivity }) : sampleAgents), [live, runs, jobActivity])
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

/** Made-up GitHub for a window with no host. Its times count back from when the window opened. */
const SAMPLE_GITHUB = sampleGitHub(Date.now())

/**
 * The user's GitHub as the host reads it through gh: the pull requests waiting for their review, their own pull
 * requests and their issues. Sample data until a host answers, and "not known yet" from a host that has not said.
 * The `github.refresh` command reads it again.
 */
export function useGitHub(): GitHubState {
  const live = useHasHost()
  const github = useHost((state) => state.github)
  return live ? (github ?? GITHUB_UNKNOWN) : SAMPLE_GITHUB
}

/**
 * Work mode as the host reads it from hobkin's snapshot, with hobkin's own rules: its switch, its queue, its
 * projects and the finished changes in its groups (011-work). Null without a host, from a host that has not said,
 * and while hobkin's snapshot has none. The Work screen draws its own sample when there is no host at all.
 */
export function useWork(): WorkState | null {
  return useHost((state) => state.work)
}
