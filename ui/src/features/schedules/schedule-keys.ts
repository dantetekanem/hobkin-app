/**
 * The keys of the schedules list. Control+Option+W opens it and closes it again, from the main chat or from an agent's
 * page, its input included, as Control+Option+T does for the tasks list. Escape closes it while the keyboard is in it
 * or on its line, and otherwise stays where it was: in the main input it stops a turn. Pure, so the rule is tested
 * without a window.
 */

export interface ScheduleKeyPress {
  key: string
  /** Where the key sits. Option changes the character W types on a Mac, but not this. */
  code?: string
  ctrl?: boolean
  alt?: boolean
  meta?: boolean
  shift?: boolean
}

export function scheduleListKey(press: ScheduleKeyPress, where: { open: boolean; inList: boolean }): 'toggle' | 'close' | null {
  if (press.ctrl && press.alt && !press.meta && !press.shift && press.code === 'KeyW') return 'toggle'
  const bare = !press.ctrl && !press.alt && !press.meta && !press.shift
  if (bare && press.key === 'Escape' && where.open && where.inList) return 'close'
  return null
}
