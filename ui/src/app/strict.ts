import { createElement, StrictMode, type ReactNode } from 'react'

declare global {
  interface ImportMetaEnv {
    /** `1` wraps the window in StrictMode. */
    readonly VITE_STRICT?: string
  }
}

/**
 * The window's tree, inside React's StrictMode only when `VITE_STRICT=1` is set. In the development build StrictMode
 * runs every component body twice on every draw, and the daily app runs that build all day (052, S19).
 */
export function strictWhenAsked(tree: ReactNode, env: Pick<ImportMetaEnv, 'VITE_STRICT'> = import.meta.env): ReactNode {
  return env.VITE_STRICT === '1' ? createElement(StrictMode, null, tree) : tree
}
