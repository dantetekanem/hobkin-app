/**
 * `next`, with every part of it that says the same as `held` kept as the held object: a plain object by its own
 * fields, a list by its items, anything else by its value. When all of it says the same, `held` itself. The host's
 * messages are parsed anew, so nothing in them is an object the window already holds; kept this way, a reader that
 * compares what it draws by object draws again only for a part that changed.
 */
export function keepSame<Value>(held: unknown, next: Value): Value {
  if (Object.is(held, next)) return held as Value
  if (Array.isArray(held) && Array.isArray(next)) return keepItems(held, next) as Value
  if (isPlain(held) && isPlain(next)) return keepFields(held, next) as Value
  return next
}

function keepItems(held: readonly unknown[], next: readonly unknown[]): readonly unknown[] {
  const kept = next.map((item, index) => keepSame(held[index], item))
  const same = kept.length === held.length && kept.every((item, index) => item === held[index])
  return same ? held : kept
}

function keepFields(held: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(next)
  let same = keys.length === Object.keys(held).length
  const kept: Record<string, unknown> = {}
  for (const key of keys) {
    kept[key] = keepSame(held[key], next[key])
    if (kept[key] !== held[key] || !Object.hasOwn(held, key)) same = false
  }
  return same ? held : kept
}

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
