import { useEffect } from 'react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner.tsx'
import { inMacWindow, updater } from '@/lib/native.ts'
import { watchUpdate } from './watch.ts'

/**
 * This notice has a toaster of its own. The app mounts none, so the toasts other features raise are not shown, and a
 * shared toaster here would start showing them as a side effect of the updater.
 */
const TOASTER = 'update'

/** The lasting notice that a new version is ready. It stays until the user restarts, and shows only in the Mac window. */
export function UpdateNotice() {
  useEffect(() => {
    if (!inMacWindow()) return
    return watchUpdate({
      ...updater,
      show: (version) =>
        toast(`hobkin ${version} is ready.`, {
          id: 'update-ready',
          toasterId: TOASTER,
          duration: Infinity,
          action: { label: 'Restart', onClick: () => void updater.restart().catch(() => {}) },
        }),
    })
  }, [])
  return <Toaster id={TOASTER} position="bottom-right" />
}
