/**
 * The keys of an agent's task list. Control+Option+T opens it and closes it again from anywhere on the agent's screen,
 * its input included, as the same key does in Pi's own task list. Escape closes it while the keyboard is in it, and
 * otherwise stays the frame's. Pure, so the rule is tested without a window.
 */

export interface TaskKeyPress {
  key: string
  /** Where the key sits. Option changes the character T types on a Mac, but not this. */
  code?: string
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  shift?: boolean
}

export function taskListKey(press: TaskKeyPress, where: { open: boolean; inList: boolean }): 'toggle' | 'close' | null {
  if (press.ctrl && press.alt && !press.meta && !press.shift && press.code === 'KeyT') return 'toggle'
  const bare = !press.ctrl && !press.alt && !press.meta && !press.shift
  if (bare && press.key === 'Escape' && where.open && where.inList) return 'close'
  return null
}
