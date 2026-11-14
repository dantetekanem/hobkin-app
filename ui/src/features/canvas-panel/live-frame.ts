import type { FrameKey } from './rules.ts'

/**
 * A drawing's live frame (`040-canvas-board`). The window and the drawing speak in messages, each marked
 * `hobkin: 'canvas'`. Once the drawing has said it is ready, a new revision is a message to it, and it changes the
 * drawing in place. Before that (an older host, or a runtime that failed), and whenever the drawing asks or the user
 * presses Reload, the revision loads fresh: a second frame loads behind the one on screen and takes its place once
 * loaded. Pure, so the rules are tested without a window; `LiveDrawing.tsx` carries them out.
 */

/** The window's own colors for the drawing, read from the app's theme. */
export interface Colors {
  paper: string
  ink: string
  muted: string
  line: string
  accent: string
}

/** What the window tells a drawing. */
export type ToDrawing =
  | { hobkin: 'canvas'; type: 'appearance'; theme: 'light' | 'dark'; still: boolean; colors: Colors }
  | { hobkin: 'canvas'; type: 'show' }
  | { hobkin: 'canvas'; type: 'revision'; url: string }

/** What a drawing tells the window: it is ready, it needs a revision loaded fresh, or a key it did not use. */
export type FromDrawing = { type: 'ready'; version: 1 } | { type: 'load'; url: string } | ({ type: 'key' } & FrameKey)

const KEY_FLAGS = ['meta', 'ctrl', 'alt', 'shift'] as const

/** A message a drawing sent, or null for anything that is not of the contract. */
export function readFrameMessage(data: unknown): FromDrawing | null {
  if (typeof data !== 'object' || data === null) return null
  const message = data as Record<string, unknown>
  if (message.hobkin !== 'canvas') return null
  if (message.type === 'ready') return message.version === 1 ? { type: 'ready', version: 1 } : null
  if (message.type === 'load') return typeof message.url === 'string' ? { type: 'load', url: message.url } : null
  if (message.type === 'key') {
    if (typeof message.key !== 'string' || typeof message.code !== 'string' || !KEY_FLAGS.every((flag) => typeof message[flag] === 'boolean')) return null
    const { key, code, meta, ctrl, alt, shift } = message as unknown as FrameKey
    return { type: 'key', key, code, meta, ctrl, alt, shift }
  }
  return null
}

/** Which of the window's own frames sent a message, by its window, or null for any other window. */
export function frameOf(source: unknown, windows: Iterable<readonly [number, unknown]>): number | null {
  if (source === null || source === undefined) return null
  for (const [id, window] of windows) if (window === source) return id
  return null
}

/** One frame: the revision it loads, its address with the theme and Still it opened on, and how far it has come. */
export interface Frame {
  id: number
  url: string
  src: string
  /** The drawing in it said it is ready. */
  ready: boolean
  /** It fired load, so it can show. */
  loaded: boolean
}

/** The frames of one drawing, from the bottom up. The one on screen is the newest that has loaded. */
export interface Frames {
  list: readonly Frame[]
  next: number
}

export function startFrames(url: string, src: string): Frames {
  return { list: [{ id: 0, url, src, ready: false, loaded: false }], next: 1 }
}

/** The frame on screen: the newest that has loaded, or the first while none has. */
export function onScreen(frames: Frames): Frame {
  return frames.list.findLast((frame) => frame.loaded) ?? frames.list[0]!
}

/** A frame loading behind the one on screen, if any. */
export function behind(frames: Frames): Frame | null {
  const top = frames.list.at(-1)!
  return top === onScreen(frames) ? null : top
}

/**
 * Loads a revision fresh, behind the frame on screen. One already loading behind is dropped, since what it loads is no
 * longer the newest. With nothing on screen yet, the new frame takes the first one's place.
 */
export function loadFresh(frames: Frames, url: string, src: string): Frames {
  const keep = frames.list.filter((frame) => frame.loaded)
  return { list: [...keep, { id: frames.next, url, src, ready: false, loaded: false }], next: frames.next + 1 }
}

/** A new revision of the drawing: told to the frame on screen once it is ready and nothing loads behind it, else loaded fresh. */
export function revise(frames: Frames, url: string, src: string): { frames: Frames; post: { to: number; url: string } | null } {
  const shown = onScreen(frames)
  if (shown.ready && !behind(frames)) {
    return { frames: { ...frames, list: frames.list.map((frame) => (frame === shown ? { ...frame, url } : frame)) }, post: { to: shown.id, url } }
  }
  return { frames: loadFresh(frames, url, src), post: null }
}

const mark = (frames: Frames, id: number, change: Partial<Frame>): Frames => ({ ...frames, list: frames.list.map((frame) => (frame.id === id ? { ...frame, ...change } : frame)) })

export const markLoaded = (frames: Frames, id: number): Frames => mark(frames, id, { loaded: true })
export const markReady = (frames: Frames, id: number): Frames => mark(frames, id, { ready: true })

/** Once a frame has faded in over the ones under it, they go. */
export function settle(frames: Frames, id: number): Frames {
  const at = frames.list.findIndex((frame) => frame.id === id)
  return at <= 0 ? frames : { ...frames, list: frames.list.slice(at) }
}
