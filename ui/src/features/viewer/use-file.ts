import { useEffect, useState } from 'react'
import type { FileContent } from '#shared/protocol/files.ts'
import { runCommand, useHasHost } from '@/lib/host/index.ts'

export type FileState =
  | { status: 'loading' }
  | { status: 'ready'; file: FileContent }
  /** The file cannot be shown, and why, in plain words. */
  | { status: 'refused'; reason: string }

/** The text of a file, read by the host (`file.read`). Without a host there is nothing to read it with. */
export function useFile(path: string | null): FileState {
  const hasHost = useHasHost()
  const [state, setState] = useState<{ path: string | null; value: FileState }>({ path: null, value: { status: 'loading' } })

  useEffect(() => {
    if (path === null || !hasHost) return
    let current = true
    setState({ path, value: { status: 'loading' } })
    runCommand('file.read', { path }).then(
      (file) => current && setState({ path, value: { status: 'ready', file } }),
      (error: unknown) => current && setState({ path, value: { status: 'refused', reason: error instanceof Error ? error.message : String(error) } }),
    )
    return () => {
      current = false
    }
  }, [path, hasHost])

  if (path !== null && !hasHost) return { status: 'refused', reason: 'Files open once hobkin is connected. This window is showing sample data.' }
  // The answer for another file is never shown for this one.
  return state.path === path ? state.value : { status: 'loading' }
}
