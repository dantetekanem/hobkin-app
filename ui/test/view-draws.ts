import { readFileSync } from 'node:fs'
import { createRequire, registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { act, createElement, type ReactNode } from 'react'

const { transformSync } = (await import(createRequire(import.meta.resolve('vite')).resolve('rolldown/experimental'))) as {
  transformSync: (file: string, source: string, options: object) => { code: string }
}

/**
 * Modules a test stands in for, each by a path under ui/src (`features/home/Sections.tsx`) or a package name
 * (`motion/react`), with what it exports in their place: parts that count their draws, or that draw only their children.
 */
export type StandIns = Record<string, Record<string, unknown>>

const holder = globalThis as { __standIns?: StandIns }

/** What a stand-in module says: each export is the test's own value. */
const standInSource = (key: string, exports: Record<string, unknown>) =>
  Object.keys(exports).map((name) => `export const ${name} = globalThis.__standIns[${JSON.stringify(key)}][${JSON.stringify(name)}]`).join('\n')

/**
 * Lets a test import the app's views: `@/` points at ui/src, as Vite resolves it, TSX is read once Vite's own
 * transformer has turned it into JavaScript, style sheets are nothing, and each module in `standIns` is the test's
 * stand-in. Call it before importing the app.
 */
export function readViews(standIns: StandIns = {}): void {
  holder.__standIns = standIns
  const standInFor = (specifier: string, url: string) => Object.keys(standIns).find((key) => specifier === key || url.endsWith(`/ui/src/${key}`))
  registerHooks({
    resolve: (specifier, context, next) => {
      const resolved = next(specifier.startsWith('@/') ? new URL(`../src/${specifier.slice(2)}`, import.meta.url).href : specifier, context)
      const key = standInFor(specifier, resolved.url)
      return key ? { url: `data:text/javascript,${encodeURIComponent(standInSource(key, standIns[key]!))}`, shortCircuit: true } : resolved
    },
    load: (url, context, next) => {
      if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true }
      if (!url.endsWith('.tsx')) return next(url, context)
      const file = fileURLToPath(url)
      return { format: 'module', source: transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } }).code, shortCircuit: true }
    },
  })
}

/** A stand-in that draws nothing and counts its draws in `draws` under `name`. */
export const counted = (draws: Record<string, number>, name: string) =>
  function StandIn(): null {
    draws[name] = (draws[name] ?? 0) + 1
    return null
  }

/** A stand-in that draws only its children, as a box of motion or an entrance does. */
export const passing = ({ children }: { children?: ReactNode }): ReactNode => children ?? null

/** Motion's elements, each drawing only its children. */
export const stillMotion = new Proxy({}, { get: () => passing })

/** Just enough of a page for React to put elements in: nodes that hold children, attributes and text. */
class Node {
  childNodes: Node[] = []
  attributes: Record<string, string> = {}
  style = { setProperty() {}, removeProperty() {} }
  parentNode: Node | null = null
  nodeValue: string | null = null
  nodeType: number
  nodeName: string
  ownerDocument: object
  namespaceURI = 'http://www.w3.org/1999/xhtml'

  constructor(nodeType: number, nodeName: string, ownerDocument: object) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.ownerDocument = ownerDocument
  }

  get tagName() {
    return this.nodeName
  }
  get firstChild() {
    return this.childNodes[0] ?? null
  }
  get textContent(): string {
    return this.nodeValue ?? this.childNodes.map((child) => child.textContent).join('')
  }
  set textContent(text: string) {
    this.childNodes = []
    if (text) this.appendChild(Object.assign(new Node(3, '#text', this.ownerDocument), { nodeValue: text }))
  }
  appendChild(child: Node) {
    return this.insertBefore(child, null)
  }
  insertBefore(child: Node, before: Node | null) {
    child.parentNode?.removeChild(child)
    const at = before ? this.childNodes.indexOf(before) : -1
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child)
    child.parentNode = this
    return child
  }
  removeChild(child: Node) {
    this.childNodes = this.childNodes.filter((each) => each !== child)
    child.parentNode = null
    return child
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value
  }
  removeAttribute(name: string) {
    delete this.attributes[name]
  }
  addEventListener() {}
  removeEventListener() {}
}

/**
 * Mounts a view with React's own client renderer on a page of plain nodes, so its own elements draw and a test counts
 * how often the parts it stands in for draw. Parts that need a real page are stood in for (`readViews`).
 */
export async function mountView(tree: () => ReactNode) {
  const global = globalThis as unknown as { window?: Record<string, unknown>; IS_REACT_ACT_ENVIRONMENT?: boolean }
  global.IS_REACT_ACT_ENVIRONMENT = true
  global.window ??= {}
  global.window.HTMLIFrameElement ??= class {}
  const page: Record<string, unknown> = { nodeType: 9, addEventListener() {}, removeEventListener() {} }
  page.createElement = (tag: string) => new Node(1, tag.toUpperCase(), page)
  page.createElementNS = (_space: string, tag: string) => new Node(1, tag, page)
  page.createTextNode = (text: string) => Object.assign(new Node(3, '#text', page), { nodeValue: text })
  const { createRoot } = await import('react-dom/client')
  const container = new Node(1, 'DIV', page)
  const root = createRoot(container as never)
  await act(async () => root.render(createElement(() => tree())))
  return {
    container,
    /** Runs a change, such as a host message into the store, and lets React draw what it causes. */
    async change(run: () => void) {
      await act(async () => run())
    },
    async unmount() {
      await act(async () => root.unmount())
    },
  }
}
