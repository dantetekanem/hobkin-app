import { windowParts } from './registry.ts'
import { partScreens, type PartScreen } from './screens.ts'

/** The screen of the first integration that has pull requests, where a pull request's row offers to start its review. None without one. */
export function pullScreen(): PartScreen | undefined {
  const withPulls = new Set(windowParts().flatMap((part) => (part.pulls ? [part.manifest.id] : [])))
  return partScreens().find(({ integration }) => withPulls.has(integration))
}
