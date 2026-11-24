import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { hostStore, runCommand, useHost } from '@/lib/host/index.ts'
import { ImagePreview } from './ImagePreview.tsx'
import { StoredImageCache } from './stored-image.ts'

const cache = new StoredImageCache()
hostStore.subscribe((now, before) => {
  if (now.home !== before.home || now.epoch !== before.epoch || now.link !== before.link) cache.clear()
})

/** Each image loads by itself once it comes into view, one read per slot shown; never a request for local outbox or sample entries. */
export function StoredImages({ messageId, count, history }: { messageId?: string; count: number; history?: string }) {
  const home = useHost((state) => state.home), epoch = useHost((state) => state.epoch)
  const link = useHost((state) => state.link)
  const scope = `${home}:${epoch}:${history ?? 'main'}:${messageId}`
  return <div className="flex flex-wrap gap-2">{Array.from({ length: Math.min(count, 100) }, (_, ordinal) => <StoredImageSlot key={`${scope}:${ordinal}`} {...{ messageId, history, ordinal, scope }} enabled={!!home && link === 'open'} />)}</div>
}

function StoredImageSlot({ messageId, history, ordinal, scope, enabled }: { messageId?: string; history?: string; ordinal: number; scope: string; enabled: boolean }) {
  const key = `${scope}:${ordinal}`
  const preview = useSyncExternalStore(cache.subscribe, () => cache.get(key))
  const [status, setStatus] = useState('Load image')
  const alive = useRef(true)
  const slot = useRef<HTMLSpanElement>(null)
  // Loaded by itself the first time it is in view (the user, 2026-11-24: "why i have to click to load a preview? just show it").
  // Once per slot: one the cache let go of while still in view, which keeps two at most, waits for a click instead of loading again.
  const tried = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const name = `Image ${ordinal + 1}`
  const load = async () => {
    if (!messageId || !enabled) return
    const before = hostStore.getState()
    if (!scope.startsWith(`${before.home}:${before.epoch}:`)) return
    const current = () => {
      const now = hostStore.getState()
      return alive.current && now.home === before.home && now.epoch === before.epoch && now.link === 'open' && (history !== undefined || now.messages.some(({ id }) => id === messageId))
    }
    setStatus('Loading…')
    await cache.load(key, () => history ? runCommand('history.image', { id: history, messageId, ordinal }) : runCommand('conversation.image', { messageId, ordinal }), current)
    if (current()) setStatus(cache.get(key) ? 'Load image' : 'Image unavailable')
  }
  useEffect(() => {
    const element = slot.current
    if (!element || preview || tried.current || !messageId || !enabled) return
    if (typeof IntersectionObserver === 'undefined') {
      tried.current = true
      void load()
      return
    }
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || tried.current) return
      tried.current = true
      seen.disconnect()
      void load()
    }, { rootMargin: '200px' })
    seen.observe(element)
    return () => seen.disconnect()
    // `load` reads the slot's current props each time it runs; the observer starts again only when those change.
  }, [preview, messageId, enabled, scope])
  return (
    <span ref={slot} className="inline-flex">
      {preview ? <ImagePreview attachment={{ id: key, name, mimeType: '', preview }} /> : <button type="button" disabled={!messageId || !enabled || status === 'Loading…'} onClick={load} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground">{!messageId || !enabled ? 'Image unavailable' : status} {ordinal + 1}</button>}
    </span>
  )
}
