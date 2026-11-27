import { createElement, useEffect, useRef, useState, type ReactElement, type SyntheticEvent } from 'react'
import type { FileContent } from '#shared/protocol/files.ts'
import { runCommand } from '../../lib/host/client.ts'

/**
 * A file on this Mac shown where a message pictures it (`027-links-and-files`): an image as the picture, and an HTML
 * file as the page it draws, still. An agent writes `![what it shows](/full/path)` when seeing it answers better than
 * words (the user, 2026-11-27: "the agent can (and should) render images for me in the main screen, or even pieces of
 * iframe ... not always, but it can"). The host reads the file (`file.read`), so nothing comes from the network: an
 * address there stays the link it was, because an address a message chose could tell someone the message was read.
 * A page is sealed for the same reason: it runs no script and loads nothing but what it carries. Any other file, and
 * one that cannot be read, is the link it was, which opens the viewer.
 *
 * This file has no JSX so the tests can render it with Node alone.
 */

/** What a file shows as in a conversation. */
export type Shown = { kind: 'picture'; url: string } | { kind: 'page'; html: string } | { kind: 'link' }

const LINK_ONLY: Shown = { kind: 'link' }
const PAGE_NAME = /\.html?$/i

/**
 * What a sealed page may load: nothing from any address. Its own styles apply, and images, fonts and media only as
 * `data:` it carries. With no script and no connection allowed, it cannot ask for anything either.
 */
export const PAGE_POLICY = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; media-src data:"

