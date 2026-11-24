import { loadWindowParts } from './load-parts.ts'

/**
 * Finds the integrations' window parts in `integrations/*\/window.tsx` and hands them to the registry before the app
 * draws (_specs/064-integration-drops). The only file that knows where the folders are: tests hand their own parts to
 * `setWindowParts` and never import this.
 */
export const parts = await loadWindowParts(import.meta.glob<{ default?: unknown }>('../../../integrations/*/window.tsx'))
