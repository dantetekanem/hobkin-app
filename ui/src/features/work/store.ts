import { create } from 'zustand'
import { activeCanvasScreen, requestCanvasFocus } from '@/app/focus.ts'
import { useView } from '@/app/view-store.ts'
import { hasHost } from '@/lib/host/frame.ts'
import type { WorkState } from '#shared/protocol/work.ts'
import { hostStore, runCommand, useHasHost, useWork } from '@/lib/host/index.ts'
import { commandFor, type WorkAction } from './actions.ts'
import { applySample } from './sample-actions.ts'
import { sampleWork } from './sample.ts'

/**
 * The Work screen's own state: the sample for a window with no host, what is under way, and the last thing hobkin
 * said about each place on the screen. What work mode is lives in hobkin. Spec: 011-work.
 */

/** hobkin's answer to an action, for the place it was taken from. `lines` are a group's rows, one each. */
export interface Said {
  tone: 'done' | 'refused'
  text: string
  lines?: string[]
}

interface WorkUi {
  sample: WorkState
  /** Places with an action under way: a card's key, `group:merge`, a queue row's key, a project's slug, `mode`, an agent's id. */
  busy: Readonly<Record<string, true>>
  said: Readonly<Record<string, Said>>
  forget: (place: string) => void
  /** Puts what hobkin said somewhere else, as a card that left hands its line to its section. */
  note: (place: string, said: Said) => void
}

export const useWorkUi = create<WorkUi>()((set, get) => ({
  sample: sampleWork(),
  busy: {},
  said: {},
  forget: (place) => {
    if (!(place in get().said)) return
    const { [place]: _gone, ...said } = get().said
    set({ said })
  },
  note: (place, said) => set({ said: { ...get().said, [place]: said } }),
}))

const activeRuns = new Map<string, symbol>()

let worldProject: { slug: string; source: string } | null = null
const worldSource = () => JSON.stringify([hostStore.getState().home, hostStore.getState().epoch])
const currentWork = () => hasHost(hostStore.getState()) ? hostStore.getState().work : useWorkUi.getState().sample
const chosenProject = (slug: string) => currentWork()?.projects.some(project => project.slug === slug && project.state === 'chosen')

/** Navigation only: a retained scene cannot target a replacement home's identically named project. */
export function returnToWorldProject(slug: string, source: string): boolean {
  if (useView.getState().screen !== 'world' || source !== worldSource() || !chosenProject(slug)) return false
  worldProject = { slug, source }
  useView.getState().openScreen('work')
  requestCanvasFocus()
  return true
}

/** Arriving Work consumes once, never on reload or after another navigation. */
export function takeWorldProject(): string | null {
  const pending = worldProject
  worldProject = null
  return pending && useView.getState().screen === 'work' && pending.source === worldSource() && chosenProject(pending.slug) ? pending.slug : null
}

/** Intercept only this explicit arrival before Work's ordinary first-control handoff. */
export function bindWorldProject(root: HTMLElement | null): (() => void) | undefined {
  const pending = worldProject
  const slug = pending?.slug
  const source = pending?.source
  const section = root?.closest<HTMLElement>('[data-canvas-screen]')
  const target = [...(root?.querySelectorAll<HTMLElement>('[data-world-project]') ?? [])].find(row => row.dataset.worldProject === slug)
  if (!slug || !section || !target) return
  const take = (event?: FocusEvent) => {
    if (worldProject !== pending || source !== worldSource() || !chosenProject(slug) || useView.getState().screen !== 'work' || section !== activeCanvasScreen() || document.activeElement !== section || (event && event.target !== section)) return
    worldProject = null
    event?.stopImmediatePropagation()
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest' })
  }
  section.addEventListener('focus', take)
  take()
  return () => section.removeEventListener('focus', take)
}

const unsubscribeWorld = useView.subscribe((state) => {
  if (state.screen !== 'work') worldProject = null
})
import.meta.hot?.dispose(unsubscribeWorld)

const unsubscribeHost = hostStore.subscribe((state, previous) => {
  if (state.home === previous.home && state.epoch === previous.epoch && state.link === previous.link) return

  activeRuns.clear()
  worldProject = null
  const { busy, said } = useWorkUi.getState()
  if (Object.keys(busy).length || Object.keys(said).length) useWorkUi.setState({ busy: {}, said: {} })
})
import.meta.hot?.dispose(unsubscribeHost)

/** Work mode to draw: the host's once a host has answered, the sample before that. Null while a host has not said. */
export function useWorkView(): { work: WorkState | null; live: boolean } {
  const live = useHasHost()
  const hosted = useWork()
  const sample = useWorkUi((state) => state.sample)
  return { work: live ? hosted : sample, live }
}

// A card's yes on the sample takes a moment, as it does in hobkin, so what is under way can be seen.
const SAMPLE_PAUSE_MS = 420
const runsAWhile = (action: WorkAction) => action.do === 'change' || action.do === 'group'

/**
 * Carries an action out: as the host's command, which is hobkin's own work action, or on the sample without a host.
 * What hobkin says comes back to `place`, the part of the screen it was taken from: a refusal in hobkin's words,
 * or what was done.
 */
export async function runWork(action: WorkAction, { live, place }: { live: boolean; place: string }): Promise<Said> {
  const { busy, forget } = useWorkUi.getState()
  if (busy[place]) return { tone: 'refused', text: 'This is already under way.' }

  forget(place)
  const run = Symbol(place)
  activeRuns.set(place, run)
  useWorkUi.setState({ busy: { ...busy, [place]: true } })

  let said: Said
  try {
    said = live ? await onHost(action) : await onSample(action)
  } catch (error) {
    said = { tone: 'refused', text: error instanceof Error ? error.message : String(error) }
  }

  if (activeRuns.get(place) === run) {
    activeRuns.delete(place)
    const { [place]: _done, ...stillBusy } = useWorkUi.getState().busy
    useWorkUi.setState({ busy: stillBusy })
    if (said.text || said.lines?.length) useWorkUi.getState().note(place, said)
  }
  return said
}

/** The host's command for the action. A refusal rejects, with hobkin's words. */
async function onHost(action: WorkAction): Promise<Said> {
  const call = commandFor(action)
  // The call's name and arguments travel together, so the pair is always one the registry knows.
  const run = runCommand as (name: string, args: unknown) => Promise<{ message?: string; lines?: string[] } | null>
  const answer = await run(call.name, call.args)

  return {
    tone: 'done',
    text: answer?.message ?? '',
    ...(answer?.lines ? { lines: answer.lines } : {}),
  }
}

async function onSample(action: WorkAction): Promise<Said> {
  if (runsAWhile(action)) await new Promise((resolve) => setTimeout(resolve, SAMPLE_PAUSE_MS))

  const outcome = applySample(useWorkUi.getState().sample, action)
  if ('refused' in outcome) return { tone: 'refused', text: outcome.refused }

  useWorkUi.setState({ sample: outcome.state })
  return {
    tone: 'done',
    text: outcome.message,
    ...(outcome.lines ? { lines: outcome.lines } : {}),
  }
}
