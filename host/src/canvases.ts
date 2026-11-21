import { timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { CanvasEntry } from 'hobkin/src/cli/canvas.mjs'
import { CANVAS_CLOSED, canvasUrl, MAIN_CANVAS, type CanvasContent, type CanvasSaved, type CanvasState } from '#shared/protocol/canvas.ts'
import { canvasRuntime, withRuntime, type CanvasRuntime } from './canvas-runtime/inject.ts'
import { Unavailable, type HostHandlers } from './commands.ts'

/** The parts of hobkin's canvas store the host calls. The runtime's module fits; a test passes a copy over a folder. */
export interface CanvasStore {
  readCanvases(root: string): Record<string, CanvasEntry>
  showPage(root: string, owner: string, page: { url: string; title?: string | null }): CanvasEntry
  drawCanvas(root: string, owner: string, drawing: { html: string; title?: string | null }): CanvasEntry
  closeCanvas(root: string, owner: string): CanvasEntry
  readCanvas(root: string, owner: string): { state: CanvasEntry; file: string | null }
  saveCanvas(root: string, owner: string, options?: { path?: string; downloads?: string; home?: string }): { path: string }
  drawingFile(root: string, owner: string): string
}

export interface CanvasesOptions {
  store: CanvasStore
  /** hobkin's home folder. Throws with the reason while hobkin is not open. */
  root: () => string
  /** The host server's port. */
  port: () => number
  /** What the window would be told changed. */
  onChange: () => void
  home?: string
  downloads?: string
  /**
   * The kit and the runtime every drawing is served with (040-canvas-board): by default the files beside the host's
   * code, read once. A test passes its own. When this throws, drawings are served as they are.
   */
  runtime?: () => CanvasRuntime
}

interface Published {
  main: CanvasState
  others: Record<string, CanvasState>
}

const DEBOUNCE_MS = 60
const KEYED_PATH = /^\/canvas\/([0-9a-f]{32})$/
const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals'

/**
 * Every hobkin's canvas as the window sees it (`035-canvas-drawings`). hobkin's store on disk is the truth, and
 * the `hobkin canvas` command writes it from other processes, so this follows the folder and tells the window
 * when what it would show has changed. It also serves each drawing at its keyed address.
 */
export class Canvases {
  private readonly options: CanvasesOptions
  private published: Published
  private watcher: FSWatcher | null = null
  /** The folder the watcher follows, and the one it followed when the store was last read. */
  private attached: string | null = null
  private readFollowing: string | null = null
  private timer: NodeJS.Timeout | null = null
  private watching = false

  constructor(options: CanvasesOptions) {
    this.options = options
    this.published = this.compute()
  }

  /** The main hobkin's canvas, as last published. */
  get main(): CanvasState {
    return this.published.main
  }

  /** Every other hobkin's canvas by its id, as last published. */
  others(): Record<string, CanvasState> {
    return this.published.others
  }

  /** One owner's canvas now, read from the store. */
  state(owner: string): CanvasState {
    return this.stateOf(this.entries()[owner])
  }

  show(owner: string, address: string, title?: string): CanvasState {
    return this.change((root) => this.options.store.showPage(root, owner, { url: canvasUrl(address).href, title: title?.trim() || null }))
  }

  draw(owner: string, html: string, title?: string): CanvasState {
    return this.change((root) => this.options.store.drawCanvas(root, owner, { html, title: title?.trim() || null }))
  }

  close(owner: string): CanvasState {
    return this.change((root) => this.options.store.closeCanvas(root, owner))
  }

  read(owner: string): CanvasContent {
    const { state, file } = this.refused((root) => this.options.store.readCanvas(root, owner))
    return { state: this.stateOf(state), file }
  }

  save(owner: string, path?: string): CanvasSaved {
    const { home, downloads } = this.options
    return this.refused((root) =>
      this.options.store.saveCanvas(root, owner, {
        ...(path ? { path } : {}),
        ...(downloads ? { downloads } : {}),
        ...(home ? { home } : {}),
      }),
    )
  }

  /** Reads the store again and tells the window when what it shows changed. The host may call this any time. */
  refresh(): void {
    if (this.watching) this.attach()
    const next = this.compute()
    this.readFollowing = this.attached
    if (JSON.stringify(next) === JSON.stringify(this.published)) return
    this.published = next
    this.options.onChange()
  }

  /**
   * The host's timer. While the watcher follows the open home's canvas folder, every change there reaches it, so
   * there is nothing to read. Otherwise (hobkin not open yet, another home, a watch that failed) it reads the store.
   */
  poll(): void {
    const followed = this.watching && this.watcher !== null && this.attached === this.folder()
    if (followed && this.readFollowing === this.attached) return
    this.refresh()
  }

  /** Follows the canvas folder, so a change made by the shell command reaches the window. Never throws. */
  watch(): void {
    this.watching = true
    this.attach()
  }

  stop(): void {
    this.watching = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.watcher?.close()
    this.watcher = null
    this.attached = null
  }

  /**
   * Answers `GET /canvas/<key>` for a key that belongs to a drawing now. Returns false and writes nothing for
   * anything else, so the server's own 404 stands. The file is found through the store, never from the request.
   * The drawing goes out with the kit and the runtime put in after its doctype, still in its own sandbox.
   */
  serve(request: IncomingMessage, response: ServerResponse): boolean {
    if (request.method !== 'GET') return false
    const key = KEYED_PATH.exec(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)?.[1]
    if (!key) return false
    try {
      const root = this.options.root()
      const entries = Object.entries(this.options.store.readCanvases(root))
      const owner = entries.find(([, entry]) => entry.open && entry.kind === 'drawing' && sameKey(entry.key, key))?.[0]
      if (!owner) return false
      const drawing = readFileSync(this.options.store.drawingFile(root, owner))
      const body = this.asServed(drawing)
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': body.length,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'content-security-policy': SANDBOX,
        // The drawing runs with no origin of its own, and fetches its next revision from here to change in place.
        'access-control-allow-origin': '*',
      })
      response.end(body)
      return true
    } catch {
      return false
    }
  }

  /** A drawing as its frame gets it: with the kit and the runtime, or exactly as written when their files cannot be read. */
  private asServed(drawing: Buffer): Buffer {
    const readRuntime = this.options.runtime ?? canvasRuntime
    try {
      return withRuntime(drawing, readRuntime())
    } catch {
      return drawing
    }
  }

  /** The open home's canvas folder, or null while hobkin is not open. */
  private folder(): string | null {
    try {
      return join(this.options.root(), 'canvas')
    } catch {
      return null
    }
  }

  /** Follows the open home's canvas folder, and lets go of one that is no longer it. */
  private attach(): void {
    const folder = this.folder()
    if (this.watcher && this.attached === folder) return
    this.watcher?.close()
    this.watcher = null
    this.attached = null
    if (!folder) return
    try {
      mkdirSync(folder, { recursive: true, mode: 0o700 })
      this.watcher = watch(folder, () => this.soon())
      this.attached = folder
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      this.watcher = null
    }
  }

  private soon(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      try {
        this.refresh()
      } catch {
        // The host's own tick calls refresh again.
      }
    }, DEBOUNCE_MS)
  }

  private change(write: (root: string) => CanvasEntry): CanvasState {
    const entry = this.refused(write)
    this.refresh()
    return this.stateOf(entry)
  }

  private refused<T>(run: (root: string) => T): T {
    try {
      return run(this.options.root())
    } catch (error) {
      throw new Unavailable(error instanceof Error ? error.message : String(error))
    }
  }

  private entries(): Record<string, CanvasEntry> {
    try {
      return this.options.store.readCanvases(this.options.root())
    } catch {
      return {}
    }
  }

  private compute(): Published {
    const { [MAIN_CANVAS]: main, ...rest } = this.entries()
    return {
      main: this.stateOf(main),
      others: Object.fromEntries(Object.entries(rest).map(([owner, entry]) => [owner, this.stateOf(entry)])),
    }
  }

  private stateOf(entry: CanvasEntry | undefined): CanvasState {
    if (!entry?.open) return CANVAS_CLOSED
    const title = entry.title?.trim() || null
    if (entry.kind === 'drawing') {
      if (!entry.key) return CANVAS_CLOSED
      const url = `http://127.0.0.1:${this.options.port()}/canvas/${entry.key}?r=${entry.revision}`
      return { open: true, url, title, kind: 'drawing', revision: entry.revision }
    }
    try {
      return { open: true, url: canvasUrl(entry.url ?? '').href, title, kind: 'page', revision: entry.revision }
    } catch {
      return CANVAS_CLOSED
    }
  }
}

function sameKey(have: string | null, given: string): boolean {
  if (!have) return false
  const a = Buffer.from(have)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The five canvas commands, for the host's handlers. An owner left out is the main hobkin's. */
export function canvasHandlers(canvases: Canvases): Pick<HostHandlers, 'canvas.show' | 'canvas.draw' | 'canvas.read' | 'canvas.save' | 'canvas.close'> {
  return {
    'canvas.show': ({ url, title, hobkin }) => canvases.show(hobkin ?? MAIN_CANVAS, url, title),
    'canvas.draw': ({ html, title, hobkin }) => canvases.draw(hobkin ?? MAIN_CANVAS, html, title),
    'canvas.read': ({ hobkin }) => canvases.read(hobkin ?? MAIN_CANVAS),
    'canvas.save': ({ path, hobkin }) => canvases.save(hobkin ?? MAIN_CANVAS, path),
    'canvas.close': ({ hobkin }) => canvases.close(hobkin ?? MAIN_CANVAS),
  }
}
