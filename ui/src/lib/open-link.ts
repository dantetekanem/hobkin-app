import type { MouseEvent } from 'react'
import { runCommand } from './host/client.ts'

/** The Mac window. Its web view opens no window of its own for a link, and the shell has no opener for one. */
const inMacWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * A link to a web address. In a browser tab the link opens it, as any link does. In the Mac window the host opens it
 * in the system browser instead (`system.open`).
 */
export function openLink(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  if (!inMacWindow) return
  event.preventDefault()
  void runCommand('system.open', { url }).catch(() => {})
}

/** Opens a web address without a link to follow, as the spotlight does: in the system browser from the Mac window, in a new tab from a browser tab. */
export function openAddress(url: string): void {
  if (inMacWindow) void runCommand('system.open', { url }).catch(() => {})
  else window.open(url, '_blank', 'noopener,noreferrer')
}
