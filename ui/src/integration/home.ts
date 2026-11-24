import { serviceMark } from '../features/integrations/marks.ts'
import type { HomeContribution, HomeContributed } from '../features/home/types.ts'
import { windowParts } from './registry.ts'

/** A contribution with its tile drawn in the mark given. */
export function contributed({ tile, ...rest }: HomeContribution, mark: NonNullable<HomeContributed['tile']>['mark']): HomeContributed {
  return { ...rest, ...(tile ? { tile: { ...tile, mark } } : {}) }
}

/**
 * What the integrations' window parts add to Home (`WindowPart.home`), in the order of their folders, each read from
 * its own state: the one `held` says, or the part's `unknown` before the host has said anything. A part's tile is
 * drawn in its own mark.
 */
export function homeContributions(now: number, held: (id: string) => unknown): HomeContributed[] {
  return windowParts().flatMap((part) => {
    if (!part.home) return []
    return [contributed(part.home((held(part.manifest.id) ?? part.unknown) as never, now), serviceMark(part.manifest.id))]
  })
}
