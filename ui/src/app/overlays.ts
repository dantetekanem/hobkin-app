import type { ScreenId } from './screens.ts'

/**
 * Settings and the pages under it are open only for now. Settings sits over another screen and gives it back
 * when it is left. Integrations, Skills and Pi extensions always sit under Settings, as the menu shows it:
 * Settings › Integrations. Leaving one steps back up to Settings, wherever it was opened from.
 * These functions hold that rule and nothing else, so the way back can be tested without a page.
 */
export interface Over {
  screen: ScreenId
  /** While Settings or a page under it is open: the screen under them, which closing returns to. */
  settingsReturn: ScreenId | null
}

/** The pages that sit under Settings (023-integrations, 039-skills-and-extensions). */
export const UNDER_SETTINGS = ['integrations', 'skills', 'extensions'] as const satisfies readonly ScreenId[]
export type PageUnderSettings = (typeof UNDER_SETTINGS)[number]

export const isUnderSettings = (screen: ScreenId): screen is PageUnderSettings => (UNDER_SETTINGS as readonly ScreenId[]).includes(screen)

const FALLBACK: ScreenId = 'work'

/** How deep the open-for-now screens go: none on a menu screen, one in Settings, two in a page under it. */
export function depth(over: Over): number {
  return over.screen === 'settings' ? 1 : isUnderSettings(over.screen) ? 2 : 0
}

/** The screen under Settings and the pages under it. The app comes back on it after a restart. */
export function ground(over: Over): ScreenId {
  return depth(over) > 0 ? (over.settingsReturn ?? FALLBACK) : over.screen
}

/** Closes Settings and the page under it together. */
export function closeOver(over: Over): Over {
  return { screen: ground(over), settingsReturn: null }
}

/** Command+comma, or the Settings button: opens Settings, closes it, or steps back up to it from a page under it. */
export function toggleSettingsOver(over: Over): Over {
  if (over.screen === 'settings') return closeOver(over)
  if (isUnderSettings(over.screen)) return { screen: 'settings', settingsReturn: over.settingsReturn }
  return { screen: 'settings', settingsReturn: over.screen }
}

/** A page's button in Settings: opens the page under Settings, or steps back up to Settings from it. */
export function togglePageOver(over: Over, page: PageUnderSettings): Over {
  if (over.screen === page) return { screen: 'settings', settingsReturn: over.settingsReturn }
  return { screen: page, settingsReturn: depth(over) > 0 ? over.settingsReturn : over.screen }
}

/** Command+I, or the Integrations button in Settings: opens Integrations under Settings, or steps back up to Settings. */
export function toggleIntegrationsOver(over: Over): Over {
  return togglePageOver(over, 'integrations')
}
