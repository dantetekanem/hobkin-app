import { useReducedMotion } from 'motion/react'
import { createContext, useContext, type ReactNode } from 'react'
import { useStore } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import type { ReviewSource } from '#shared/review/types.ts'
import { useSettings } from '@/features/settings/store.ts'
import { useDev } from '../dev/dev.ts'
import type { CameraRig } from '../story/useCamera.ts'
import { createReviewMemory, memoryStorage, type MemoryState } from './memory.ts'
import type { Session, SessionStore } from './session.ts'

function browserStorage(): StateStorage {
  try {
    localStorage.getItem('hobkin-client-review')
    return localStorage
  } catch {
    // Storage can be unavailable. The review still works, and forgets when the window closes.
    return memoryStorage()
  }
}

/** What the reviewer left in every review, kept across reloads. */
export const reviewMemory = createReviewMemory(browserStorage())

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
