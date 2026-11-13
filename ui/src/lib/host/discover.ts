import type { HostAddress } from './connection.ts'

/** Where a host started with `--dev` hands the development UI its token (`host/src/server.ts`). */
const DEV_HANDSHAKE = 'http://127.0.0.1:5188/dev/handshake'

type Handed = HostAddress | (() => HostAddress | null | Promise<HostAddress | null>)

/**
 * The handshake a page asks in development, or null in a build that is not for development. `?host=<port>` in the
 * address names another host, such as a demo one on a home of its own: the page then asks only that one, so it never
 * reaches the usual host. Anything else there is ignored.
 */
export function handshakeFor(search: string, dev: boolean): string | null {
  if (!dev) return null
  const named = new URLSearchParams(search).get('host') ?? ''
  const port = /^\d{1,5}$/.test(named) ? Number(named) : 0
  return port >= 1024 && port <= 65535 ? `http://127.0.0.1:${port}/dev/handshake` : DEV_HANDSHAKE
}

/**
 * Where the host is. In the app the shell knows, because it started the host: it sets `window.__HOBKIN_HOST__`
 * to the address, or to a function that returns it, before the UI loads. In a plain browser during development
 * there is no shell, so the UI asks the host itself.
 */
export async function discoverHost(): Promise<HostAddress | null> {
  const handed = (globalThis as { __HOBKIN_HOST__?: Handed }).__HOBKIN_HOST__
  if (handed) return typeof handed === 'function' ? handed() : handed
  const handshake = handshakeFor(location.search, import.meta.env.DEV)
  if (!handshake) return null

  try {
    const answer = await fetch(handshake, { signal: AbortSignal.timeout(1500) })
    return answer.ok ? ((await answer.json()) as HostAddress) : null
  } catch {
    return null
  }
}
