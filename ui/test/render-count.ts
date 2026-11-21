import { act, createElement, Profiler, type ReactNode } from 'react'

/**
 * Mounts a tree with React's own client renderer in node, without a browser, so a test can count how often it draws.
 * There is no page here, only the root's container, so the tree's components must draw nothing (return null): they
 * call the hooks under test and count their own draws. `commits` counts the root's commits, through a Profiler.
 */
export async function mountCounting(tree: () => ReactNode) {
  const global = globalThis as unknown as { window?: Record<string, unknown>; IS_REACT_ACT_ENVIRONMENT?: boolean }
  global.IS_REACT_ACT_ENVIRONMENT = true
  // React reads the window's current event and its iframe class while it commits. Nothing else of a page is needed.
  global.window ??= {}
  global.window.HTMLIFrameElement ??= class {}
  const { createRoot } = await import('react-dom/client')
  const ignore = () => {}
  const document = { nodeType: 9, addEventListener: ignore, removeEventListener: ignore }
  const container = { nodeType: 1, nodeName: 'DIV', tagName: 'DIV', namespaceURI: 'http://www.w3.org/1999/xhtml', ownerDocument: document, addEventListener: ignore, removeEventListener: ignore, textContent: '' }
  const root = createRoot(container as never)
  let commits = 0
  const draw = () => root.render(createElement(Profiler, { id: 'counted', onRender: () => void (commits += 1) }, tree()))
  await act(async () => draw())
  return {
    get commits() {
      return commits
    },
    /** Runs a change, such as a host message into the store, and lets React draw what it causes. */
    async change(run: () => void) {
      await act(async () => run())
    },
    async unmount() {
      await act(async () => root.unmount())
    },
  }
}
