import { useSyncExternalStore } from 'react'
import { useSettings } from '@/features/settings/store.ts'
import { isStill } from './still-rule.ts'

export { holdStill, stillVariants } from './still-rule.ts'

const reduce = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null

function subscribe(listener: () => void): () => void {
  reduce?.addEventListener('change', listener)
  return () => reduce?.removeEventListener('change', listener)
}

/**
 * True while movement should hold still. Motion's own reduced motion leaves whole `transform` strings alone,
 * and the app's movement is written with them, so the parts that travel ask this and keep only their fades.
 */
export function useStill(): boolean {
  const movement = useSettings((state) => state.movement)
  const macAsksForLess = useSyncExternalStore(subscribe, () => reduce?.matches ?? false, () => false)
  return isStill(movement, macAsksForLess)
}
