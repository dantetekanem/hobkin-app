import type { HostAddress } from './connection.ts'
import { inMacWindow, shellHostAddress } from '../native.ts'

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

export type HostSource = 'handed' | 'handshake' | 'shell' | 'none'

/**
 * Which source answers where the host is. What the shell handed over comes first. Development asks the host's own
 * handshake, even inside the Mac window, because that window then points at a dev server and a host started by hand.
 * A build asks the shell, which started its host, and a built page in a plain tab has nobody to ask.
 */
export function hostSource({ handed, macWindow, dev }: { handed: boolean; macWindow: boolean; dev: boolean }): HostSource {
  if (handed) return 'handed'
  if (dev) return 'handshake'
  return macWindow ? 'shell' : 'none'
}

/**
 * Where the host is. In the app the shell knows, because it started the host: it sets `window.__HOBKIN_HOST__`
 * to the address, or to a function that returns it, before the UI loads, or in a packaged window it answers the
 * `host_address` command. In a plain browser during development there is no shell, so the UI asks the host itself.
 * The connection asks again before every attempt, so a host restarted on a new port is found.
 */
export async function discoverHost(): Promise<HostAddress | null> {
  const handed = (globalThis as { __HOBKIN_HOST__?: Handed }).__HOBKIN_HOST__
  const source = hostSource({ handed: Boolean(handed), macWindow: inMacWindow(), dev: import.meta.env.DEV })
  if (source === 'handed') return typeof handed === 'function' ? handed() : handed!
  if (source === 'shell') return shellHostAddress()
  const handshake = source === 'handshake' ? handshakeFor(location.search, import.meta.env.DEV) : null
  if (!handshake) return null

  try {
    const answer = await fetch(handshake, { signal: AbortSignal.timeout(1500) })
    return answer.ok ? ((await answer.json()) as HostAddress) : null
  } catch {
    return null
  }
}
