import { loadWindowParts } from './load-parts.ts'

/**
 * Finds the integrations' window parts in `integrations/*\/window.tsx` and hands them to the registry before the app
 * draws (_specs/065-integration-drops). The only file that knows where the folders are: tests hand their own parts to
 * `setWindowParts` and never import this.
 */
export const parts = await loadWindowParts(import.meta.glob<{ default?: unknown }>('../../../integrations/*/window.tsx'))

// A save to a part, or to any core module a part imports, stops here: the parts are found again and React Refresh
// redraws in place. Without it the update climbs to main.tsx, which accepts nothing, and the whole window reloads.
import.meta.hot?.accept()
