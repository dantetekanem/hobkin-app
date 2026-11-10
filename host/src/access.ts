import { randomBytes, timingSafeEqual } from 'node:crypto'

/** Where the development UI is served (`vite.config.ts`). */
export const DEV_UI_ORIGIN = 'http://127.0.0.1:5187'
/** The origin of the app's own pages inside the Tauri window on macOS. */
export const APP_ORIGIN = 'tauri://localhost'
export const DEV_PORT = 5188

/** Made once at launch. Whoever connects must present it. */
export const createToken = () => randomBytes(32).toString('base64url')

function sameToken(presented: string, token: string): boolean {
  const left = Buffer.from(presented)
  const right = Buffer.from(token)
  return left.length === right.length && timingSafeEqual(left, right)
}

export interface Refusal {
  status: 401 | 403
  reason: string
}

/**
 * Whether a connection may open. A browser always names the page it comes from, so any other page on this
 * machine is turned away by its origin, and anything that is not the app is turned away by the token.
 */
export function refusalFor({ origin, token }: { origin: string | undefined; token: string | null }, allowed: { origins: readonly string[]; token: string }): Refusal | null {
  if (!origin || !allowed.origins.includes(origin)) return { status: 403, reason: 'Forbidden' }
  if (!token || !sameToken(token, allowed.token)) return { status: 401, reason: 'Unauthorized' }
  return null
}
