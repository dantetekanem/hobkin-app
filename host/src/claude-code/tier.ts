import { TIER_IDS, type TierId } from '#shared/tiers/tiers.ts'
import type { RunFacts } from './route.ts'

/** The parts of hobkin's work store (`src/cli/work/store.mjs`) that say which tier a Work run runs at. */
export interface WorkTiers {
  levels: Record<string, { lookTier: string; doTier: string; [key: string]: unknown }>
  readProject(root: string, slug: string): { name?: string; [key: string]: unknown } | null
  readItems(root: string, slug: string): { id: string; [key: string]: unknown }[]
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isTier = (value: unknown): value is TierId => TIER_IDS.includes(value as TierId)

/**
 * The tier of a Work look or do, for an older runtime whose Work runs do not name their tier (hobkin names it since its
 * commit 1c74964). It is worked out as hobkin's work mode binds it when it starts the run (`bindingFor` and `startLook`
 * in hobkin's `src/cli/work/director.mjs`): the one the project's level gives that kind of run, max for an item made
 * max, and max for the state-machines look. Null for discover, which runs on no tier, and for a run whose project
 * cannot be read.
 */
export function workTier(store: WorkTiers, root: string, run: RunFacts): TierId | null {
  const { slug, lane, item } = isObject(run.work) ? run.work : {}
  if (typeof slug !== 'string' || (lane !== 'look' && lane !== 'do')) return null
  try {
    const project = store.readProject(root, slug)
    if (!project) return null
    if (lane === 'look' && run.title === `${project.name}: state-machines`) return 'max'
    const madeMax =
      lane === 'do' && typeof item === 'string' && store.readItems(root, slug).some((each) => each.id === item && each.max === true)
    const level = madeMax ? 'max' : String(project.level)
    const tier = store.levels[level]?.[`${lane}Tier`]
    return isTier(tier) ? tier : null
  } catch {
    // Work's files cannot be read just now: the run goes where the tile's switches send it.
    return null
  }
}
