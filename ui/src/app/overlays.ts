import type { ScreenId } from './screens.ts'

/**
 * Settings and Integrations are open only for now. Settings sits over another screen and gives it back
 * when it is left. Integrations always sits under Settings, as the menu shows it: Settings › Integrations.
 * Leaving it steps back up to Settings, wherever it was opened from.
 * These functions hold that rule and nothing else, so the way back can be tested without a page.
 */
export interface Over {
  screen: ScreenId
  /** While Settings or Integrations is open: the screen under both, which closing returns to. */
  settingsReturn: ScreenId | null
}

const FALLBACK: ScreenId = 'work'

/** How deep the open-for-now screens go: none on a menu screen, one in Settings, two in Integrations. */
export function depth(over: Over): number {
  return over.screen === 'settings' ? 1 : over.screen === 'integrations' ? 2 : 0
}

/** The screen under Settings and Integrations. The app comes back on it after a restart. */
export function ground(over: Over): ScreenId {
  return depth(over) > 0 ? (over.settingsReturn ?? FALLBACK) : over.screen
}

/** Closes Settings and Integrations together. */
export function closeOver(over: Over): Over {
  return { screen: ground(over), settingsReturn: null }
}

/** Command+comma, or the Settings button: opens Settings, closes it, or steps back up to it from Integrations. */
export function toggleSettingsOver(over: Over): Over {
  if (over.screen === 'settings') return closeOver(over)
  if (over.screen === 'integrations') return { screen: 'settings', settingsReturn: over.settingsReturn }
  return { screen: 'settings', settingsReturn: over.screen }
}

/** Command+I, or the Integrations button in Settings: opens Integrations under Settings, or steps back up to Settings. */
export function toggleIntegrationsOver(over: Over): Over {
  if (over.screen === 'integrations') return { screen: 'settings', settingsReturn: over.settingsReturn }
  return { screen: 'integrations', settingsReturn: over.screen === 'settings' ? over.settingsReturn : over.screen }
}
