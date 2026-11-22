import { useReducedMotion } from 'motion/react'
import { createContext, useContext, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import type { StoreApi } from 'zustand/vanilla'
import type { ReviewSource } from '#shared/review/types.ts'
import { useSettings } from '@/features/settings/store.ts'
import { useDev } from '../dev/dev.ts'
import type { CameraRig } from '../story/useCamera.ts'
import { createReviewMemory, memoryStorage, throttledStorage, type MemoryState } from './memory.ts'
import type { Session, SessionStore } from './session.ts'

/** The browser's storage, written at most once a second: a move through a review writes nothing by itself (spec 053). */
function browserStorage(): StateStorage & { flush(): void } {
  try {
    localStorage.getItem('hobkin-client-review')
    return throttledStorage(localStorage)
  } catch {
    // Storage can be unavailable. The review still works, and forgets when the window closes.
    return { ...memoryStorage(), flush: () => {} }
  }
}

/*
 * One store for the window, kept on globalThis. A hot update runs this file again, and a second store would not reach
 * the review on screen, which holds the one it opened with, while both wrote over each other in storage. So the store
 * is kept while its own code is the same, and when that code changed a window showing a review loads again instead.
 */
const holder = globalThis as { __hobkinReviewMemory?: { store: StoreApi<MemoryState>; made: typeof createReviewMemory; flush?: () => void } }
const kept = holder.__hobkinReviewMemory
const fresh = !kept || kept.made !== createReviewMemory
const reloading = import.meta.hot != null && fresh && typeof document !== 'undefined' && document.querySelector('[data-rv-root]') != null
if (reloading) location.reload()

/** What the reviewer left in every review, kept across reloads. */
export const reviewMemory: StoreApi<MemoryState> = kept && (!fresh || reloading) ? kept.store : keepMemory()
function keepMemory(): StoreApi<MemoryState> {
  const storage = browserStorage()
  return (holder.__hobkinReviewMemory = { store: createReviewMemory(storage), made: createReviewMemory, flush: storage.flush }).store
}

/** Writes what the reviewer left in every review to storage now, without waiting for the second to pass: a review closes. */
export function flushReviewMemory(): void {
  holder.__hobkinReviewMemory?.flush?.()
}

export function useReviewMemory<Value>(selector: (state: MemoryState) => Value): Value {
  return useStore(reviewMemory, selector)
}

interface Stage {
  session: SessionStore
  source: ReviewSource
  camera: CameraRig
}

const StageContext = createContext<Stage | null>(null)

export function StageProvider({ value, children }: { value: Stage; children: ReactNode }) {
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>
}

function useStage(): Stage {
  const stage = useContext(StageContext)
  if (!stage) throw new Error('This part of the review screen was drawn outside an open review.')
  return stage
}

/** Reads the open review's session. The component draws again only when what it selected changes. */
export function useSession<Value>(selector: (session: Session) => Value): Value {
  return useStore(useStage().session, selector)
}

export function useSessionStore(): SessionStore {
  return useStage().session
}

export function useSource(): ReviewSource {
  return useStage().source
}

export function useRig(): CameraRig {
  return useStage().camera
}

/**
 * True when movement should be dropped. The app's own Movement setting decides: Still always drops it,
 * Lively never does, and otherwise the Mac's reduced-motion setting is followed. The development switch
 * drops it too, because the Mac's setting cannot be turned on from the page.
 */
export function useReduced(): boolean {
  const system = useReducedMotion()
  const movement = useSettings((settings) => settings.movement)
  const forced = useDev((dev) => dev.reducedMotion)
  return forced || movement === 'still' || (movement === 'system' && Boolean(system))
}
