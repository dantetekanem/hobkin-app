import { invoke } from '@tauri-apps/api/core'
import { useEffect, useRef } from 'react'
import { useSlice } from '@/integration/use-slice.ts'
import type { BrowserState } from '../protocol.ts'
import { run } from './commands.ts'

/** Only a mounted, visible page takes work. The shell checks its unique webview label again before acting. */
export function CanvasNavigation({ owner, revision, scope }: { owner: string; revision: number; scope: string }) {
  const state = useSlice<BrowserState>('browser')
  const id = state?.navigation?.find(request => request.owner === owner && request.revision === revision)?.id
  const current = useRef(id)
  useEffect(() => {
    current.current = id
    if (!id) return
    const key = { id, owner }
    async function act() {
      const action = await run('browser.canvas.claim', key)
      if (!action) return
      try {
        if (current.current !== id) throw Error('The canvas changed before this action.')
        const text = await invoke<string>('browser_canvas_action', { scope, action })
        await run('browser.canvas.finish', { ...key, text: text.slice(0, 32000) })
      } catch (error) {
        await run('browser.canvas.finish', { ...key, failed: true, text: String(error).slice(0, 1000) })
      }
    }
    void act().catch(() => { /* A disconnected host expires the request; do not replay it. */ })
    return () => { current.current = undefined }
  }, [id, owner, scope])
  return null
}