const POLICY_ELEMENT = `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`
/** A page's doctype, with any comments ahead of it. */
const DOCTYPE = /^(?:\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i

/**
 * A link element can look up or connect to a host of the page's choosing, which no policy stops. Taking one out can
 * leave another whole, so it goes on until none is left.
 */
function withoutLinkElements(html: string): string {
  let rest = html
  for (;;) {
    const next = rest.replace(/<link\b[^>]*>/gi, '')
    if (next === rest) return rest
    rest = next
  }
}

/** A page as its frame takes it: no link element, and its policy first, after the doctype so the page keeps its layout mode. */
export function sealedPage(html: string): string {
  const page = withoutLinkElements(html)
  const doctype = page.match(DOCTYPE)?.[0] ?? ''
  return `${doctype}${POLICY_ELEMENT}${page.slice(doctype.length)}`
}

/** What a file the host read shows as. A page is known by its name, and sealed here, once. */
export function shownOf(file: FileContent): Shown {
  if (file.kind === 'image') return { kind: 'picture', url: file.url }
  if (file.kind === 'text' && PAGE_NAME.test(file.name)) return { kind: 'page', html: sealedPage(file.text) }
  return LINK_ONLY
}

/** How long what a file showed is drawn again without reading it: it may have been written again since. */
const KEPT_MS = 60_000
/** A file that could not be read is tried again sooner: it may be there by then. */
const REFUSED_MS = 10_000
/** The most kept at once, in characters of pictures and pages. One over this is drawn and not kept. */
const MOST_KEPT_CHARS = 32 * 1024 * 1024

interface Kept {
  shown: Shown
  until: number
  chars: number
}

const kept = new Map<string, Kept>()
const reading = new Map<string, Promise<Shown>>()

function charsOf(shown: Shown): number {
  if (shown.kind === 'picture') return shown.url.length
  if (shown.kind === 'page') return shown.html.length
  return 0
}

/** Lets go of what was kept longest until what is kept fits. */
function letGoOfTheOldest(): void {
  let total = 0
  for (const entry of kept.values()) total += entry.chars

  for (const [path, entry] of kept) {
    if (total <= MOST_KEPT_CHARS) return
    kept.delete(path)
    total -= entry.chars
  }
}

function keep(path: string, shown: Shown, now: number): void {
  kept.delete(path)

  const chars = charsOf(shown)
  if (chars > MOST_KEPT_CHARS) return

  const lasts = shown.kind === 'link' ? REFUSED_MS : KEPT_MS
  kept.set(path, { shown, until: now + lasts, chars })
  letGoOfTheOldest()
}

/** What a file showed when it was last read, while that is still kept. */
export function keptShown(path: string, now = Date.now()): Shown | null {
  const entry = kept.get(path)
  if (!entry) return null
  if (now < entry.until) return entry.shown

  kept.delete(path)
  return null
}

const readFile = (path: string): Promise<FileContent> => runCommand('file.read', { path })

/** What a file shows as: kept, or read once however many pictures of it ask at the same time. One that cannot be read is its link. */
export function loadShown(path: string, read: (path: string) => Promise<FileContent> = readFile, now = Date.now()): Promise<Shown> {
  const held = keptShown(path, now)
  if (held) return Promise.resolve(held)

  const out = reading.get(path)
  if (out) return out

  const asked = read(path)
    .then(shownOf, () => LINK_ONLY)
    .then((shown) => {
      keep(path, shown, now)
      return shown
    })
    .finally(() => reading.delete(path))
  reading.set(path, asked)
  return asked
}

/** How near the view a picture is before its file is read. */
const NEAR_VIEW = '300px'
const WORDS_LINK = 'underline decoration-border-strong underline-offset-2'
const PICTURE_LINK = 'my-1 block w-fit max-w-full'
const PICTURE = 'block max-h-[28rem] max-w-full rounded-xl border border-border'
/** A page's paper is white, as a browser's is, so one that names no colors reads the same here in the dark. */
const FRAME = 'pointer-events-none block w-full rounded-xl border border-border bg-white'
const CAPTION = `mt-1 block w-fit text-[12px] text-muted-foreground ${WORDS_LINK}`
/** A frame's height before its page is laid out, and the most it takes. A taller page is cut, and opens whole from its link. */
const PAGE_PX = 200
const MOST_PAGE_PX = 560

interface ShownFileProps {
  /** The file's full path, or one that starts with `~/`. */
  path: string
  /** The picture's own words: its alt text. */
  words?: string
}

/**
 * A page in its frame. The frame has the window's origin and no script, so nothing in it runs, and the window can read
 * how tall the page is to give it that height. It is inert, taking no pointer and no keyboard: it is a picture of the
 * page, and a link in it leads nowhere.
 */
function Page({ path, words, html }: ShownFileProps & { html: string }): ReactElement {
  const [height, setHeight] = useState(PAGE_PX)
  const name = words || path.split('/').at(-1) || path

  const fitToPage = (event: SyntheticEvent<HTMLIFrameElement>) => {
    const page = event.currentTarget.contentDocument
    if (!page) return

    const tall = Math.max(page.documentElement.offsetHeight, page.body?.scrollHeight ?? 0)
    if (tall > 0) setHeight(Math.min(tall, MOST_PAGE_PX))
  }

  return createElement(
    'span',
    { className: 'my-1 block' },
    createElement('iframe', {
      title: name,
      sandbox: 'allow-same-origin',
      srcDoc: html,
      referrerPolicy: 'no-referrer',
      inert: true,
      onLoad: fitToPage,
      style: { height, colorScheme: 'light' },
      className: FRAME,
    }),
    createElement('a', { href: '#', 'data-file': path, title: path, className: CAPTION }, name),
  )
}

/** Calls `seen` once the element comes near the view, or at once where the window cannot tell. Gives what stops the wait. */
function whenNearView(element: Element, seen: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    seen()
    return () => {}
  }

  const watcher = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      watcher.disconnect()
      seen()
    },
    { rootMargin: NEAR_VIEW },
  )
  watcher.observe(element)
  return () => watcher.disconnect()
}

/**
 * A picture of a local file in a message. It is its words, linked to the file, until the file is read, which waits for
 * the picture to come near the view. Then an image draws in its place and a page draws in a frame above its words.
 * A click opens the file in the viewer either way (`catch.ts`).
 */
export function ShownFile({ path, words = '' }: ShownFileProps): ReactElement {
  const [read, setRead] = useState<{ path: string; shown: Shown } | null>(null)
  const shown = read?.path === path ? read.shown : keptShown(path)
  const link = useRef<HTMLAnchorElement | null>(null)

  useEffect(() => {
    const element = link.current
    if (shown || !element) return

    let current = true
    const load = () => {
      void loadShown(path).then((loaded) => {
        if (current) setRead({ path, shown: loaded })
      })
    }

    const stopWaiting = whenNearView(element, load)
    return () => {
      current = false
      stopWaiting()
    }
  }, [path, shown])

  if (shown?.kind === 'picture') {
    return createElement(
      'a',
      { href: '#', 'data-file': path, title: path, className: PICTURE_LINK },
      createElement('img', { src: shown.url, alt: words, draggable: false, className: PICTURE }),
    )
  }
  if (shown?.kind === 'page') return createElement(Page, { path, words, html: shown.html })

  return createElement('a', { ref: link, href: '#', 'data-file': path, title: path, className: WORDS_LINK }, words || 'image')
}
