import { motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStill } from '@/app/still.ts'
import { DidNotShow } from './CanvasNotes.tsx'
import { frameOf, loadFresh, markLoaded, markReady, onScreen, readFrameMessage, revise, settle, startFrames, type Colors, type Frames, type ToDrawing } from './live-frame.ts'
import { drawingOf, frameSrc, labelFor, LOAD_PATIENCE_MS, passedKey, sandboxFor } from './rules.ts'

const themeNow = (): 'light' | 'dark' => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')

/**
 * The app's colors as its theme has them now, a custom one included: the right side's surface as the paper, the text as
 * the ink, the muted text, the strong border for lines (the plain one is too faint for an arrow), and the accent.
 */
function colorsNow(): Colors {
  const style = getComputedStyle(document.documentElement)
  const color = (name: string) => style.getPropertyValue(name).trim()
  return { paper: color('--hb-surface'), ink: color('--hb-text'), muted: color('--hb-muted'), line: color('--hb-border-strong'), accent: color('--hb-accent') }
}

/** What a drawing is told of the window's look, kept as it changes: the theme, a custom palette, Still. */
function useAppearance(still: boolean): ToDrawing {
  const read = () => JSON.stringify({ theme: themeNow(), colors: colorsNow() })
  const [look, setLook] = useState(read)
  useEffect(() => {
    // The theme lives on the root: its class, and the custom palette's variables on its style.
    const observer = new MutationObserver(() => setLook(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-palette'] })
    return () => observer.disconnect()
  }, [])
  return useMemo(() => ({ hobkin: 'canvas', type: 'appearance', still, ...(JSON.parse(look) as { theme: 'light' | 'dark'; colors: Colors }) }), [look, still])
}

/** How long a fresh frame takes to fade in over the one under it. */
const FADE_S = 0.2

/**
 * A drawing in its live frame (`040-canvas-board`, the rules in `live-frame.ts`). The frame is sandboxed with no origin
 * of its own and speaks to the window in messages: once it says it is ready it is told the window's look, told to play
 * its first entrance once the canvas has arrived, and told each new revision, which it changes in place. Before that,
 * or when it asks, and on Reload, the revision loads fresh behind it and fades in over it. Its background is the app's
 * surface, so no frame ever shows blank or white. A key it did not use comes back only from the set it passes on, and
 * is pressed on the frame, where the frame's keys read it as a key pressed in the canvas.
 */
export function LiveDrawing({ url, title, revision, reloads, arrived, onOpenInBrowser }: {
  url: string
  title: string | null
  revision: number | undefined
  reloads: number
  /** The canvas has arrived where it shows, so the drawing may play its first entrance. */
  arrived: boolean
  onOpenInBrowser: () => void
}) {
  const still = useStill()
  const appearance = useAppearance(still)
  const srcOf = (address: string) => frameSrc(address, themeNow(), still)
  const [frames, setFrames] = useState(() => startFrames(url, srcOf(url)))
  // The frames as last set, for the message handler between renders.
  const current = useRef(frames)
  const elements = useRef(new Map<number, HTMLIFrameElement>())
  // The documents already told to play their first entrance.
  const entered = useRef(new Set<number>())
  const latest = useRef({ url, appearance, srcOf })
  latest.current = { url, appearance, srcOf }
  const [late, setLate] = useState(false)

  const update = (next: Frames) => {
    current.current = next
    setFrames(next)
  }
  const post = (id: number, message: ToDrawing) => elements.current.get(id)?.contentWindow?.postMessage(message, '*')

  // A new revision of this drawing, or Reload.
  const seen = useRef({ url, revision, reloads })
  useEffect(() => {
    const before = seen.current
    seen.current = { url, revision, reloads }
    if (reloads !== before.reloads) {
      update(loadFresh(current.current, url, srcOf(url)))
    } else if (url !== before.url || revision !== before.revision) {
      const step = revise(current.current, url, srcOf(url))
      update(step.frames)
      if (step.post) post(step.post.to, { hobkin: 'canvas', type: 'revision', url: step.post.url })
    }
  }, [url, revision, reloads])

  // What the drawing says. Only its own frames are heard, by their windows: the drawing has no origin to check.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const id = frameOf(event.source, [...elements.current].map(([key, element]) => [key, element.contentWindow] as const))
      const message = id === null ? null : readFrameMessage(event.data)
      if (id === null || !message) return
      if (message.type === 'ready') {
        update(markReady(current.current, id))
        post(id, latest.current.appearance)
      } else if (message.type === 'load') {
        // Only this drawing loads, and always at its newest revision.
        const { url: newest, srcOf: src } = latest.current
        if (drawingOf(message.url) === drawingOf(newest)) update(loadFresh(current.current, newest, src(newest)))
      } else {
        const frame = elements.current.get(id)
        const press = frame ? passedKey(message, document.activeElement === frame) : null
        if (frame && press) frame.dispatchEvent(new KeyboardEvent('keydown', press))
      }
    }
    addEventListener('message', onMessage)
    return () => removeEventListener('message', onMessage)
  }, [])

  // The window's look, to every drawing that is ready, whenever it changes.
  useEffect(() => {
    for (const frame of current.current.list) if (frame.ready) post(frame.id, appearance)
  }, [appearance])

  // The first entrance, once for each document, when it is ready and loaded and the canvas has arrived.
  useEffect(() => {
    if (!arrived) return
    for (const frame of frames.list) {
      if (!frame.ready || !frame.loaded || entered.current.has(frame.id)) continue
      entered.current.add(frame.id)
      post(frame.id, { hobkin: 'canvas', type: 'show' })
    }
  }, [frames, arrived])

  // A fresh frame that has loaded fades in over the ones under it, and then they go. The keyboard goes with it.
  const front = onScreen(frames)
  const bottom = frames.list[0]!
  useEffect(() => {
    if (front === bottom) return
    const timer = setTimeout(() => {
      const at = current.current.list.findIndex((frame) => frame.id === front.id)
      const under = at > 0 ? current.current.list.slice(0, at) : []
      const leaving = under.some((frame) => elements.current.get(frame.id) === document.activeElement)
      update(settle(current.current, front.id))
      if (leaving) elements.current.get(front.id)?.focus()
    }, still ? 0 : FADE_S * 1000 + 60)
    return () => clearTimeout(timer)
  }, [front.id, bottom.id, still])

  useEffect(() => {
    const timer = setTimeout(() => setLate(true), LOAD_PATIENCE_MS)
    return () => clearTimeout(timer)
  }, [])
  const refused = late && !frames.list.some((frame) => frame.loaded)

  return (
    <div className="relative min-h-0 flex-1 bg-surface">
      {frames.list.map((frame, index) => (
        <motion.iframe
          key={frame.id}
          ref={(element: HTMLIFrameElement | null) => {
            if (element) elements.current.set(frame.id, element)
            else elements.current.delete(frame.id)
          }}
          title={labelFor(url, title, 'drawing')}
          src={frame.src}
          sandbox={sandboxFor(frame.url, 'drawing')}
          referrerPolicy="no-referrer"
          aria-hidden={frame === front ? undefined : true}
          tabIndex={frame === front ? undefined : -1}
          // The same color scheme as a drawing that names none, so the frame stays clear and the surface shows through.
          style={{ colorScheme: 'normal', pointerEvents: frame === front ? 'auto' : 'none' }}
          className="absolute inset-0 size-full border-0 bg-surface"
          initial={index === 0 ? false : { opacity: 0 }}
          animate={{ opacity: index === 0 || frame.loaded ? 1 : 0 }}
          transition={still ? { duration: 0 } : { duration: FADE_S, ease: 'linear' }}
          onLoad={() => update(markLoaded(current.current, frame.id))}
        />
      ))}
      {refused ? <DidNotShow url={url} onOpenInBrowser={onOpenInBrowser} /> : null}
    </div>
  )
}
