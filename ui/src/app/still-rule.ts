import type { Movement } from '@/features/settings/store.ts'

/**
 * Whether movement holds still: the Movement setting says Still, or it follows the Mac and the Mac asks for
 * less. Lively always moves. Pure, so the rule is tested without a window. See _specs/020-settings A5.
 */
export function isStill(movement: Movement, macAsksForLess: boolean): boolean {
  return movement === 'still' || (movement === 'system' && macAsksForLess)
}

/**
 * A motion target held still: everything it animates stays except its travel (`transform`), so a fade stays
 * a fade. Both ends of a movement must be held, or the library animates from no transform to one and the
 * piece grows from nothing.
 */
export function holdStill<Target extends object>(target: Target, still: boolean): Target {
  if (!still || !('transform' in target)) return target
  const { transform: _travel, ...rest } = target as Target & { transform?: unknown }
  return rest as Target
}

type Variant = object | ((...args: never[]) => object)

/** Every variant held still, including the ones that are functions of a custom value. */
export function stillVariants<Variants extends Record<string, Variant>>(variants: Variants, still: boolean): Variants {
  if (!still) return variants
  const held: Record<string, Variant> = {}
  for (const [name, variant] of Object.entries(variants)) {
    held[name] = typeof variant === 'function' ? (...args: never[]) => holdStill(variant(...args), true) : holdStill(variant, true)
  }
  return held as Variants
}
