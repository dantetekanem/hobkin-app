import type { MouseEvent } from 'react'
import { runCommand } from '@/lib/host/index.ts'

/** The Mac window. Its web view opens no window of its own for a link, and the shell has no opener for one. */
const inMacWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * A row is a link to its page on github.com. In a browser tab the link opens it, as any link does. In the Mac
 * window the host opens it in the system browser instead (`github.open`).
 */
export function openOnGitHub(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  if (!inMacWindow) return
  event.preventDefault()
  void runCommand('github.open', { url }).catch(() => {})
}
