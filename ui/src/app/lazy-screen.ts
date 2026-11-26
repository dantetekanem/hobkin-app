import { lazy, type ComponentType } from 'react'

const FAILED_LOAD = Symbol('screen load failed')

/** React keeps a failed load for good, so such a screen can only come back with a reload of the window. */
export const loadFailed = (error: unknown): boolean => typeof error === 'object' && error !== null && FAILED_LOAD in error

/** `lazy`, with a failed load marked so the net under the screen knows trying again cannot help. */
// biome-ignore lint/suspicious/noExplicitAny: React's own `lazy` takes any props, so any screen fits.
export function lazyScreen<Screen extends ComponentType<any>>(load: () => Promise<{ default: Screen }>) {
  return lazy(() =>
    load().catch((error: unknown) => {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { [FAILED_LOAD]: true })
    }),
  )
}
