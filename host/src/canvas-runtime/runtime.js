/*
 * hobkin's canvas runtime (_specs/040-canvas-board). The host puts this file into every drawing it serves, right
 * after the doctype and the kit's stylesheet. It runs inside the drawing's sandboxed frame, which has no origin of
 * its own, and speaks with the window only in messages of the form { hobkin: 'canvas', type, ... }:
 *
 *   from the window   appearance (theme, still, colors), show (play the first entrance), revision (its url)
 *   to the window     ready (version 1), load (a revision to load fresh), key (a key the app answers)
 *
 * It applies the app's light or dark colors before the drawing paints, passes on the few keys the app answers,
 * changes the open drawing in place when a revision arrives, animates what is new, moved or gone, and draws the
 * kit's arrows.
 *
 * The file is served inside a script element as it is, so it never holds the characters that would end one, nor
 * the opening of an HTML comment. When a global __hbCanvasTest object is present, the runtime puts its pure rules
 * on it and does not start: that is how host/test/canvas-runtime.test.ts evaluates the very file the host serves.
 */
(function () {
  'use strict'

  const VERSION = 1
  /** Marks the nodes the host and this runtime put into a drawing. A revision leaves them alone on both sides. */
  const RUNTIME = 'data-hb-runtime'

  // How things move. New parts start STEP_MS apart, and however many there are, the last starts within SPREAD_MS.
  const STEP_MS = 40
  const SPREAD_MS = 600
  const ENTER_MS = 360
  const GLIDE_MS = 450
  const LEAVE_MS = 180
  const FILL_MS = 220
  /** How long the first entrance waits for the window's show before it plays anyway. */
  const SHOW_WAIT_MS = 700
  /** The longest the drawing is kept from showing before its first entrance, whatever goes wrong. */
  const VEIL_MAX_MS = 2500
  const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'
  const EASE_DRAW = 'cubic-bezier(0.65, 0, 0.35, 1)'
  /** More parts than this enter as whole groups, so a drawing with thousands of shapes still opens at once. */
  const MAX_PARTS = 400

  /** Room left between an arrow's ends and the boxes it joins, and how much it bends when the drawing does not say. */
  const ARROW_GAP = 6
  const ARROW_CURVE = 0.15
  const HEAD_LENGTH = 11
  const HEAD_WIDTH = 5.5

  // ---- Keys ----

  /** With Command alone: the screens by number, Save, the spotlight, the message input, Return, Settings, the mind, History. */
  const COMMAND_KEYS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', 's', 'k', 'l', 'enter', ',', 'j', 'y'])

  /**
   * Whether a key the drawing did not use goes on to the app: Escape, Command+S, Command+1 to 9, Command+K, L,
   * Return, comma, J and Y, and Control+Tab, each with no other modifier. Nothing that ends, stops, sends or reloads,
   * such as Control+X, Command+R or Command+N, is ever passed on.
   */
  function passesKey(press) {
    const key = String(press.key || '')
    const meta = Boolean(press.meta)
    const ctrl = Boolean(press.ctrl)
    const alt = Boolean(press.alt)
    const shift = Boolean(press.shift)
    if (key === 'Escape') return !meta && !ctrl && !alt && !shift
    if (key === 'Tab') return ctrl && !meta && !alt && !shift
    if (!meta || ctrl || alt || shift) return false
    return COMMAND_KEYS.has(key.toLowerCase())
  }

  /** Command+S and Control+Tab would also do something in the page itself, so once passed on they are taken from it. */
  function preventsDefault(press) {
    return passesKey(press) && (press.key === 'Tab' || String(press.key).toLowerCase() === 's')
  }

  // ---- A revision: in place or fresh ----

  /**
   * How a revision reaches the open drawing: changed in place ('morph'), or loaded fresh by the window ('load') when
   * either document runs a script of its own, whose state a change in place would lose. Each script is given as
   * whether it is the runtime's own. A document that could not be fetched or read is null.
   */
  function revisionMode(mine, theirs) {
    if (!mine || !theirs) return 'load'
    const runsOwnScript = (scripts) => scripts.some((script) => !script.runtime)
    return runsOwnScript(mine) || runsOwnScript(theirs) ? 'load' : 'morph'
  }

  /**
   * Which old sibling each new sibling keeps, given both as { tag, id } in order, text and comments by their node
   * names ('#text', '#comment'). A new element with an id keeps the old sibling with that id and tag. One without an
   * id keeps the next unmatched old sibling with the same tag and no id either, so an element with an id is never
   * taken for another. Text and comments match in order. A new sibling left over is inserted; an old one, removed.
   */
  function planSiblings(old, next) {
    const taken = old.map(() => false)
    const byId = new Map()
    const byTag = new Map()
    old.forEach((item, index) => {
      const queues = item.id ? byId : byTag
      const key = item.id || item.tag
      if (!queues.has(key)) queues.set(key, [])
      queues.get(key).push(index)
    })
    const take = (queues, key, fits) => {
      const queue = queues.get(key) || []
      while (queue.length) {
        const index = queue.shift()
        if (!taken[index] && fits(old[index])) {
          taken[index] = true
          return index
        }
      }
      return -1
    }
    const steps = next.map((item) => {
      const from = item.id
        ? take(byId, item.id, (candidate) => candidate.tag === item.tag)
        : take(byTag, item.tag, () => true)
      return from === -1 ? { op: 'insert' } : { op: 'keep', from }
    })
    const remove = taken.flatMap((kept, index) => (kept ? [] : [index]))
    return { steps, remove }
  }

  // ---- Motion ----

  /** When each of `count` new parts starts, in ms: STEP_MS apart, squeezed when there are many so the last starts within SPREAD_MS. */
  function staggerDelays(count) {
    if (!(count > 0)) return []
    const gap = count > 1 ? Math.min(STEP_MS, SPREAD_MS / (count - 1)) : 0
    return Array.from({ length: count }, (_, index) => Math.round(index * gap))
  }

  /** How long a stroke of this length takes to trace: half a second for a short one, up to 700 ms for a long one. */
  function traceDuration(length) {
    return Math.round(Math.min(700, 500 + Math.max(0, length) * 0.2))
  }

  /**
   * The glide back to where an element was: the translate, in pixels, and the scale about `origin` (the point on
   * screen its transform turns around, its new box's center unless given) that draw it in its old box while it
   * already sits in its new one. When an ancestor glides too ({ delta, origin }), the ancestor's glide is taken out,
   * so the two together put the element where it was. Null when it neither moved nor resized, or had no box.
   */
  function flipDelta(before, after, origin, parent) {
    const hasBox = (box) => box && (box.width || box.height)
    if (!hasBox(before) || !hasBox(after)) return null
    const o = origin || { x: after.left + after.width / 2, y: after.top + after.height / 2 }
    let sx = before.width && after.width ? before.width / after.width : 1
    let sy = before.height && after.height ? before.height / after.height : 1
    // The map o + t + s·(p − o) takes the new box to the old one.
    let x = before.left - o.x - sx * (after.left - o.x)
    let y = before.top - o.y - sy * (after.top - o.y)
    if (parent) {
      const { delta, origin: p } = parent
      // The element's own map is the ancestor's undone after the whole move: A⁻¹ ∘ F, written about o again.
      x = p.x - o.x + (o.x + x - p.x - delta.x) / delta.sx
      y = p.y - o.y + (o.y + y - p.y - delta.y) / delta.sy
      sx /= delta.sx
      sy /= delta.sy
    }
    const unmoved = Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01
    return unmoved ? null : { x, y, sx, sy }
  }

  // ---- Arrows ----

  const tenth = (value) => Math.round(value * 10) / 10
  const point = (x, y) => ({ x: tenth(x), y: tenth(y) })

  /**
   * An arrow from one box to another, both given as { left, top, width, height } in the arrows' own pixels. The line
   * runs between the boxes' centers, clipped where it crosses each border and `gap` short of it, and bends by
   * `curve`: a quadratic curve whose control point sits off the middle by curve × length, square to the line, to
   * the left of the way it points when the curve is positive. The head points along the curve as it arrives, and
   * the label sits at the curve's middle. Null when the boxes overlap, so there is no room between them.
   */
  function arrowGeometry(from, to, curve, gap) {
    const bend = Number.isFinite(curve) ? curve : ARROW_CURVE
    const room = Number.isFinite(gap) ? gap : ARROW_GAP
    const ax = from.left + from.width / 2
    const ay = from.top + from.height / 2
    const bx = to.left + to.width / 2
    const by = to.top + to.height / 2
    const dx = bx - ax
    const dy = by - ay
    const distance = Math.hypot(dx, dy)
    if (!distance) return null
    // How far along the line, as a share of it, a box's border is from its center: at its side or at its top or bottom.
    const border = (box) => Math.min(dx ? box.width / 2 / Math.abs(dx) : Infinity, dy ? box.height / 2 / Math.abs(dy) : Infinity)
    const ux = dx / distance
    const uy = dy / distance
    const sx = ax + dx * border(from) + ux * room
    const sy = ay + dy * border(from) + uy * room
    const ex = bx - dx * border(to) - ux * room
    const ey = by - dy * border(to) - uy * room
    const length = (ex - sx) * ux + (ey - sy) * uy
    if (!(length > 1)) return null
    const off = bend * length
    const cx = (sx + ex) / 2 + uy * off
    const cy = (sy + ey) / 2 - ux * off
    const tx = ex - cx
    const ty = ey - cy
    const reach = Math.hypot(tx, ty) || 1
    const hx = tx / reach
    const hy = ty / reach
    const baseX = ex - hx * HEAD_LENGTH
    const baseY = ey - hy * HEAD_LENGTH
    const start = point(sx, sy)
    const end = point(ex, ey)
    const control = point(cx, cy)
    const left = point(baseX - hy * HEAD_WIDTH, baseY + hx * HEAD_WIDTH)
    const right = point(baseX + hy * HEAD_WIDTH, baseY - hx * HEAD_WIDTH)
    return {
      d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
      head: `M ${left.x} ${left.y} L ${end.x} ${end.y} L ${right.x} ${right.y} Z`,
      start,
      end,
      control,
      label: point(0.25 * sx + 0.5 * cx + 0.25 * ex, 0.25 * sy + 0.5 * cy + 0.25 * ey),
    }
  }

  // ---- What the window says ----

  /** The theme and Still the window put in the drawing's address, so both apply before the first paint. */
  function appearanceFromQuery(search) {
    const values = new Map()
    for (const pair of String(search || '').replace(/^\?/, '').split('&')) {
      const at = pair.indexOf('=')
      const name = at === -1 ? pair : pair.slice(0, at)
      if (name && !values.has(name)) values.set(name, at === -1 ? '' : pair.slice(at + 1))
    }
    const theme = values.get('theme')
    const still = values.get('still')
    return {
      theme: theme === 'light' || theme === 'dark' ? theme : null,
      still: still === '1' || still === 'true',
    }
  }

  const COLOR_NAMES = ['paper', 'ink', 'muted', 'line', 'accent']
  /**
   * What a color is written with: hex values, names, numbers and color functions, which may nest, as a custom
   * palette's color-mix does. Nothing that could end the declaration, open a comment or a string, or say !important.
   */
  const COLOR_CHARACTERS = /^[#\w\s.,%/()+-]+$/
  // A reference means nothing inside the drawing, which has none of the window's variables, and fetches nothing.
  const REFERENCE = /\b(?:var|url|env|attr|image|expression)\s*\(/i

  function isColor(value) {
    if (typeof value !== 'string' || value.length > 240) return false
    if (!COLOR_CHARACTERS.test(value) || REFERENCE.test(value)) return false
    // Every parenthesis that opens closes, and none closes before it opens.
    let depth = 0
    for (const character of value) {
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      if (depth < 0) return false
    }
    return depth === 0 && value.trim() !== ''
  }

  /** The rule that puts the window's colors on the kit's variables, or '' when it sent none worth taking. */
  function colorRule(colors) {
    if (!colors || typeof colors !== 'object') return ''
    const declarations = COLOR_NAMES.filter((name) => isColor(colors[name])).map((name) => `--hb-${name}: ${colors[name].trim()};`)
    return declarations.length ? `:root[data-hb-theme] { ${declarations.join(' ')} }` : ''
  }

  /** A message from the window as the contract has it, or null for anything else. */
  function readMessage(data) {
    if (!data || typeof data !== 'object' || data.hobkin !== 'canvas') return null
    if (data.type === 'show') return { type: 'show' }
    if (data.type === 'revision') {
      const fetchable = typeof data.url === 'string' && /^https?:\/\//i.test(data.url)
      return fetchable ? { type: 'revision', url: data.url } : null
    }
    if (data.type === 'appearance') {
      return {
        type: 'appearance',
        theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : null,
        still: typeof data.still === 'boolean' ? data.still : null,
        colors: data.colors && typeof data.colors === 'object' ? data.colors : null,
      }
    }
    return null
  }

  // ---- The page ----

  const SVG = 'http://www.w3.org/2000/svg'
  const GEOMETRY = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
  const SVG_WHOLE = new Set(['text', 'image', 'use', 'foreignObject'])
  const SVG_THROUGH = new Set(['g', 'a', 'svg', 'switch'])
  const NOT_DRAWN = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE', 'NOSCRIPT', 'TITLE', 'BR', 'WBR', 'HB-ARROW'])
  /** Elements that draw a box of their own even when they sit in a line of text, so they can move. */
  const REPLACED = new Set(['IMG', 'VIDEO', 'CANVAS', 'IFRAME', 'EMBED', 'OBJECT', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'PROGRESS', 'METER'])
  /** The kit's names for arrow colors. Any other CSS color is used as it is. */
  const ARROW_COLORS = new Set(['yellow', 'green', 'blue', 'pink', 'purple', 'gray', 'ink', 'muted', 'line', 'accent'])

  function start() {
    const root = document.documentElement
    const script = document.currentScript
    const head = document.head || root
    const media = (query) => (typeof matchMedia === 'function' ? matchMedia(query) : null)
    const reduced = media('(prefers-reduced-motion: reduce)')
    const darkSystem = media('(prefers-color-scheme: dark)')
    const first = appearanceFromQuery(location.search)
    /** Whether the drawing sits in the app's frame. Opened on its own, nothing will send it a show. */
    const framed = window.parent !== window
    // The kit's tilts and every move here use translate, rotate and scale, which add to a drawing's own transform.
    const individual =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('translate', '1px 1px') &&
      CSS.supports('scale', '1')
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null
    const observed = new WeakSet()
    const state = {
      still: first.still,
      ready: false,
      showAsked: false,
      entered: false,
      revision: 0,
      overlay: null,
      defs: null,
      showTimer: 0,
      traces: 0,
    }
    /** What is fading out: a revision passes over it, as if it were gone already. */
    const leaving = new WeakSet()
    /** When each new part's entrance ends, so an arrow to it waits for it. */
    const arrivals = new WeakMap()
    const running = new Set()
    const glides = new Map()
    const arrows = new Map()
    let veil = null
    let frame = 0
    let following = false

    const motion = () => !state.still && !(reduced && reduced.matches)
    const timing = (duration, delay) => ({ duration, delay, easing: EASE_OUT, fill: 'backwards' })
    const own = (value, none) => (!value || value === 'none' ? none : value)
    const inRuntime = (element) => Boolean(element.closest(`[${RUNTIME}]`))
    const isSvgChild = (element) => element instanceof SVGElement && element.ownerSVGElement != null

    function post(message) {
      try {
        window.parent.postMessage(Object.assign({ hobkin: 'canvas' }, message), '*')
      } catch {
        // Nothing listens when the drawing is opened on its own.
      }
    }

    function insertAfterScript(node) {
      if (script && script.parentNode) script.parentNode.insertBefore(node, script.nextSibling)
      else head.appendChild(node)
    }

    function unveil() {
      if (!veil) return
      veil.remove()
      veil = null
    }

    function isLeaving(node) {
      for (let at = node; at; at = at.parentElement) if (leaving.has(at)) return true
      return false
    }

    /** Follows an animation of the runtime until it ends, however it ends, and then runs `done` once. */
    function track(animation, done) {
      running.add(animation)
      let over = false
      const end = () => {
        if (over) return
        over = true
        running.delete(animation)
        if (done) done()
      }
      animation.addEventListener('finish', end)
      animation.addEventListener('cancel', end)
      return animation
    }

    /** Ends every animation of the runtime where it was going, for Still. */
    function settle() {
      for (const animation of [...running]) {
        try {
          animation.finish()
        } catch {
          animation.cancel()
        }
      }
    }

    function appearance(message) {
      if (message.theme) root.setAttribute('data-hb-theme', message.theme)
      if (message.still !== null) {
        state.still = message.still
        root.toggleAttribute('data-hb-still', message.still)
        if (message.still) {
          settle()
          if (state.ready && !state.entered) begin(false)
        }
      }
      if (message.colors) colors.textContent = colorRule(drawable(message.colors))
    }

    /** The window's colors this browser can draw. One it cannot would leave the kit with no color at all. */
    function drawable(given) {
      if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return given
      const drawn = COLOR_NAMES.filter((name) => typeof given[name] === 'string' && CSS.supports('color', given[name]))
      return Object.fromEntries(drawn.map((name) => [name, given[name]]))
    }

    function onMessage(event) {
      if (event.source !== window.parent) return
      const message = readMessage(event.data)
      if (!message) return
      if (message.type === 'appearance') {
        appearance(message)
      } else if (message.type === 'show') {
        state.showAsked = true
        if (state.ready) begin(true)
      } else {
        revise(message.url)
      }
    }

    function onKey(event) {
      // A drawing opened on its own, in a browser tab, has no window to tell, and its keys stay the browser's.
      if (!framed || event.defaultPrevented || event.isComposing) return
      const press = {
        key: event.key,
        code: event.code,
        meta: event.metaKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        shift: event.shiftKey,
      }
      if (!passesKey(press)) return
      post(Object.assign({ type: 'key' }, press))
      if (preventsDefault(press)) event.preventDefault()
    }

    function ready() {
      if (state.ready) return
      state.ready = true
      try {
        makeOverlay()
      } catch {
        state.overlay = null
      }
      post({ type: 'ready', version: VERSION })
      watch()
      schedule()
      if (!motion()) begin(false)
      else if (state.showAsked || !framed) begin(true)
      else state.showTimer = setTimeout(() => begin(true), SHOW_WAIT_MS)
    }

    /** The first showing: the whole drawing draws itself in, once, when the window says the canvas has arrived. */
    function begin(animate) {
      if (state.entered) return
      state.entered = true
      clearTimeout(state.showTimer)
      try {
        if (animate && motion() && document.body) enter(partsOf([document.body], false))
      } catch {
        // The drawing shows as it is.
      } finally {
        unveil()
      }
      route(true)
    }

    function watch() {
      addEventListener('resize', () => schedule())
      addEventListener('load', () => schedule())
      if (document.fonts) {
        document.fonts.ready.then(() => schedule(), () => {})
        if (typeof document.fonts.addEventListener === 'function') document.fonts.addEventListener('loadingdone', () => schedule())
      }
      observe(root)
      if (document.body) observe(document.body)
    }

    function observe(element) {
      if (!resizes || observed.has(element)) return
      observed.add(element)
      resizes.observe(element)
    }

    // ---- Entering ----

    /** Whether an element draws itself in ('part'), only what is inside it does ('through'), or nothing in it moves ('none'). */
    function partKind(element) {
      if (element.hasAttribute(RUNTIME) || leaving.has(element)) return 'none'
      if (isSvgChild(element)) {
        const name = element.localName
        if (GEOMETRY.has(name) || SVG_WHOLE.has(name)) return 'part'
        return SVG_THROUGH.has(name) ? 'through' : 'none'
      }
      if (NOT_DRAWN.has(element.nodeName)) return 'none'
      const isSvg = element instanceof SVGSVGElement
      if (!(element instanceof HTMLElement) && !isSvg) return 'through'
      const display = getComputedStyle(element).display
      if (display === 'none') return 'none'
      if (isSvg || REPLACED.has(element.nodeName) || display === 'table-row') return 'part'
      if (display === 'contents' || display === 'inline' || display.startsWith('table-')) return 'through'
      return 'part'
    }

    /**
     * The parts that draw themselves in, in document order: those inside `roots`, and the roots themselves when
     * `withRoots`. A part that holds other parts only fades, so a note in a frame in a row still rises its own 6 px.
     */
    function partsOf(roots, withRoots) {
      const parts = []
      const holders = new Set()
      const visit = (element, self, holder) => {
        const kind = self ? partKind(element) : 'through'
        if (kind === 'none') return
        let inner = holder
        if (kind === 'part') {
          parts.push(element)
          if (holder) holders.add(holder)
          inner = element
        }
        for (const child of element.children) visit(child, true, inner)
      }
      for (const element of roots) visit(element, withRoots, null)
      if (parts.length <= MAX_PARTS) return { parts, holders }
      // Too many to stagger one by one: only the outermost parts enter, each with what it holds. Every holder is a part.
      const outermost = parts.filter((element) => {
        for (let at = element.parentElement; at; at = at.parentElement) if (holders.has(at)) return false
        return true
      })
      return { parts: outermost, holders: new Set() }
    }

    /** A stroke worth tracing: drawn, solid, with a length. A dashed one would trace solid and then break, so it fades instead. */
    function traceLength(element, style) {
      if (typeof element.getTotalLength !== 'function' || style.stroke === 'none') return 0
      if (!(Number.parseFloat(style.strokeWidth) > 0) || !(Number(style.strokeOpacity) > 0)) return 0
      if (style.strokeDasharray && style.strokeDasharray !== 'none') return 0
      try {
        const declared = Number.parseFloat(element.getAttribute('pathLength'))
        const length = declared > 0 ? declared : element.getTotalLength()
        return Number.isFinite(length) && length > 0 ? Math.ceil(length) : 0
      } catch {
        return 0
      }
    }

    /**
     * How one new part draws itself in: a stroke traces and then its fill fades in; anything else fades and rises.
     * A part that holds other parts only fades: they rise themselves.
     */
    function entrance(element, delay, holds) {
      const style = getComputedStyle(element)
      if (isSvgChild(element)) {
        const length = traceLength(element, style)
        if (!length) {
          const fadeIn = [{ opacity: 0 }, { opacity: style.opacity }]
          return { element, end: delay + ENTER_MS, moves: [[fadeIn, timing(ENTER_MS, delay)]] }
        }
        const duration = traceDuration(length)
        const dashes = `${length}px ${length}px`
        const moves = [
          [
            [
              { strokeDasharray: dashes, strokeDashoffset: `${length}px` },
              { strokeDasharray: dashes, strokeDashoffset: '0px' },
            ],
            { duration, delay, easing: EASE_DRAW, fill: 'backwards' },
          ],
        ]
        let end = delay + duration
        if (style.fill !== 'none' && Number(style.fillOpacity) > 0) {
          const fillDelay = delay + Math.round(duration * 0.8)
          moves.push([[{ fillOpacity: 0 }, { fillOpacity: style.fillOpacity }], timing(FILL_MS, fillDelay)])
          end = Math.max(end, fillDelay + FILL_MS)
        }
        return { element, end, moves }
      }
      const frames = individual && !holds
        ? [
            { opacity: 0, translate: '0px 6px', scale: '0.98' },
            { opacity: style.opacity, translate: own(style.translate, '0px 0px'), scale: own(style.scale, '1') },
          ]
        : [{ opacity: 0 }, { opacity: style.opacity }]
      return { element, end: delay + ENTER_MS, moves: [[frames, timing(ENTER_MS, delay)]] }
    }

    /** New parts draw themselves in, in document order, each a little after the one before. */
    function enter({ parts, holders }) {
      if (!parts.length) return
      const delays = staggerDelays(parts.length)
      // Every style is read before any animation starts, so the page is laid out once.
      const plans = parts.map((element, index) => entrance(element, delays[index], holders.has(element)))
      const now = performance.now()
      for (const plan of plans) {
        for (const [frames, options] of plan.moves) track(plan.element.animate(frames, options))
        arrivals.set(plan.element, now + plan.end)
      }
      follow()
    }

    /** When the entrance of an element, or of what holds it, ends. */
    function arrivalOf(element) {
      let latest = 0
      for (let at = element; at && at !== document.body; at = at.parentElement) latest = Math.max(latest, arrivals.get(at) || 0)
      return latest
    }

    function fade(node, thenRemove) {
      if (motion()) {
        const opacity = getComputedStyle(node).opacity
        track(node.animate([{ opacity }, { opacity: 0 }], { duration: LEAVE_MS, easing: 'ease-in', fill: 'forwards' }))
        if (thenRemove) setTimeout(() => node.remove(), LEAVE_MS + 20)
      } else if (thenRemove) {
        node.remove()
      }
    }

    // ---- Gliding ----

    /** Where every element with an id is on screen now, as drawn, so a glide in progress goes on from where it is. */
    function measure() {
      const boxes = new Map()
      if (!document.body) return boxes
      for (const element of document.body.querySelectorAll('[id]')) {
        if (inRuntime(element) || isLeaving(element)) continue
        boxes.set(element, element.getBoundingClientRect())
      }
      return boxes
    }

    function stopGlides() {
      for (const entry of glides.values()) {
        entry.animation.cancel()
        entry.undo()
      }
      glides.clear()
    }

    /**
     * Each element that moved or resized between `before` and `after` glides from its old box to its new one. Every
     * glide is worked out before any starts: a glide that had started would already be in the screen matrices read
     * for the shapes inside it.
     */
    function glide(before, after) {
      const plans = []
      const gliding = new Map()
      for (const [element, last] of after) {
        const firstBox = before.get(element)
        if (!firstBox) continue
        const origin = { x: last.left + last.width / 2, y: last.top + last.height / 2 }
        // The nearest ancestor gliding in this pass, if any.
        let parent = null
        for (let at = element.parentElement; at && !parent; at = at.parentElement) {
          parent = gliding.get(at) || null
        }
        const delta = flipDelta(firstBox, last, origin, parent)
        const plan = delta && glidePlan(element, delta)
        if (!plan) continue
        gliding.set(element, { delta: plan.applied, origin })
        plans.push(plan)
      }
      for (const plan of plans) startGlide(plan)
      if (plans.length) follow()
    }

    /**
     * One glide in the element's own units, and what it applies in pixels on screen. An SVG shape moves in the units
     * of its drawing, so the move on screen goes through its screen matrix, which holds the viewBox's scale. It scales
     * about its own box; one with a transform of its own only moves, since its own box would change how that turns it.
     */
    function glidePlan(element, delta) {
      if (!individual) return null
      if (!isSvgChild(element)) return { element, x: delta.x, y: delta.y, sx: delta.sx, sy: delta.sy, ownBox: false, applied: delta }
      const turned = getComputedStyle(element).transform !== 'none'
      const space = turned ? element.parentNode : element
      const matrix = space && typeof space.getScreenCTM === 'function' ? space.getScreenCTM() : null
      const determinant = matrix ? matrix.a * matrix.d - matrix.b * matrix.c : 0
      if (!determinant) return null
      const x = (matrix.d * delta.x - matrix.c * delta.y) / determinant
      const y = (matrix.a * delta.y - matrix.b * delta.x) / determinant
      const sx = turned ? 1 : delta.sx
      const sy = turned ? 1 : delta.sy
      return { element, x, y, sx, sy, ownBox: !turned, applied: { x: delta.x, y: delta.y, sx, sy } }
    }

    function startGlide({ element, x, y, sx, sy, ownBox }) {
      let restore = null
      if (ownBox) {
        const { transformBox, transformOrigin } = element.style
        element.style.transformBox = 'fill-box'
        element.style.transformOrigin = '50% 50%'
        restore = () => {
          element.style.transformBox = transformBox
          element.style.transformOrigin = transformOrigin
        }
      }
      const animation = element.animate(
        [
          { translate: `${x}px ${y}px`, scale: `${sx} ${sy}` },
          { translate: '0px 0px', scale: '1 1' },
        ],
        { duration: GLIDE_MS, easing: EASE_OUT, fill: 'backwards' },
      )
      let undone = false
      const entry = {
        animation,
        undo: () => {
          if (undone) return
          undone = true
          if (restore) restore()
        },
      }
      glides.set(element, entry)
      track(animation, () => {
        if (glides.get(element) === entry) glides.delete(element)
        entry.undo()
      })
    }

    // ---- A revision in place ----

    const PLACED_TYPES = new Set([1, 3, 8])
    const isRuntimeNode = (node) => node.nodeType === 1 && node.hasAttribute(RUNTIME)
    /** Nodes a revision leaves where they are: the runtime's own, and what is fading out. */
    const pinned = (node) => isRuntimeNode(node) || (node.nodeType === 1 && leaving.has(node))
    const describe = (node) => ({ tag: node.nodeName, id: node.nodeType === 1 ? node.getAttribute('id') || null : null })

    /** Gives `here` the attributes of `there`: added, changed and removed. The runtime's own on the root stay. */
    function syncAttributes(here, there, keepOwn) {
      const owned = (name) => keepOwn && name.startsWith('data-hb-')
      for (const attribute of [...here.attributes]) {
        if (owned(attribute.name) || there.hasAttributeNS(attribute.namespaceURI, attribute.localName)) continue
        here.removeAttributeNS(attribute.namespaceURI, attribute.localName)
      }
      for (const attribute of [...there.attributes]) {
        if (owned(attribute.name) || here.getAttributeNS(attribute.namespaceURI, attribute.localName) === attribute.value) continue
        try {
          here.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value)
        } catch {
          // A name the parser took but the DOM cannot set is left as it was.
        }
      }
    }

    /** The head's own children by position: a title, style, link or meta that changed is changed in place. */
    function syncHead(mine, theirs) {
      if (!mine || !theirs) return
      const old = [...mine.children].filter((element) => !element.hasAttribute(RUNTIME))
      const next = [...theirs.children].filter((element) => !element.hasAttribute(RUNTIME))
      next.forEach((element, index) => {
        const here = old[index]
        if (here && here.nodeName === element.nodeName) {
          syncAttributes(here, element, false)
          if (here.textContent !== element.textContent) here.textContent = element.textContent
        } else if (here) {
          here.replaceWith(document.importNode(element, true))
        } else {
          mine.appendChild(document.importNode(element, true))
        }
      })
      for (const extra of old.slice(next.length)) extra.remove()
    }

    /** Puts `nodes` in order under `parent`, leaving the pinned nodes where they are. */
    function place(parent, nodes) {
      let cursor = parent.firstChild
      for (const node of nodes) {
        while (cursor && cursor !== node && (!PLACED_TYPES.has(cursor.nodeType) || pinned(cursor))) cursor = cursor.nextSibling
        if (cursor === node) cursor = cursor.nextSibling
        else parent.insertBefore(node, cursor)
      }
    }

    function syncChildren(mine, theirs, change) {
      const old = [...mine.childNodes].filter((node) => PLACED_TYPES.has(node.nodeType) && !pinned(node))
      const next = [...theirs.childNodes].filter((node) => PLACED_TYPES.has(node.nodeType) && !isRuntimeNode(node))
      const plan = planSiblings(old.map(describe), next.map(describe))
      const placed = next.map((node, index) => {
        const step = plan.steps[index]
        if (step.op === 'insert') {
          const added = document.importNode(node, true)
          if (added.nodeType === 1) change.entering.push(added)
          return added
        }
        const here = old[step.from]
        if (here.nodeType !== 1) {
          if (here.nodeValue !== node.nodeValue) here.nodeValue = node.nodeValue
        } else {
          syncAttributes(here, node, false)
          if (here.localName === 'template' && here.content) {
            if (here.innerHTML !== node.innerHTML) here.innerHTML = node.innerHTML
          } else {
            syncChildren(here, node, change)
          }
        }
        return here
      })
      for (const index of plan.remove) {
        const node = old[index]
        if (node.nodeType === 1 && change.moving) {
          leaving.add(node)
          change.gone.push(node)
        } else {
          node.remove()
        }
      }
      place(mine, placed)
    }

    function morph(next, moving) {
      const change = { moving, entering: [], gone: [] }
      syncAttributes(root, next.documentElement, true)
      syncHead(document.head, next.head)
      if (document.body && next.body) {
        syncAttributes(document.body, next.body, false)
        syncChildren(document.body, next.body, change)
      }
      return change
    }

    /** A removed part fades in place, then goes, and what moves because it went glides. */
    function leave(gone) {
      for (const element of gone) fade(element, false)
      setTimeout(() => {
        const before = measure()
        stopGlides()
        for (const element of gone) element.remove()
        if (motion()) glide(before, measure())
        schedule()
      }, LEAVE_MS)
    }

    /** Changes the open drawing into `next` in place: what stayed stays still, and the rest moves as it changed. */
    function change(next) {
      const moving = motion() && state.entered
      const before = moving ? measure() : null
      if (moving) stopGlides()
      const { entering, gone } = morph(next, moving)
      if (moving) {
        glide(before, measure())
        enter(partsOf(entering, true))
        if (gone.length) leave(gone)
      }
      schedule()
    }

    const scriptsOf = (page) => [...page.querySelectorAll('script')].map((element) => ({ runtime: element.hasAttribute(RUNTIME) }))

    /** A revision the window announced: changed in place when it can be, otherwise handed back to load fresh. */
    async function revise(url) {
      const ticket = ++state.revision
      if (!state.ready) {
        post({ type: 'load', url })
        return
      }
      let next = null
      try {
        const response = await fetch(url, { credentials: 'omit', cache: 'no-store' })
        if (!response.ok) throw Error(`The revision answered ${response.status}.`)
        next = new DOMParser().parseFromString(await response.text(), 'text/html')
      } catch {
        next = null
      }
      // A newer revision came while this one was on its way: that one is the drawing now.
      if (ticket !== state.revision) return
      if (revisionMode(scriptsOf(document), next && scriptsOf(next)) !== 'morph') {
        post({ type: 'load', url })
        return
      }
      try {
        change(next)
      } catch {
        post({ type: 'load', url })
      }
    }

    // ---- Arrows ----

    function svgNode(name, attributes) {
      const node = document.createElementNS(SVG, name)
      for (const key of Object.keys(attributes)) node.setAttribute(key, attributes[key])
      return node
    }

    /** The one layer every arrow is drawn on, over the whole drawing, which also holds the filter `.hb-sketch` uses. */
    function makeOverlay() {
      if (!document.body) return
      const overlay = svgNode('svg', { [RUNTIME]: 'arrows', 'aria-hidden': 'true', focusable: 'false' })
      const fixed = {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '0',
        height: '0',
        margin: '0',
        padding: '0',
        border: '0',
        overflow: 'visible',
        'pointer-events': 'none',
        'z-index': '2147483000',
        display: 'block',
        'max-width': 'none',
        'max-height': 'none',
        transform: 'none',
        opacity: '1',
        visibility: 'visible',
      }
      for (const name of Object.keys(fixed)) overlay.style.setProperty(name, fixed[name], 'important')
      const defs = svgNode('defs', {})
      const filter = svgNode('filter', { id: 'hb-sketch', x: '-5%', y: '-5%', width: '110%', height: '110%' })
      filter.append(
        svgNode('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.035', numOctaves: '2', seed: '7', result: 'grain' }),
        svgNode('feDisplacementMap', { in: 'SourceGraphic', in2: 'grain', scale: '3', xChannelSelector: 'R', yChannelSelector: 'G' }),
      )
      defs.append(filter)
      overlay.append(defs)
      document.body.append(overlay)
      state.overlay = overlay
      state.defs = defs
      // Only now does `.hb-sketch` refer to the filter: without it, the kit draws no wobble.
      root.setAttribute('data-hb-sketch', '')
    }

    /** The layer covers the document's whole scroll area, measured without itself so it never makes the page bigger. */
    function sizeOverlay(overlay) {
      overlay.style.setProperty('width', '0px', 'important')
      overlay.style.setProperty('height', '0px', 'important')
      const box = overlay.getBoundingClientRect()
      const body = document.body
      const width = Math.max(root.scrollWidth, body ? body.scrollWidth : 0) - (box.left + scrollX)
      const height = Math.max(root.scrollHeight, body ? body.scrollHeight : 0) - (box.top + scrollY)
      overlay.style.setProperty('width', `${Math.max(0, Math.floor(width))}px`, 'important')
      overlay.style.setProperty('height', `${Math.max(0, Math.floor(height))}px`, 'important')
    }

    function schedule() {
      if (frame || !state.ready) return
      frame = requestAnimationFrame(() => {
        frame = 0
        route(true)
      })
    }

    /** While anything of the runtime moves, the arrows follow their ends every frame. */
    function follow() {
      if (following || !state.overlay) return
      following = true
      const step = () => {
        route(false)
        if (running.size) {
          requestAnimationFrame(step)
        } else {
          following = false
          route(true)
        }
      }
      requestAnimationFrame(step)
    }

    function endOf(id) {
      const element = id ? document.getElementById(id) : null
      return element && !inRuntime(element) && !isLeaving(element) ? element : null
    }

    function boxIn(element, origin) {
      const box = element.getBoundingClientRect()
      return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height }
    }

    function curveOf(element) {
      const value = Number.parseFloat(element.getAttribute('curve'))
      return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : ARROW_CURVE
    }

    function drawArrow(overlay) {
      const group = svgNode('g', { class: 'hb-arrow' })
      const line = svgNode('path', { class: 'hb-arrow-line' })
      const tip = svgNode('path', { class: 'hb-arrow-head' })
      const label = svgNode('g', { class: 'hb-arrow-label' })
      const backing = svgNode('rect', { class: 'hb-arrow-backing', rx: '6' })
      const text = svgNode('text', { class: 'hb-arrow-text' })
      label.append(backing, text)
      group.append(line, tip, label)
      overlay.append(group)
      return {
        group,
        line,
        tip,
        label,
        backing,
        text,
        fresh: true,
        from: null,
        to: null,
        words: null,
        look: null,
        color: null,
        mask: null,
      }
    }

    function fitMask(record) {
      const box = record.line.getBBox()
      const pad = 16
      const mask = record.mask.element
      mask.setAttribute('x', String(tenth(box.x - pad)))
      mask.setAttribute('y', String(tenth(box.y - pad)))
      mask.setAttribute('width', String(tenth(box.width + pad * 2)))
      mask.setAttribute('height', String(tenth(box.height + pad * 2)))
    }

    /**
     * A new arrow draws its line once both its ends have arrived, then its head and label appear. The line is
     * revealed through a mask that traces it, so a dashed arrow traces with its dashes.
     */
    function traceArrow(record) {
      const length = record.line.getTotalLength()
      if (!(length > 0) || !state.defs) return
      const now = performance.now()
      const delay = Math.max(0, arrivalOf(record.from) - now, arrivalOf(record.to) - now)
      const duration = traceDuration(length)
      const id = `hb-arrow-trace-${++state.traces}`
      const mask = svgNode('mask', { id, maskUnits: 'userSpaceOnUse' })
      const pen = svgNode('path', {
        d: record.line.getAttribute('d'),
        fill: 'none',
        stroke: '#fff',
        'stroke-width': '14',
        'stroke-linecap': 'round',
        'stroke-dasharray': `${length} ${length}`,
        'stroke-dashoffset': String(length),
      })
      mask.append(pen)
      state.defs.append(mask)
      if (record.mask) record.mask.done()
      const done = () => {
        if (record.mask && record.mask.element === mask) {
          record.mask = null
          record.line.removeAttribute('mask')
        }
        mask.remove()
      }
      record.mask = { element: mask, pen, done }
      fitMask(record)
      record.line.setAttribute('mask', `url(#${id})`)
      const tracing = pen.animate(
        [{ strokeDashoffset: `${length}px` }, { strokeDashoffset: '0px' }],
        { duration, delay, easing: EASE_DRAW, fill: 'forwards' },
      )
      track(tracing, done)
      const appearAt = delay + Math.round(duration * 0.85)
      for (const part of [record.tip, record.label]) {
        track(part.animate([{ opacity: 0 }, { opacity: 1 }], timing(FILL_MS, appearAt)))
      }
      follow()
    }

    function placeArrow(record, element, origin, full) {
      const from = endOf(element.getAttribute('from'))
      const to = endOf(element.getAttribute('to'))
      const ends = from && to ? [boxIn(from, origin), boxIn(to, origin)] : null
      // An end that is not drawn has no box to point at.
      const shown = ends && ends.every((box) => box.width || box.height)
      const geometry = shown ? arrowGeometry(ends[0], ends[1], curveOf(element)) : null
      if (!geometry) {
        record.group.style.display = 'none'
        record.from = null
        record.to = null
        return
      }
      record.group.style.display = ''
      record.line.setAttribute('d', geometry.d)
      record.tip.setAttribute('d', geometry.head)
      if (record.mask) {
        record.mask.pen.setAttribute('d', geometry.d)
        fitMask(record)
      }
      const look = (element.getAttribute('data-style') || '').trim()
      if (look !== record.look) {
        record.look = look
        record.group.setAttribute('data-style', look)
      }
      const color = (element.getAttribute('data-color') || '').trim()
      if (color !== record.color) {
        record.color = color
        const named = ARROW_COLORS.has(color)
        record.group.setAttribute('data-color', named ? color : '')
        if (!named && isColor(color)) {
          record.group.style.setProperty('--hb-arrow', color)
        } else {
          record.group.style.removeProperty('--hb-arrow')
        }
      }
      const words = (element.getAttribute('label') || '').trim()
      if (words !== record.words) {
        record.words = words
        record.text.textContent = words
      }
      record.label.style.display = words ? '' : 'none'
      if (words) {
        record.text.setAttribute('x', String(geometry.label.x))
        record.text.setAttribute('y', String(geometry.label.y))
        const box = record.text.getBBox()
        record.backing.setAttribute('x', String(tenth(box.x - 7)))
        record.backing.setAttribute('y', String(tenth(box.y - 3)))
        record.backing.setAttribute('width', String(tenth(box.width + 14)))
        record.backing.setAttribute('height', String(tenth(box.height + 6)))
      }
      if (full) {
        observe(from)
        observe(to)
      }
      if (record.from !== from || record.to !== to) {
        record.from = from
        record.to = to
        record.fresh = true
      }
      if (record.fresh && state.entered) {
        record.fresh = false
        if (motion()) traceArrow(record)
      }
    }

    /** Draws every arrow between its ends as they are now. A full pass also sizes the layer and watches the ends. */
    function route(full) {
      const overlay = state.overlay
      if (!overlay) return
      try {
        if (full) sizeOverlay(overlay)
        const origin = overlay.getBoundingClientRect()
        const seen = new Set()
        for (const element of document.querySelectorAll('hb-arrow')) {
          if (inRuntime(element) || isLeaving(element)) continue
          seen.add(element)
          let record = arrows.get(element)
          if (!record) {
            record = drawArrow(overlay)
            arrows.set(element, record)
          }
          placeArrow(record, element, origin, full)
        }
        for (const [element, record] of arrows) {
          if (seen.has(element)) continue
          arrows.delete(element)
          fade(record.group, true)
        }
      } catch {
        // An arrow that cannot be drawn now is drawn on the next pass.
      }
    }

    function defineArrow() {
      if (typeof customElements === 'undefined' || customElements.get('hb-arrow')) return
      // An arrow renders nothing where it is written; the layer draws it.
      customElements.define(
        'hb-arrow',
        class extends HTMLElement {
          static get observedAttributes() {
            return ['from', 'to', 'label', 'curve', 'data-style', 'data-color']
          }
          connectedCallback() {
            schedule()
          }
          disconnectedCallback() {
            schedule()
          }
          attributeChangedCallback() {
            schedule()
          }
        },
      )
    }

    // ---- Start ----

    // The theme and Still apply before the body paints: the window put them in the address.
    root.setAttribute('data-hb-theme', first.theme || (darkSystem && darkSystem.matches ? 'dark' : 'light'))
    if (state.still) root.setAttribute('data-hb-still', '')
    const colors = document.createElement('style')
    colors.setAttribute(RUNTIME, 'colors')
    insertAfterScript(colors)

    // Until the first entrance, the drawing is kept from showing, so it never flashes before it draws itself in. Only
    // this script sets that style, never the kit, and it always takes it away: at the latest after VEIL_MAX_MS.
    if (motion()) {
      setTimeout(() => {
        unveil()
        if (!state.entered) {
          state.entered = true
          route(true)
        }
      }, VEIL_MAX_MS)
      veil = document.createElement('style')
      veil.setAttribute(RUNTIME, 'veil')
      veil.textContent = 'body { opacity: 0 !important; }'
      insertAfterScript(veil)
    }

    addEventListener('message', onMessage)
    addEventListener('keydown', onKey)
    defineArrow()
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true })
    else ready()
  }

  const hook = typeof __hbCanvasTest === 'object' && __hbCanvasTest !== null ? __hbCanvasTest : null
  if (hook) {
    Object.assign(hook, {
      passesKey,
      preventsDefault,
      revisionMode,
      planSiblings,
      staggerDelays,
      traceDuration,
      flipDelta,
      arrowGeometry,
      appearanceFromQuery,
      colorRule,
      readMessage,
    })
    return
  }
  try {
    start()
  } catch {
    // A runtime that breaks leaves the drawing as it was written. A veil that went up comes down on its own timer.
  }
})()
