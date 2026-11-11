import type { StoredImage } from '../../../../shared/commands/registry.ts'

/** At most two 5MiB raster images; no bytes survive a source change. */
export class StoredImageCache {
  private images = new Map<string, string>()
  private listeners = new Set<() => void>()
  private generation = 0
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = (key: string) => this.images.get(key)
  clear() { this.generation++; this.images.clear(); this.publish() }
  private publish() { for (const listener of this.listeners) listener() }
  async load(key: string, request: () => Promise<StoredImage | null>, current: () => boolean): Promise<void> {
    if (this.images.has(key) || !current()) return
    const generation = this.generation
    const image = await request().catch(() => null)
    if (!current() || generation !== this.generation || !image || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(image.mimeType) || !image.data.length || image.data.length > 6990508 || image.data.length % 4 || /[^A-Za-z0-9+/=]/.test(image.data)) return
    this.images.set(key, `data:${image.mimeType};base64,${image.data}`)
    while (this.images.size > 2) this.images.delete(this.images.keys().next().value!)
    this.publish()
  }
}
