import { useEffect } from 'react'
import { toast } from 'sonner'
import { hobkinAgentId } from '#shared/protocol/hobkins.ts'
import type { VersionStatus } from '#shared/protocol/version.ts'
import { useView } from '@/app/view-store.ts'
import { Toaster } from '@/components/ui/sonner.tsx'
import { hostStore, runCommand } from '@/lib/host/client.ts'
import { inMacWindow, updater } from '@/lib/native.ts'
import { watchNewVersion } from './new-version.ts'
import { watchUpdate } from './watch.ts'

/**
 * This notice has a toaster of its own. The app mounts none, so the toasts other features raise are not shown, and a
 * shared toaster here would start showing them as a side effect of the updater.
 */
const TOASTER = 'update'
/** The notice of a new version on GitHub, for a copy run from git (077-new-version). */
const NEW_VERSION = 'new-version'
const ASK_EVERY_MS = 60 * 60 * 1000

/** Update, from the notice: one agent on the mid tier brings the copy up to date, and the window opens it. */
function update() {
  runCommand('version.update').then(
    ({ hobkin }) => {
      useView.getState().openAgentCanvas(hobkinAgentId(hobkin))
    },
    (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      toast.error('The update did not start.', { id: NEW_VERSION, toasterId: TOASTER, duration: Infinity, description: reason })
    },
  )
}

function showNewVersion({ newest, inTheWay }: VersionStatus) {
  if (!newest) return
  toast(`New version available: hobkin ${newest}`, {
    id: NEW_VERSION,
    toasterId: TOASTER,
    duration: Infinity,
    description: inTheWay ? `${inTheWay} The agent that updates it asks you first.` : undefined,
    // The notice closes, and the agent's own screen shows the update.
    action: { label: 'Update', onClick: update },
  })
}

/**
 * Every hour, and each time the window reaches its host again. The host answers from its last look on GitHub, which
 * holds for six hours.
 */
function askAgain(look: () => void): () => void {
  const timer = setInterval(look, ASK_EVERY_MS)
  const unsubscribe = hostStore.subscribe((now, before) => {
    if (now.link === 'open' && before.link !== 'open') look()
  })
  return () => {
    clearInterval(timer)
    unsubscribe()
  }
}

/**
 * The lasting notices of a new version. In the Mac window of a release build, one that is installed and waits for a
 * restart. In a copy run from git, one that is on GitHub, with Update.
 */
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
  useEffect(() => {
    return watchNewVersion({ read: () => runCommand('version.read'), show: showNewVersion, every: askAgain })
  }, [])
  return <Toaster id={TOASTER} position="bottom-right" />
}
