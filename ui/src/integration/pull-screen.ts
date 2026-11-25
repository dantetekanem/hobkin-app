import { windowParts } from './registry.ts'
import { partScreens, type PartScreen } from './screens.ts'

/**
 * The screens of the integrations that have pull requests, where a pull request's row offers to start its review, in
 * the order of their folders. Each code host is offered, so one never stands in for another. Empty without one.
 */
export function pullScreens(): readonly PartScreen[] {
  const withPulls = new Set(windowParts().flatMap((part) => (part.pulls ? [part.manifest.id] : [])))
  return partScreens().filter(({ integration }) => withPulls.has(integration))
}
