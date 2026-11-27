import { useEffect, type MouseEvent } from 'react'
import { toast } from 'sonner'
import type { VersionStatus } from '#shared/protocol/version.ts'
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
/** The notice of a new version on GitHub, for a copy run from git (077-new-version). Update changes it in place. */
const NEW_VERSION = 'new-version'
const ASK_EVERY_MS = 60 * 60 * 1000

/** Update, from the notice: the copy moves to the new version and installs it, and the notice says how that went. */
function update(newest: string) {
  const sameNotice = { id: NEW_VERSION, toasterId: TOASTER, duration: Infinity, action: undefined }
  toast.loading(`Updating to hobkin ${newest}…`, { ...sameNotice, description: 'Bringing this copy up to date and installing its packages.' })

  runCommand('version.update').then(
    ({ version, restarts }) => {
      const next = restarts ? 'hobkin restarts into it once nothing is running.' : 'Restart hobkin to load it.'
      toast.success(`hobkin ${version} is installed.`, { ...sameNotice, description: next })
    },
    (error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error)
      toast.error('The update stopped.', { ...sameNotice, description: reason })
    },
  )
}

function showNewVersion({ newest, blocked }: VersionStatus) {
  if (!newest) return
  const updateButton = {
    label: 'Update',
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      // Sonner closes a notice after its action unless the click is prevented. This one turns into the update's progress.
      event.preventDefault()
      update(newest)
    },
  }
  toast(`New version available: hobkin ${newest}`, {
    id: NEW_VERSION,
    toasterId: TOASTER,
    duration: Infinity,
    // A copy Update can't move says why, in place of the button.
    description: blocked ?? undefined,
    action: blocked ? undefined : updateButton,
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
