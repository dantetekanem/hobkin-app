import { useEffect } from 'react'
import { toast } from 'sonner'
import { hostStore, runCommand } from '@/lib/host/index.ts'
import { hasHost } from '@/lib/host/frame.ts'
import { catchLinks } from './catch.ts'
import { FileViewer } from './FileViewer.tsx'
import { useViewer } from './store.ts'

/** The Mac window. Its web view opens no window for a link, and the shell has no opener for one. */
const inMacWindow = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/**
 * Where link clicks are caught for the whole app, and where a clicked file opens (_specs/027-links-and-files).
 * In the Mac window with a host a web or mail address opens through the host (`system.open`); in a browser tab it
 * is left to work as a link. A local file opens the viewer, or with ⌘ held its default app.
 */
export function LinkLayer() {
  useEffect(
    () =>
      catchLinks(document, {
        environment: () => ({ inMacWindow: inMacWindow(), hasHost: hasHost(hostStore.getState()) }),
        openFile: (path) => useViewer.getState().openFile(path),
        // A file the host cannot open, such as one that is not there, opens the viewer, which says why.
        openInApp: (path, pdfInChrome) => {
          void runCommand('file.open', pdfInChrome ? { path, pdfInChrome: true } : { path }).catch(() => {
            if (pdfInChrome) toast.error('Could not open the PDF in a new Chrome window.')
            else useViewer.getState().openFile(path)
          })
        },
        openAddress: (url) => void runCommand('system.open', { url }).catch(() => {}),
      }),
    [],
  )
  return <FileViewer />
}
