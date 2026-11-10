import type { HostAddress } from './connection.ts'

/** Where a host started with `--dev` hands the development UI its token (`host/src/server.ts`). */
const DEV_HANDSHAKE = 'http://127.0.0.1:5188/dev/handshake'

type Handed = HostAddress | (() => HostAddress | null | Promise<HostAddress | null>)

/**
 * Where the host is. In the app the shell knows, because it started the host: it sets `window.__HOBKIN_HOST__`
 * to the address, or to a function that returns it, before the UI loads. In a plain browser during development
 * there is no shell, so the UI asks the host itself.
 */
export async function discoverHost(): Promise<HostAddress | null> {
  const handed = (globalThis as { __HOBKIN_HOST__?: Handed }).__HOBKIN_HOST__
  if (handed) return typeof handed === 'function' ? handed() : handed
  if (!import.meta.env.DEV) return null

  try {
    const answer = await fetch(DEV_HANDSHAKE, { signal: AbortSignal.timeout(1500) })
    return answer.ok ? ((await answer.json()) as HostAddress) : null
  } catch {
    return null
  }
}
