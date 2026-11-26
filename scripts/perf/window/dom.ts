/**
 * A page made of plain objects, for mounting the window's real components with React's client renderer in Node, as no
 * DOM library is installed. Elements keep their children, attributes and style, so React builds, updates and removes
 * them as it would in WebKit; nothing is laid out or painted, every size reads 0, and no event is ever dispatched.
 * What a run measures with it is the script's share of the work, a floor under the window's: WebKit's own DOM calls,
 * style, layout and paint are not here. `installPage()` puts the page, its window and the observers on globalThis.
 */

type Listener = (...args: unknown[]) => void

export class FakeNode {
  nodeType: number
  nodeName: string
  parentNode: FakeNode | null = null
  childNodes: FakeNode[] = []
  ownerDocument: FakeDocument | null

  constructor(nodeType: number, nodeName: string, ownerDocument: FakeDocument | null) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.ownerDocument = ownerDocument
  }

  get firstChild(): FakeNode | null {
    return this.childNodes[0] ?? null
  }
  get lastChild(): FakeNode | null {
    return this.childNodes.at(-1) ?? null
  }
  get parentElement(): FakeNode | null {
    return this.parentNode?.nodeType === 1 ? this.parentNode : null
  }
  get nextSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes
    return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null
  }
  get previousSibling(): FakeNode | null {
    const siblings = this.parentNode?.childNodes
    return siblings ? (siblings[siblings.indexOf(this) - 1] ?? null) : null
  }
  get isConnected(): boolean {
    let node: FakeNode | null = this
    while (node.parentNode) node = node.parentNode
    return node.nodeType === 9
  }

  appendChild<Child extends FakeNode>(child: Child): Child {
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.push(child)
    return child
  }
  insertBefore<Child extends FakeNode>(child: Child, before: FakeNode | null): Child {
    if (!before) return this.appendChild(child)
    child.parentNode?.removeChild(child)
    child.parentNode = this
    this.childNodes.splice(this.childNodes.indexOf(before), 0, child)
    return child
  }
  removeChild<Child extends FakeNode>(child: Child): Child {
    const at = this.childNodes.indexOf(child)
    if (at >= 0) this.childNodes.splice(at, 1)
    child.parentNode = null
    return child
  }
  contains(node: FakeNode | null): boolean {
    for (let at = node; at; at = at.parentNode) if (at === this) return true
    return false
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('')
  }
  set textContent(text: string) {
    for (const child of this.childNodes) child.parentNode = null
    this.childNodes = text ? [new FakeText(text, this.ownerDocument)] : []
    for (const child of this.childNodes) child.parentNode = this
  }
  addEventListener(_type: string, _listener: Listener, _options?: unknown): void {}
  removeEventListener(_type: string, _listener: Listener, _options?: unknown): void {}
  dispatchEvent(): boolean {
    return true
  }
  getRootNode(): FakeNode {
    let node: FakeNode = this
    while (node.parentNode) node = node.parentNode
    return node
  }
}

export class FakeText extends FakeNode {
  nodeValue: string
  constructor(text: string, ownerDocument: FakeDocument | null) {
    super(3, '#text', ownerDocument)
    this.nodeValue = text
  }
  get data(): string {
    return this.nodeValue
  }
  set data(text: string) {
    this.nodeValue = text
  }
  override get textContent(): string {
    return this.nodeValue
  }
  override set textContent(text: string) {
    this.nodeValue = text
  }
}

class FakeComment extends FakeNode {
  nodeValue: string
  constructor(text: string, ownerDocument: FakeDocument | null) {
    super(8, '#comment', ownerDocument)
    this.nodeValue = text
  }
  override get textContent(): string {
    return ''
  }
}

/** An element's style: each property set is kept as it is given. */
class FakeStyle {
  [name: string]: unknown
  setProperty(name: string, value: string): void {
    this[name] = value
  }
  removeProperty(name: string): void {
    delete this[name]
  }
  getPropertyValue(name: string): string {
    const value = this[name]
    return typeof value === 'string' ? value : ''
  }
}

const NO_RECT = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }

export class FakeElement extends FakeNode {
  tagName: string
  localName: string
  namespaceURI: string
  attributes = new Map<string, string>()
  style = new FakeStyle()
  scrollTop = 0
  scrollLeft = 0
  scrollHeight = 0
  scrollWidth = 0
  clientHeight = 0
  clientWidth = 0
  offsetHeight = 0
  offsetWidth = 0
  offsetTop = 0
  offsetLeft = 0
  offsetParent = null

