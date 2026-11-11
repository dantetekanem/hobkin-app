import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { hostStore, runCommand, useHost } from '@/lib/host/index.ts'
import { ImagePreview } from './ImagePreview.tsx'
import { StoredImageCache } from './stored-image.ts'

const cache = new StoredImageCache()
hostStore.subscribe((now, before) => {
  if (now.home !== before.home || now.epoch !== before.epoch || now.link !== before.link) cache.clear()
})

/** Explicit lazy reads, never requests for local outbox or sample entries. */
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
  return preview ? <ImagePreview attachment={{ id: key, name, mimeType: '', preview }} /> : <button type="button" disabled={!messageId || !enabled || status === 'Loading…'} onClick={load} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground">{!messageId || !enabled ? 'Image unavailable' : status} {ordinal + 1}</button>
}