  constructor(tag: string, namespaceURI: string, ownerDocument: FakeDocument | null) {
    super(1, tag.toUpperCase(), ownerDocument)
    this.tagName = tag.toUpperCase()
    this.localName = tag
    this.namespaceURI = namespaceURI
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes.set(name, String(value))
  }
  setAttributeNS(_space: string | null, name: string, value: unknown): void {
    this.attributes.set(name, String(value))
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null
  }
  hasAttribute(name: string): boolean {
    return this.attributes.has(name)
  }
  removeAttribute(name: string): void {
    this.attributes.delete(name)
  }
  removeAttributeNS(_space: string | null, name: string): void {
    this.attributes.delete(name)
  }
  get className(): string {
    return this.attributes.get('class') ?? ''
  }
  set className(value: string) {
    this.attributes.set('class', value)
  }
  get id(): string {
    return this.attributes.get('id') ?? ''
  }
  get classList() {
    const names = () => this.className.split(/\s+/).filter(Boolean)
    return {
      contains: (name: string) => names().includes(name),
      add: (...added: string[]) => (this.className = [...new Set([...names(), ...added])].join(' ')),
      remove: (...gone: string[]) => (this.className = names().filter((name) => !gone.includes(name)).join(' ')),
      toggle: (name: string, on?: boolean) => {
        const has = names().includes(name)
        const want = on ?? !has
        if (want && !has) this.className = [...names(), name].join(' ')
        if (!want && has) this.className = names().filter((each) => each !== name).join(' ')
        return want
      },
    }
  }
  get dataset(): Record<string, string> {
    return {}
  }
  get children(): FakeNode[] {
    return this.childNodes.filter((child) => child.nodeType === 1)
  }
  querySelector(): null {
    return null
  }
  querySelectorAll(): FakeElement[] {
    return []
  }
  closest(): null {
    return null
  }
  matches(): boolean {
    return false
  }
  focus(): void {
    if (this.ownerDocument) this.ownerDocument.activeElement = this
  }
  blur(): void {
    if (this.ownerDocument?.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body
  }
  click(): void {}
  scrollTo(): void {}
  scrollBy(): void {}
  scrollIntoView(): void {}
  getBoundingClientRect() {
    return NO_RECT
  }
  getClientRects(): never[] {
    return []
  }
  hasPointerCapture(): boolean {
    return false
  }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
}

/** Motion asks whether an element is one of SVG's. */
export class FakeSVGElement extends FakeElement {}

const SVG = 'http://www.w3.org/2000/svg'
const HTML = 'http://www.w3.org/1999/xhtml'

export class FakeDocument extends FakeNode {
  documentElement: FakeElement
  head: FakeElement
  body: FakeElement
  activeElement: FakeElement
  visibilityState = 'visible'
  hidden = false
  readyState = 'complete'
  defaultView: unknown = null
  /** How many elements and text nodes React asked for since the last `resetMade`. */
  made = 0

  constructor() {
    super(9, '#document', null)
    this.ownerDocument = null
    this.documentElement = new FakeElement('html', HTML, this)
    this.head = new FakeElement('head', HTML, this)
    this.body = new FakeElement('body', HTML, this)
    this.documentElement.appendChild(this.head)
    this.documentElement.appendChild(this.body)
    this.appendChild(this.documentElement)
    this.activeElement = this.body
  }

  createElement(tag: string): FakeElement {
    this.made += 1
    return new FakeElement(tag.toLowerCase(), HTML, this)
  }
  createElementNS(space: string, tag: string): FakeElement {
    this.made += 1
    return space === SVG ? new FakeSVGElement(tag, space, this) : new FakeElement(tag, space, this)
  }
  createTextNode(text: string): FakeText {
    this.made += 1
    return new FakeText(text, this)
  }
  createComment(text: string): FakeComment {
    return new FakeComment(text, this)
  }
  getElementById(): null {
    return null
  }
  querySelector(): null {
    return null
  }
  querySelectorAll(): FakeElement[] {
    return []
  }
  hasFocus(): boolean {
    return true
  }
  getSelection(): null {
    return null
  }
  elementFromPoint(): null {
    return null
  }
}

class NoObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): never[] {
    return []
  }
}

const mediaQuery = (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null })
const computedStyle = () => new Proxy({ getPropertyValue: () => '' }, { get: (target, name) => (name in target ? target[name as 'getPropertyValue'] : '') })

export interface Page {
  document: FakeDocument
  /** Where a tree is mounted: a div in the page's body. */
  container: FakeElement
  /** Animation frames asked for and not run yet. */
  frames: FrameRequestCallback[]
}

/**
 * Puts a page on globalThis: `document`, a `window` that is globalThis itself, as in a browser, observers that observe
 * nothing, media queries that never match, and animation frames that run only when the caller runs them (`frames`).
 * Storage keeps what it is given for the run.
 */
export function installPage(): Page {
  const document = new FakeDocument()
  const container = document.body.appendChild(new FakeElement('div', HTML, document))
  const frames: FrameRequestCallback[] = []
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  }
  const global = globalThis as Record<string, unknown>
  const define = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value })
  define('window', globalThis)
  define('self', globalThis)
  define('document', document)
  define('localStorage', localStorage)
  define('sessionStorage', localStorage)
  define('location', { href: 'http://localhost/', origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', pathname: '/', search: '', hash: '', reload() {} })
  document.defaultView = globalThis
  Object.assign(global, {
    Node: FakeNode,
    Element: FakeElement,
    HTMLElement: FakeElement,
    SVGElement: FakeSVGElement,
    Text: FakeText,
    HTMLIFrameElement: class {},
    HTMLInputElement: class {},
    HTMLTextAreaElement: class {},
    ResizeObserver: NoObserver,
    IntersectionObserver: NoObserver,
    MutationObserver: NoObserver,
    matchMedia: mediaQuery,
    getComputedStyle: computedStyle,
    requestAnimationFrame: (run: FrameRequestCallback) => frames.push(run),
    cancelAnimationFrame: () => {},
    requestIdleCallback: (run: () => void) => setTimeout(run, 1),
    cancelIdleCallback: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    devicePixelRatio: 2,
    innerWidth: 1440,
    innerHeight: 900,
    scrollTo: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    IS_REACT_ACT_ENVIRONMENT: false,
  })
  return { document, container, frames }
}
